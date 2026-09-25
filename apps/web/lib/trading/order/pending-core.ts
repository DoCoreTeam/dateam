/**
 * 낼 주문을 고르는 규칙 — **순수 계산**
 *
 * 질의는 `pending.ts` 가 하고, 「어느 것을 고르나」는 여기서 정한다.
 * 고르는 규칙이 질의문 안에 섞여 있으면 시험이 DB 없이 못 묻는다.
 */

export interface SignalRow {
  id: string
  contractCode: string
  direction: 'long' | 'short'
}

/**
 * 아직 주문 안 낸 신호 중 **가장 최근 것** 하나.
 *
 * 신호는 최신 순으로 들어온다. 오래된 것부터 내면 그때 가격이 아닌 값으로 들어가고,
 * 여러 개를 한 번에 내면 1계약 규칙이 깨진다.
 */
export function pickPendingEntry(
  signals: readonly SignalRow[], alreadyOrdered: ReadonlySet<string>,
): SignalRow | null {
  return signals.find((s) => !alreadyOrdered.has(s.id)) ?? null
}

/** 서울 날짜 하나로 접는다. 같은 날 여러 번 주문해도 하루다 */
export function seoulDaysOf(times: readonly string[]): number {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })
  const days = new Set<string>()
  for (const at of times) {
    const parsed = Date.parse(at)
    // 시각을 못 읽은 줄은 안 센다 — 못 읽은 것을 하루로 세면 실적이 부풀어 관문이 일찍 열린다
    if (!Number.isFinite(parsed)) continue
    days.add(format.format(new Date(parsed)))
  }
  return days.size
}

/** 주문이 실제로 나간 상태들. `pending` 은 낼 준비만 한 것이라 실적이 아니다 */
export const PLACED_STATUSES = ['sent', 'unknown'] as const

/**
 * 관문이 읽을 값을 못 읽었을 때 무엇으로 두나.
 *
 * **막는 쪽이다.** 읽기가 실패했다고 통과시키면 DB 가 흔들리는 날 자동 주문이 열리고,
 * 그때가 가장 열면 안 되는 때다.
 */
export const BLOCKING_FALLBACK = {
  gate: { passed: false, insufficient: 1 },
  paperAutoDays: 0,
  /** 0 은 「오늘 실패 없음」이라는 허가다. 모르면 1 */
  gateFailCount: 1,
} as const
