'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function changeRole(userId: string, newRole: 'admin' | 'member') {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: '인증이 필요합니다' }

  // 본인 role 확인
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: { role: 'admin' | 'member' } | null; error: unknown }

  if (!myProfile || myProfile.role !== 'admin') {
    return { error: '관리자 권한이 필요합니다' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any)
    .update({ role: newRole })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/admin/users')
  return { success: true }
}

// TODO: 새 팀원 생성은 service_role key가 필요한 Admin API를 사용해야 합니다.
// 현재는 UI 레이어만 구현되어 있으며, 실제 사용자 생성은 별도 서버(Edge Function 등)를 통해 구현해야 합니다.
// Supabase Admin API: supabase.auth.admin.createUser({ email, password, user_metadata: { name } })
export async function inviteUser(_formData: FormData) {
  return {
    error:
      'TODO: Admin API(service_role key)가 필요합니다. Supabase Edge Function 또는 별도 API 서버를 통해 구현하세요.',
  }
}
