'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function changeRole(userId: string, newRole: 'admin' | 'member') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다' }

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: { role: string } | null; error: unknown }

  if (!myProfile || myProfile.role !== 'admin') return { error: '관리자 권한이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any).update({ role: newRole }).eq('id', userId)
  if (error) return { error: error.message }

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
