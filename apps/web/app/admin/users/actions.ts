'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const BAN_DURATION_PERMANENT = '876000h' // ~100년

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single() as unknown as { data: { role: string } | null; error: unknown }

  if (!myProfile || myProfile.role !== 'admin') return null
  return { user, supabase }
}

export async function changeRole(userId: string, newRole: 'admin' | 'member') {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '관리자 권한이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase.from('profiles') as any).update({ role: newRole }).eq('id', userId)
  if (error) return { error: error.message }

  revalidatePath('/admin/users')
  return { success: true }
}

export async function deleteUser(userId: string): Promise<{ success?: boolean; error?: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { error: '관리자 권한이 필요합니다' }
  if (ctx.user.id === userId) return { error: '자기 자신은 삭제할 수 없습니다' }

  const adminClient = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: profileError } = await (adminClient.from('profiles') as any)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', userId)

  if (profileError) return { error: profileError.message }

  // 조직도 정리 — 소프트삭제는 org_nodes의 FK CASCADE(user_id)·SET NULL(head_user_id)를 발동시키지 않으므로 수동 처리.
  //   (안 하면 삭제된 사람의 person 노드가 조직도에 고아로 남음. person 노드는 리프라 자식 RESTRICT 없음.)
  //   1) 그 user의 person 노드 제거(closure는 ON DELETE CASCADE로 동반 정리)
  //   2) 그 user가 부서장(head_user_id)인 노드의 참조 해제
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: nodeDelErr } = await (adminClient.from('org_nodes') as any).delete().eq('type', 'person').eq('user_id', userId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: headErr } = await (adminClient.from('org_nodes') as any).update({ head_user_id: null }).eq('head_user_id', userId)
  // 정리 실패는 본체(소프트삭제) 롤백 불가 — 관측만 남김(고아 노드 남을 수 있으니 추적). auth ban 패턴과 동일.
  if (nodeDelErr || headErr) console.warn('[deleteUser] org_nodes cleanup failed:', nodeDelErr?.message ?? headErr?.message)

  // Supabase Auth 사용자 비활성화
  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: BAN_DURATION_PERMANENT,
  })
  if (authError) {
    // 프로필 소프트 삭제는 성공했으나 auth ban 실패 — 경고 로그 후 성공 반환
    // (프로필 삭제_at 필터로 인해 로그인 후에도 접근 차단됨)
    console.warn('[deleteUser] auth ban failed, profile soft-deleted:', authError.message)
  }

  revalidatePath('/admin/users')
  revalidatePath('/admin/members')
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  return { success: true }
}

// login/actions.ts의 RESET_SENTINEL과 반드시 동일해야 함
const RESET_SENTINEL = 'AX_RESET_REQUIRED_2024!'

export async function resetUserPassword(
  userId: string,
  _userEmail: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const adminClient = createAdminClient()

  // 센티넬 비밀번호로 설정 → 사용자는 비밀번호 빈칸으로 로그인 가능
  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    password: RESET_SENTINEL,
  })
  if (authError) return { ok: false, error: authError.message }

  // must_change_password 플래그 설정 — 로그인 직후 변경 강제
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient.from('profiles') as any)
    .update({ must_change_password: true })
    .eq('id', userId)

  revalidatePath('/admin/users')
  return { ok: true }
}

/** 온보딩 초기화 — 해당 구성원의 온보딩 상태(완료/스킵/진행)를 비워 다음 로그인 시 재노출. */
export async function resetUserOnboarding(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient.from('profiles') as any)
    .update({ onboarding_completed_at: null, onboarding_skipped_at: null, onboarding_step: null })
    .eq('id', userId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/members')
  return { ok: true }
}

export async function inviteUser(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const email = (formData.get('email') as string)?.trim()
  const name = (formData.get('name') as string)?.trim()

  if (!email || !name) return { error: '이메일과 이름을 입력해주세요' }

  const adminClient = createAdminClient()

  const { data, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: RESET_SENTINEL,
    email_confirm: true,
    user_metadata: { name },
  })

  if (createError) return { error: createError.message }

  // auth.users 생성 직후 profiles를 직접 upsert (트리거 경합 없이 확정)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: profileError } = await (adminClient.from('profiles') as any)
    .upsert(
      { id: data.user.id, name, role: 'member', must_change_password: true },
      { onConflict: 'id' }
    )

  if (profileError) {
    console.error('[inviteUser] profile upsert error', profileError)
    return { error: '사용자 생성 중 오류가 발생했습니다' }
  }

  revalidatePath('/admin/users')
  return { success: true }
}
