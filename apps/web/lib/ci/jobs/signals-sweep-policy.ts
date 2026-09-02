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

/**
 * **한도에 막혔을 때만** 쓰는 짧은 주기.
 *
 * 왜 따로 두는가(실측 2026-09-02): 구글은 429 응답에 `retry-after` 도 초기화 시각도 주지 않는다.
 * 즉 **언제 풀리는지 알 방법이 없다.** 그런데 정상 주기(12시간)로 기다리면 이미 풀린 한도를
 * 최대 12시간 동안 모르고 지나간다 — 사용자에게는 「종일 아무것도 안 담기는」 상태다.
 *
 * 그래서 막혔을 때는 자주 찔러본다. 비용은 429 응답 하나(토큰 0)라 정상 호출보다 싸고,
 * 풀린 순간을 1시간 안에 잡는다. 「기다리세요」를 **기다리지 않아도 되는 것**으로 바꾸는 장치다.
 */
export const BLOCKED_RETRY_INTERVAL_HOURS = 1

/**
 * 이번에 쓸 주기. 마지막 시도가 한도에 막혔으면 짧게, 아니면 설정대로.
 * 설정값이 이미 더 짧으면 그것을 존중한다 — 정책이 사용자 설정을 늘리지 않는다.
 */
export function effectiveSignalIntervalHours(
  configuredHours: number,
  lastFailedByQuota: boolean,
): number {
  if (!lastFailedByQuota) return configuredHours
  return Math.min(configuredHours, BLOCKED_RETRY_INTERVAL_HOURS)
}

/**
 * 「다음 자동 시도」 시각(ISO). 화면이 «언제 다시 해보는지»를 말할 수 있어야
 * 사용자가 기다릴지 손을 쓸지 정할 수 있다. 한 번도 안 훑었으면 지금이 그 시각이다.
 */
export function nextSignalSweepAt(
  lastSweepAt: string | null | undefined,
  intervalHours: number,
  now: number = Date.now(),
): string {
  if (!lastSweepAt) return new Date(now).toISOString()
  const t = Date.parse(lastSweepAt)
  if (!Number.isFinite(t)) return new Date(now).toISOString()
  return new Date(Math.max(now, t + intervalHours * 3600_000)).toISOString()
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
