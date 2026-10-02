/**
 * 실시간 현재가의 순수 규칙.
 *
 * 서버는 KIS 응답과 SSE payload 를 이 규칙으로 거르고, 화면은 같은 payload 를 다시
 * 검사한다. 양쪽이 따로 숫자 꼴을 정하면 서버는 보냈는데 화면이 버리거나, 반대로
 * 깨진 값이 형성 봉에 들어간다.
 */

export interface LivePricePayload {
  contractCode: string
  price: number
  observedAt: string
}

/** 설정이 깨져도 서버를 무한히 두드리지 않는다. */
export function livePricePushSeconds(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(10, Math.max(1, Math.floor(parsed)))
}

/**
 * 정상 나이는 밀어 주는 주기의 세 배, 멈춤은 열 배다.
 *
 * 1초 주기라면 3초부터 나이를 말하고 10초부터 멈췄다고 말한다. 네트워크 지터 한두 번을
 * 장애로 칠하지 않되, 예전 60/90초 문턱처럼 실제 단절을 1분 동안 숨기지도 않는다.
 */
export function livePriceAgeThresholds(pushSeconds: number): { fresh: number; stale: number } {
  const every = livePricePushSeconds(pushSeconds)
  return { fresh: every * 3, stale: every * 10 }
}

export function isLivePriceFresh(
  last: { observedAt: string } | null,
  now: Date,
  pushSeconds: number,
): boolean {
  if (!last || !Number.isFinite(now.getTime())) return false
  const observed = Date.parse(last.observedAt)
  if (!Number.isFinite(observed)) return false
  const ageMs = Math.max(0, now.getTime() - observed)
  return ageMs < livePricePushSeconds(pushSeconds) * 1_000
}

/** KIS 의 현재가 한 칸. 빈 문자열·0·음수·무한대는 가격이 아니다. */
export function priceFromKis(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** 브라우저까지 온 payload 를 다시 확인한다. */
export function parseLivePricePayload(value: unknown): LivePricePayload | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const contractCode = typeof row.contractCode === 'string' ? row.contractCode.trim() : ''
  const price = priceFromKis(row.price)
  const observedAt = typeof row.observedAt === 'string' ? row.observedAt : ''
  if (contractCode === '' || price === null || !Number.isFinite(Date.parse(observedAt))) return null
  return { contractCode, price, observedAt }
}

/** SSE 는 빈 줄 하나가 이벤트의 끝이다. 줄바꿈은 JSON 안에서 escape 된다. */
export function sseEvent(name: string, value: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`
}
