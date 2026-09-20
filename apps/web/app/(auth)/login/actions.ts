'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { throttleLoginAttempt, logLoginFailure } from '@/lib/auth/login-attempts'

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

  /**
   * 같은 곳에서 너무 자주 틀리면 잠시 막는다.
   *
   * 왜 필요한가: Supabase 가 로그인 기록을 남기는 표는 **0행**이었다(실측 2026-09-20).
   * 즉 비밀번호를 몇 번 찔러 봤는지 우리는 알 방법이 없었다.
   * 한도는 이미 있는 부품(public_request_throttle)을 그대로 쓴다 — 새 표를 만들지 않는다.
   *
   * 이메일이 아니라 **보낸 곳** 기준이다. 이메일 기준이면 남의 계정을 골라
   * 일부러 틀려서 그 사람을 잠글 수 있다.
   */
  const gate = await throttleLoginAttempt()
  if (!gate.allowed) {
    await logLoginFailure(email, 'rate_limited')
    return {
      error: `로그인 시도가 너무 잦습니다. ${Math.ceil(gate.retryAfterSeconds / 60)}분 후 다시 시도해 주세요`,
      email,
    }
  }

  const supabase = await createClient()

  // 비밀번호 빈칸 → 센티넬로 시도 (PW초기화된 계정인지 확인)
  const tryPassword = password || RESET_SENTINEL

  const { error } = await supabase.auth.signInWithPassword({ email, password: tryPassword })

  if (error) {
    await logLoginFailure(email, password ? 'bad_credentials' : 'password_required')
    // 빈 비밀번호로 시도(센티넬) 실패 = 비밀번호가 설정된 계정이거나 이메일 오류.
    // 다음 행동(비밀번호 입력)을 앞세워 안내. 비밀번호를 넣고도 실패하면 자격증명 오류로 안내.
    const msg = password
      ? '이메일 또는 비밀번호가 올바르지 않습니다'
      : '비밀번호가 필요한 계정입니다. 비밀번호를 입력해 주세요'
    // 실패 시 이메일을 되돌려 prefill — 사용자는 비밀번호만 다시 입력
    return { error: msg, email }
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
