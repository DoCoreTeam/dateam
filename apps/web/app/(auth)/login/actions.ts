'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// PW초기화된 계정의 센티넬 비밀번호 — admin/users/actions.ts와 동일해야 함
const RESET_SENTINEL = 'AX_RESET_REQUIRED_2024!'

// 로그인 폼 상태(useActionState) — 에러를 URL(?error=)이 아닌 컴포넌트 상태로 전달.
// URL에 싣지 않으므로 새로고침/북마크/뒤로가기 시 에러가 재출현하지 않는다(1회성).
export interface SignInState {
  error?: string
  /** 실패 시 이메일 prefill 용 */
  email?: string
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = (formData.get('email') as string)?.trim()
  const password = (formData.get('password') as string) ?? ''

  if (!email) {
    return { error: '이메일을 입력해주세요' }
  }

  const supabase = await createClient()

  // 비밀번호 빈칸 → 센티넬로 시도 (PW초기화된 계정인지 확인)
  const tryPassword = password || RESET_SENTINEL

  const { error } = await supabase.auth.signInWithPassword({ email, password: tryPassword })

  if (error) {
    const msg = password
      ? '이메일 또는 비밀번호가 올바르지 않습니다'
      : '이메일 또는 비밀번호가 올바르지 않습니다. 비밀번호를 입력해주세요'
    // 실패 시 이메일을 되돌려 prefill — 사용자는 비밀번호만 다시 입력
    return { error: msg, email }
  }

  redirect('/dashboard')
}
