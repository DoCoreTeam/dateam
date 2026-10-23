'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SESSION_ONLY_COOKIE, wantsPersistentLogin } from '@/lib/auth/session-persistence'
import { throttleLoginAttempt, logLoginFailure } from '@/lib/auth/login-attempts'

// 로그인 폼 상태(useActionState) — 에러를 URL(?error=)이 아닌 컴포넌트 상태로 전달.
// URL에 싣지 않으므로 새로고침/북마크/뒤로가기 시 에러가 재출현하지 않는다(1회성).
export interface SignInState {
  error?: string
  /** 실패 시 이메일 prefill 용 */
  email?: string
  /** 실패 시 「로그인 상태 유지」 선택을 되살린다 */
  remember?: boolean
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = (formData.get('email') as string)?.trim()
  const password = (formData.get('password') as string) ?? ''
  const remember = wantsPersistentLogin(formData.get('remember'))

  if (!email) {
    return { error: '이메일을 입력해주세요' }
  }

  /**
   * 빈 비밀번호는 인증 서버에 보내지 않는다.
   *
   * 예전에는 빈칸이면 코드에 적힌 공용 초기화 비밀번호로 대신 로그인했다.
   * 초기화 상태 계정은 전부 그 비밀번호였으므로 이메일만 알면 들어올 수 있었다(감사 2026-10-23).
   * 이제 초기화는 사람마다 다른 임시 비밀번호를 관리자에게 보여 준다(lib/auth/temp-password).
   */
  if (!password) {
    return { error: '비밀번호를 입력해주세요', email, remember }
  }

  /**
   * 너무 자주 틀리면 잠시 막는다.
   *
   * 왜 필요한가: Supabase 가 로그인 기록을 남기는 표는 **0행**이었다(실측 2026-09-20).
   * 즉 비밀번호를 몇 번 찔러 봤는지 우리는 알 방법이 없었다.
   * 한도는 이미 있는 부품(public_request_throttle)을 그대로 쓴다 — 새 표를 만들지 않는다.
   *
   * 보낸 곳 기준과 이메일 기준 두 바구니로 센다(lib/auth/login-gate).
   * 한도를 못 재면 거절한다, 열어 두면 DB 를 흔드는 것만으로 대입 방어가 꺼진다.
   */
  const gate = await throttleLoginAttempt(email)
  if (!gate.allowed) {
    await logLoginFailure(email, gate.reason)
    const minutes = Math.ceil(gate.retryAfterSeconds / 60)
    return {
      error: gate.reason === 'unavailable'
        ? `지금 로그인을 확인할 수 없습니다. ${minutes}분 후 다시 시도해 주세요`
        : `로그인 시도가 너무 잦습니다. ${minutes}분 후 다시 시도해 주세요`,
      email,
      remember,
    }
  }

  // 인증 쿠키를 쓰기 전에 고른 값을 넘긴다, 같은 요청 안이라 선호 쿠키를 다시 읽지 않는다
  const supabase = await createClient({ sessionOnly: !remember })

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    await logLoginFailure(email, 'bad_credentials')
    // 실패 시 이메일을 되돌려 prefill — 사용자는 비밀번호만 다시 입력
    return { error: '이메일 또는 비밀번호가 올바르지 않습니다', email, remember }
  }

  /**
   * 선호 쿠키는 성공한 뒤에만 쓴다. 「유지 안 함」이면 이 쿠키도 세션 쿠키라
   * 브라우저를 닫으면 인증 쿠키와 같이 사라진다. 유지면 지운다(없음이 기본값인 유지).
   */
  const cookieStore = await cookies()
  if (remember) {
    cookieStore.delete(SESSION_ONLY_COOKIE)
  } else {
    cookieStore.set(SESSION_ONLY_COOKIE, '1', { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
  }

  /**
   * 2단계를 등록한 사람은 코드 화면으로 곧장 보낸다.
   *
   * 미들웨어도 같은 판정을 해서 내용은 어차피 안 새지만, 여기서 안 보내면
   * **주소창은 /dashboard 인데 화면은 코드 입력창**이 된다(실측).
   * 주소와 화면이 다른 말을 하면 사람은 자기가 어디 있는지 모른다.
   */
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') redirect('/mfa')

  redirect('/dashboard')
}
