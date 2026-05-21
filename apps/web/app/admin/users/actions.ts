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
  return { success: true }
}

export async function inviteUser(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const email = (formData.get('email') as string)?.trim()
  const name = (formData.get('name') as string)?.trim()
  const tempPassword = (formData.get('tempPassword') as string)?.trim()

  if (!email || !name || !tempPassword) return { error: '모든 필드를 입력해주세요' }
  if (tempPassword.length < 6) return { error: '임시 비밀번호는 6자 이상이어야 합니다' }

  const adminClient = createAdminClient()

  const { data, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: tempPassword,
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
