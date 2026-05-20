'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function changePassword(formData: FormData): Promise<never> {
  const newPassword = formData.get('password') as string
  const confirm = formData.get('confirm') as string

  if (!newPassword || newPassword.length < 8) {
    redirect('/change-password?error=' + encodeURIComponent('비밀번호는 8자 이상이어야 합니다'))
  }
  if (newPassword !== confirm) {
    redirect('/change-password?error=' + encodeURIComponent('비밀번호가 일치하지 않습니다'))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error: pwError } = await supabase.auth.updateUser({ password: newPassword })
  if (pwError) {
    redirect('/change-password?error=' + encodeURIComponent(pwError.message))
  }

  // user_metadata 초기화 (layout.tsx의 redirect 조건 해제)
  await supabase.auth.updateUser({ data: { must_change_password: false } })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('profiles') as any)
    .update({ must_change_password: false })
    .eq('id', user.id)

  redirect('/dashboard')
}
