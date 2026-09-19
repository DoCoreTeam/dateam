import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * 로그인 없이 부를 수 있는 창구의 속도 제한
 *
 * 키로 부르는 공개 API 는 분당 한도가 있다(lib/publicApiAuth). 키가 필요 없는 창구에는
 * 아무것도 없었다 — 아무나 몇 번이든 관리자 대기열에 행을 쌓을 수 있었다.
 *
 * 세는 일은 DB 가 한다(마이그 260). Vercel 은 서버리스라 프로세스 메모리 카운터가
 * 성립하지 않는다 — 인스턴스가 여럿이면 각자 0부터 센다.
 */

/** 창구 하나가 한 시간에 받을 수 있는 횟수 */
const DEFAULT_LIMIT = 5
const DEFAULT_WINDOW_SECONDS = 3600

export type ThrottleVerdict =
  | { allowed: true; hits: number; limit: number }
  | { allowed: false; hits: number; limit: number; retryAfterSeconds: number }

/**
 * 요청을 보낸 쪽을 가려낸다.
 *
 * Vercel 은 x-forwarded-for 맨 앞에 진짜 클라이언트 주소를 넣는다. 뒤쪽 값은
 * 중간 프록시가 붙인 것이라 믿지 않는다.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * 바구니 이름을 만든다 — **주소 원본은 DB 에 남기지 않는다.**
 *
 * 소금은 서비스롤 키에서 가져온다. 새 환경변수를 만들지 않기 위해서다(설정은 DB·UI 로).
 * 키가 바뀌면 바구니 이름도 바뀌어 한도가 한 번 초기화되는데, 그 정도는 감수한다.
 */
function bucketFor(surface: string, identifier: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const digest = createHash('sha256').update(`${salt}:${identifier}`).digest('hex').slice(0, 32)
  return `${surface}:${digest}`
}

/**
 * 호출 1건을 기록하고 한도를 넘었는지 판정한다.
 *
 * 기록이 실패하면 **통과시킨다** — 계측이 사용자의 일을 막으면 안 된다(223 과 같은 규칙).
 */
export async function throttlePublicRequest(
  surface: string,
  request: Request,
  options?: { limit?: number; windowSeconds?: number },
): Promise<ThrottleVerdict> {
  const limit = options?.limit ?? DEFAULT_LIMIT
  const windowSeconds = options?.windowSeconds ?? DEFAULT_WINDOW_SECONDS

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('record_public_hit', {
    p_bucket: bucketFor(surface, clientIp(request)),
    p_window_seconds: windowSeconds,
  })

  if (error) {
    console.error('[throttlePublicRequest]', surface, error)
    return { allowed: true, hits: 0, limit }
  }

  const row = Array.isArray(data) ? data[0] : data
  const hits: number = row?.out_hits ?? 0
  if (hits <= limit) return { allowed: true, hits, limit }

  const startedAt = row?.out_window_start ? new Date(row.out_window_start).getTime() : Date.now()
  const retryAfterSeconds = Math.max(1, Math.ceil((startedAt + windowSeconds * 1000 - Date.now()) / 1000))
  return { allowed: false, hits, limit, retryAfterSeconds }
}
