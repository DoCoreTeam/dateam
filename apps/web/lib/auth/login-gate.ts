// lib/auth/login-gate.ts — 로그인 시도 한도 판정 (DB 를 모르는 계산 모듈)
//
// 세는 일은 lib/public-rate-limit 의 recordPublicHit 이 하고, 여기서는 결과만 판정한다.
// server-only 를 안 불러 node --test 가 직접 읽는다.

/** 보낸 곳 기준: 한 곳에서 10분에 10회 */
export const ORIGIN_LIMIT = { limit: 10, windowSeconds: 600 } as const
/**
 * 이메일 기준: 한 계정에 1시간 20회
 *
 * 보낸 곳을 바꿔 가며 한 계정을 찌르면 보낸 곳 한도로는 안 막힌다.
 * 이메일로 세면 남이 일부러 틀려서 그 계정을 잠글 수 있으므로 한도를 넉넉히 두고 창을 한 시간으로 끊는다.
 */
export const EMAIL_LIMIT = { limit: 20, windowSeconds: 3600 } as const
/** 세기가 실패했을 때 다시 해 보라고 할 시간 */
export const UNAVAILABLE_RETRY_SECONDS = 60

export type HitResult =
  | { ok: true; hits: number; windowStartMs: number | null }
  | { ok: false }

export type LoginGate =
  | { allowed: true }
  | { allowed: false; reason: 'rate_limited' | 'unavailable'; retryAfterSeconds: number }

export type HitRecorder = (
  key: 'origin' | 'email',
  identifier: string,
  windowSeconds: number,
) => Promise<HitResult>

/** 대소문자와 앞뒤 공백만 다른 이메일은 같은 계정이다 */
export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase()
}

function retryAfter(windowStartMs: number | null, windowSeconds: number, nowMs: number): number {
  const start = windowStartMs ?? nowMs
  return Math.max(1, Math.ceil((start + windowSeconds * 1000 - nowMs) / 1000))
}

/**
 * 보낸 곳과 이메일 두 바구니에 1회씩 세고 판정한다.
 *
 * 세기가 하나라도 실패하면 **거절한다(닫힘).** 한도를 못 재는 동안 열어 두면
 * DB 를 흔드는 것만으로 대입 방어가 꺼진다.
 */
export async function gateLogin(
  record: HitRecorder,
  origin: string,
  email: string,
  nowMs: number = Date.now(),
): Promise<LoginGate> {
  const [byOrigin, byEmail] = await Promise.all([
    record('origin', origin, ORIGIN_LIMIT.windowSeconds).catch((): HitResult => ({ ok: false })),
    record('email', normalizeLoginEmail(email), EMAIL_LIMIT.windowSeconds).catch((): HitResult => ({ ok: false })),
  ])
  if (!byOrigin.ok || !byEmail.ok) {
    return { allowed: false, reason: 'unavailable', retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS }
  }

  const over = [
    byOrigin.hits > ORIGIN_LIMIT.limit ? retryAfter(byOrigin.windowStartMs, ORIGIN_LIMIT.windowSeconds, nowMs) : 0,
    byEmail.hits > EMAIL_LIMIT.limit ? retryAfter(byEmail.windowStartMs, EMAIL_LIMIT.windowSeconds, nowMs) : 0,
  ]
  const wait = Math.max(...over)
  return wait > 0 ? { allowed: false, reason: 'rate_limited', retryAfterSeconds: wait } : { allowed: true }
}
