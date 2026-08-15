// lib/ci/jobs/channel-sweep-policy.ts — 재훑기 주기 정책 (순수 함수)
//
// DB 클라이언트를 임포트하지 않는다. `@/` 별칭이 테스트 러너에서 안 풀려서만이 아니라,
// "언제 다시 훑을까"는 DB 없이 판정할 수 있는 규칙이기 때문이다(snapshot-policy와 같은 이유).

/** 한 번에 거는 재훑기 수. 채널이 많아도 한 틱이 큐를 독점하지 않게. */
export const SWEEP_DUE_MAX_PER_TICK = 5

/** 설정을 못 읽었을 때 쓰는 주기. registry의 defaultValue와 같은 값이다. */
export const DEFAULT_REFRESH_INTERVAL_HOURS = 24

const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 168

export interface DueSweepResult {
  due: number
  enqueued: number
}

/**
 * 워크스페이스의 재훑기 주기(시간). 범위를 벗어난 값은 기본값으로 떨어뜨린다 —
 * 0을 저장해 두면 매 틱마다 전 채널을 훑어 외부 쿼터를 태운다.
 */
export function normalizeIntervalHours(raw: unknown): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < MIN_INTERVAL_HOURS || n > MAX_INTERVAL_HOURS) {
    return DEFAULT_REFRESH_INTERVAL_HOURS
  }
  return n
}

/** 이 채널을 지금 다시 훑어야 하나. 한 번도 안 훑었으면 훑는다. */
export function isSweepDue(
  lastSweepAt: string | null | undefined,
  intervalHours: number,
  now: number = Date.now(),
): boolean {
  if (!lastSweepAt) return true
  const t = Date.parse(lastSweepAt)
  if (!Number.isFinite(t)) return true
  return now - t >= intervalHours * 3600_000
}
