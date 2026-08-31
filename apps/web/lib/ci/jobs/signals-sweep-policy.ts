// lib/ci/jobs/signals-sweep-policy.ts — 이슈 훑기 주기 정책 (순수 함수)
//
// DB 를 임포트하지 않는다. 「언제 다시 훑을까」는 DB 없이 판정할 수 있는 규칙이라
// 여기 두면 실제 호출 없이 검증할 수 있다(channel-sweep-policy·snapshot-policy와 같은 이유).

/** 한 틱에 거는 훑기 수. 웹 검색은 5~40초라 한 번에 여러 개를 걸면 크론 예산을 먹는다. */
export const SIGNAL_SWEEP_MAX_PER_TICK = 1

/**
 * 설정을 못 읽었을 때 쓰는 주기.
 *
 * 12시간인 이유: 뉴스는 하루 단위로 바뀌지만, 웹 검색을 켠 호출은 **키 단위 한도**를
 * 쓴다(실측 2026-08-24: google_search 를 켜면 일반 호출과 다른 바구니에서 429가 난다).
 * 그 한도는 회의노트·GPU·AI채팅·CRM 이 함께 쓴다 — 이슈 하나가 다 태우면 넷이 같이 죽는다.
 */
export const DEFAULT_SIGNAL_INTERVAL_HOURS = 12

const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 168

/** 범위를 벗어난 값은 기본값으로. 0을 저장해 두면 매 틱마다 훑어 한도를 태운다. */
export function normalizeSignalIntervalHours(raw: unknown): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < MIN_INTERVAL_HOURS || n > MAX_INTERVAL_HOURS) {
    return DEFAULT_SIGNAL_INTERVAL_HOURS
  }
  return n
}

/** 지금 다시 훑어야 하나. 한 번도 안 훑었으면 훑는다. */
export function isSignalSweepDue(
  lastSweepAt: string | null | undefined,
  intervalHours: number,
  now: number = Date.now(),
): boolean {
  if (!lastSweepAt) return true
  const t = Date.parse(lastSweepAt)
  // 시각이 깨져 있으면 훑는다 — 판정 불가를 «안 훑음»으로 두면 영영 멈춘다
  if (!Number.isFinite(t)) return true
  return now - t >= intervalHours * 3600_000
}

export interface DueSignalSweepResult {
  due: number
  enqueued: number
}
