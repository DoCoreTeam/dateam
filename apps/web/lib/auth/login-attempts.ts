import 'server-only'
import { headers } from 'next/headers'
import { recordSystemEvent } from '@/lib/system-log/record'
import { throttlePublicRequest, clientIp } from '@/lib/public-rate-limit'
import { maskEmail } from './mask-email.ts'

export { maskEmail }

/**
 * 로그인 시도를 세고 남긴다
 *
 * **왜**: 실측 2026-09-20 — Supabase 가 로그인 기록을 남기는 `auth.audit_log_entries` 는
 * **0행**이었다. 비밀번호를 몇 번 찔러 봤는지 우리는 알 수 없었고, 그래서
 * 「그런 일이 있었나」조차 답할 수 없었다.
 *
 * **왜 이메일이 아니라 보낸 곳 기준인가**: 이메일로 세면 남의 계정을 골라 일부러
 * 틀려서 **그 사람을 잠글 수 있다.** 보낸 곳으로 세면 찔러 보는 쪽만 막힌다.
 *
 * **왜 새 표를 안 만드나**: 한도는 익명 창구용으로 만들어 둔 `public_request_throttle` 을
 * 바구니 이름만 바꿔 그대로 쓴다. 기록은 **시스템 로그**에 남긴다 —
 * `activity_log` 는 user_id·actor_id 가 NOT NULL 이라 «누구인지 모르는 실패»를 담을 수 없다(실측).
 * 로그인 실패는 사람의 활동이 아니라 **운영 사건**이고, 시스템 로그에는 보는 화면이 이미 있다.
 */

/** 같은 곳에서 이 창 동안 받을 횟수 */
const LOGIN_WINDOW_SECONDS = 600
const LOGIN_MAX_ATTEMPTS = 10

export type LoginGate =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/** 요청 헤더에서 Request 를 만든다 — 서버 액션에는 Request 객체가 없다. */
async function requestLike(): Promise<Request> {
  const h = await headers()
  return new Request('http://internal/login', { headers: h })
}

/** 시도 1회를 세고 한도를 넘었는지 본다. 세기가 실패하면 통과시킨다. */
export async function throttleLoginAttempt(): Promise<LoginGate> {
  const verdict = await throttlePublicRequest('login', await requestLike(), {
    limit: LOGIN_MAX_ATTEMPTS,
    windowSeconds: LOGIN_WINDOW_SECONDS,
  })
  return verdict.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: verdict.retryAfterSeconds }
}

/**
 * 실패한 시도를 남긴다.
 *
 * 이메일은 **가려서** 적는다. 로그를 보는 사람이 누구 계정이 찔렸는지는 알아야 하지만,
 * 기록 자체가 계정 목록이 되면 안 된다.
 *
 * 기록이 실패해도 로그인 흐름은 그대로 간다 — 계측이 사람의 일을 막지 않는다.
 */
export async function logLoginFailure(
  email: string,
  reason: 'bad_credentials' | 'password_required' | 'rate_limited',
): Promise<void> {
  try {
    const h = await headers()
    await recordSystemEvent({
      source: 'client',
      route: '/login',
      feature: 'auth.login',
      // 사용자가 지금 못 들어가고 있다 — 한도에 걸린 경우만 그렇다
      blocksUser: reason === 'rate_limited',
      error: `로그인 실패(${reason}): ${maskEmail(email)}`,
      hint: reason,
      context: {
        reason,
        email: maskEmail(email),
        origin: hashedOrigin(clientIp(new Request('http://internal', { headers: h }))),
        userAgent: (h.get('user-agent') ?? '').slice(0, 120),
      },
    })
  } catch (e) {
    console.error('[login-attempts] 기록 실패', e)
  }
}

/** 주소 원본은 남기지 않는다. 같은 곳에서 온 것인지만 알면 된다. */
function hashedOrigin(ip: string): string {
  let h = 0
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) | 0
  return `ip:${(h >>> 0).toString(36)}`
}
