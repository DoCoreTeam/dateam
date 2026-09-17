'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { kstTodayKey } from '@/lib/datetime/kst'
import { validateEmployment, toDateOrNull } from '@/lib/members/employment'

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

// ─────────────────────────────────────────────
// 재직 기록 — 퇴사·되돌리기·입사퇴사 수정 (마이그레이션 255 member_employment)
//
// 삭제(deleteUser)와 무엇이 다른가: 삭제는 profiles.deleted_at 을 찍어 **없던 것으로 친다.**
// 퇴사는 profiles 를 그대로 두고 옆 표에 나간 날을 적는다 — 그 사람이 쓴 일일업무 주간보고
// 회의노트가 이름을 잃지 않아야 하기 때문이다 (사용자 지시 2026-09-17).
// 공통점은 둘 다 로그인을 막는다는 것뿐이다.
// ─────────────────────────────────────────────

/** 퇴사해도 조직도에는 남기지 않는다 — 나간 사람이 조직에 그려져 있으면 그 조직도는 거짓이다. */
async function detachFromOrgChart(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any
  const { error: nodeDelErr } = await db.from('org_nodes').delete().eq('type', 'person').eq('user_id', userId)
  const { error: headErr } = await db.from('org_nodes').update({ head_user_id: null }).eq('head_user_id', userId)
  // 조직도 정리 실패로 퇴사 기록 자체를 되돌리지 않는다 — 기록이 남는 쪽이 언제나 낫다(deleteUser 와 같은 판단)
  if (nodeDelErr || headErr) console.warn('[resignMember] org_nodes cleanup failed:', nodeDelErr?.message ?? headErr?.message)
}

function revalidateMemberPaths(userId?: string): void {
  revalidatePath('/admin/users')
  revalidatePath('/admin/members')
  revalidatePath('/admin/org-chart')
  revalidatePath('/org')
  if (userId) revalidatePath(`/admin/members/${userId}`)
}

export async function resignMember(
  userId: string,
  input?: { resignedOn?: string | null; reason?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }
  // 자기 자신을 퇴사시키면 그 자리에서 로그인이 막혀 되돌릴 사람이 사라진다
  if (ctx.user.id === userId) return { ok: false, error: '자기 자신은 퇴사 처리할 수 없습니다' }

  const resignedOn = toDateOrNull(input?.resignedOn) ?? kstTodayKey()
  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const { data: existing } = await db
    .from('member_employment').select('hired_on').eq('user_id', userId).maybeSingle()
  const invalid = validateEmployment({ hired_on: existing?.hired_on ?? null, resigned_on: resignedOn })
  if (invalid) return { ok: false, error: invalid }

  const { error } = await db.from('member_employment').upsert(
    {
      user_id: userId,
      resigned_on: resignedOn,
      resign_reason: (input?.reason ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { ok: false, error: error.message }

  await detachFromOrgChart(adminClient, userId)

  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: BAN_DURATION_PERMANENT,
  })
  // 기록은 남았는데 로그인만 안 막힌 상태 — 관측만 남기고 성공으로 본다(삭제와 같은 판단)
  if (authError) console.warn('[resignMember] auth ban failed, employment recorded:', authError.message)

  revalidateMemberPaths(userId)
  return { ok: true }
}

/** 퇴사 취소 — 기록을 비우고 로그인을 다시 연다. 조직도 자리는 돌아오지 않는다(지웠으므로). */
export async function undoResignMember(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient.from('member_employment') as any)
    .update({ resigned_on: null, resign_reason: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }

  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (authError) return { ok: false, error: `기록은 되돌렸지만 로그인이 열리지 않았습니다: ${authError.message}` }

  revalidateMemberPaths(userId)
  return { ok: true }
}

/**
 * 구성원 상세에서 입사일 퇴사일 사유 메모를 고친다.
 *
 * 여기서 퇴사일을 **처음 넣거나 지우는 것**도 퇴사·되돌리기와 같은 뜻이므로, 로그인 차단도
 * 같이 따라간다. 안 그러면 상세에서 퇴사일을 적은 사람이 계속 로그인하는 상태가 된다.
 */
export async function updateEmployment(
  userId: string,
  input: { hiredOn?: string | null; resignedOn?: string | null; reason?: string | null; note?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireAdmin()
  if (!ctx) return { ok: false, error: '관리자 권한이 필요합니다' }

  const hiredOn = toDateOrNull(input.hiredOn)
  const resignedOn = toDateOrNull(input.resignedOn)
  if (ctx.user.id === userId && resignedOn) return { ok: false, error: '자기 자신은 퇴사 처리할 수 없습니다' }

  const invalid = validateEmployment({ hired_on: hiredOn, resigned_on: resignedOn })
  if (invalid) return { ok: false, error: invalid }

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient as any

  const { data: before } = await db
    .from('member_employment').select('resigned_on').eq('user_id', userId).maybeSingle()
  const wasResigned = Boolean(before?.resigned_on)

  const { error } = await db.from('member_employment').upsert(
    {
      user_id: userId,
      hired_on: hiredOn,
      resigned_on: resignedOn,
      resign_reason: (input.reason ?? '').trim() || null,
      note: (input.note ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { ok: false, error: error.message }

  if (!wasResigned && resignedOn) {
    await detachFromOrgChart(adminClient, userId)
    const { error: banErr } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION_PERMANENT })
    if (banErr) console.warn('[updateEmployment] auth ban failed:', banErr.message)
  }
  if (wasResigned && !resignedOn) {
    const { error: unbanErr } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: 'none' })
    if (unbanErr) return { ok: false, error: `기록은 저장했지만 로그인이 열리지 않았습니다: ${unbanErr.message}` }
  }

  revalidateMemberPaths(userId)
  return { ok: true }
}
