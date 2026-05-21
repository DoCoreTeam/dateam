'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// PW초기화된 계정의 센티넬 비밀번호 — admin/users/actions.ts와 동일해야 함
const RESET_SENTINEL = 'AX_RESET_REQUIRED_2024!'

export async function signIn(formData: FormData) {
  const email = (formData.get('email') as string)?.trim()
  const password = (formData.get('password') as string) ?? ''

  if (!email) {
    redirect('/login?error=' + encodeURIComponent('이메일을 입력해주세요'))
  }

  const supabase = await createClient()

  // 비밀번호 빈칸 → 센티넬로 시도 (PW초기화된 계정인지 확인)
  const tryPassword = password || RESET_SENTINEL

  const { error } = await supabase.auth.signInWithPassword({ email, password: tryPassword })

  if (error) {
    const msg = password
      ? '이메일 또는 비밀번호가 올바르지 않습니다'
      : '이메일 또는 비밀번호가 올바르지 않습니다. 비밀번호를 입력해주세요'
    redirect('/login?error=' + encodeURIComponent(msg))
  }

  redirect('/dashboard')
}
