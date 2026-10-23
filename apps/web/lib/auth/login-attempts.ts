import 'server-only'
import { headers } from 'next/headers'
import { recordSystemEvent } from '@/lib/system-log/record'
import { recordPublicHit, clientIp } from '@/lib/public-rate-limit'
import { gateLogin, type LoginGate } from './login-gate.ts'
import { maskEmail } from './mask-email.ts'

export { maskEmail }

/**
 * 로그인 시도를 세고 남긴다
 *
 * **왜**: 실측 2026-09-20 — Supabase 가 로그인 기록을 남기는 `auth.audit_log_entries` 는
 * **0행**이었다. 비밀번호를 몇 번 찔러 봤는지 우리는 알 수 없었고, 그래서
 * 「그런 일이 있었나」조차 답할 수 없었다.
 *
 * **왜 두 바구니인가**: 보낸 곳 기준(10분 10회)만 있으면 주소를 바꿔 가며 한 계정을 찌를 수 있다.
 * 그래서 이메일 기준(1시간 20회)을 더한다. 이메일로 세면 남이 일부러 틀려서 그 계정을 잠글 수 있으므로
 * 한도를 넉넉히 두고 창을 한 시간으로 끊는다. 판정은 lib/auth/login-gate.
 *
 * **왜 새 표를 안 만드나**: 한도는 익명 창구용으로 만들어 둔 `public_request_throttle` 을
 * 바구니 이름만 바꿔 그대로 쓴다. 기록은 **시스템 로그**에 남긴다 —
 * `activity_log` 는 user_id·actor_id 가 NOT NULL 이라 «누구인지 모르는 실패»를 담을 수 없다(실측).
 * 로그인 실패는 사람의 활동이 아니라 **운영 사건**이고, 시스템 로그에는 보는 화면이 이미 있다.
 */

export type { LoginGate }

/** 요청 헤더에서 Request 를 만든다 — 서버 액션에는 Request 객체가 없다. */
async function requestLike(): Promise<Request> {
  const h = await headers()
  return new Request('http://internal/login', { headers: h })
}

/** 시도 1회를 보낸 곳과 이메일 두 바구니에 세고 판정한다. 세기가 실패하면 거절한다. */
export async function throttleLoginAttempt(email: string): Promise<LoginGate> {
  const origin = clientIp(await requestLike())
  return gateLogin(
    (key, identifier, windowSeconds) => recordPublicHit(`login-${key}`, identifier, windowSeconds),
    origin,
    email,
  )
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
  reason: 'bad_credentials' | 'password_required' | 'rate_limited' | 'unavailable',
): Promise<void> {
  try {
    const h = await headers()
    await recordSystemEvent({
      source: 'client',
      route: '/login',
      feature: 'auth.login',
      // 사용자가 지금 못 들어가고 있다, 한도에 걸렸거나 한도를 못 재서 거절한 경우
      blocksUser: reason === 'rate_limited' || reason === 'unavailable',
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
