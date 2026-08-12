// lib/ci/jobs/snapshot-policy.ts — 지표 스냅샷 간격 정책 (설계서 §13 "스냅샷 비용 폭증")
//
// 왜 나이별 간격인가:
// "관심 채널 100곳 × 추적 30건 × 일 4회면 하루 12,000건. 사용자 수에 선형 비례."
// 모든 콘텐츠를 같은 주기로 찍으면 원가가 요금제를 잡아먹는다.
// 지표가 실제로 움직이는 구간(게시 직후)만 촘촘히 찍고, 늙으면 성글게, 더 늙으면 멈춘다.
//
// 여기는 순수 함수만 둔다(DB 임포트 금지 — 그래야 단위 테스트가 붙는다).
// DB 조작은 snapshot.ts가 맡는다.

export type SnapshotPreset = 'economy' | 'standard' | 'precise'

const HOUR = 3600
const DAY = 24 * HOUR

/** 추적을 멈추는 나이(일). 이보다 늙으면 지표가 거의 움직이지 않는다. */
export const SNAPSHOT_STOP_AFTER_DAYS = 30

/**
 * 나이별 간격(초).
 *
 * economy는 무료 구간 기본값이라 "하루 한 번"이 상한이다.
 * 설계서 §8.4: 계속 지켜보는 것(모니터링·스냅샷·알림)에 과금한다.
 */
const LADDER: Record<SnapshotPreset, { maxAgeHours: number; intervalSec: number }[]> = {
  economy: [
    { maxAgeHours: 24, intervalSec: 1 * DAY },
    { maxAgeHours: 7 * 24, intervalSec: 2 * DAY },
    { maxAgeHours: SNAPSHOT_STOP_AFTER_DAYS * 24, intervalSec: 7 * DAY },
  ],
  standard: [
    { maxAgeHours: 24, intervalSec: 6 * HOUR },
    { maxAgeHours: 7 * 24, intervalSec: 12 * HOUR },
    { maxAgeHours: SNAPSHOT_STOP_AFTER_DAYS * 24, intervalSec: 1 * DAY },
  ],
  precise: [
    { maxAgeHours: 24, intervalSec: 1 * HOUR },
    { maxAgeHours: 7 * 24, intervalSec: 6 * HOUR },
    { maxAgeHours: SNAPSHOT_STOP_AFTER_DAYS * 24, intervalSec: 1 * DAY },
  ],
}

/**
 * 이 나이의 콘텐츠를 얼마 간격으로 찍을 것인가.
 * 추적 종료 나이를 넘기면 null — "간격 0"이 아니라 "찍지 않는다"이다.
 */
export function snapshotIntervalSec(preset: SnapshotPreset, ageHours: number): number | null {
  if (!Number.isFinite(ageHours) || ageHours < 0) return null
  for (const step of LADDER[preset]) {
    if (ageHours < step.maxAgeHours) return step.intervalSec
  }
  return null
}

/** 콘텐츠 나이(시간). 게시 시각을 모르면 수집 시각으로 대신한다. */
export function contentAgeHours(
  publishedAt: string | null,
  firstSeenAt: string,
  now: Date = new Date(),
): number | null {
  const base = Date.parse(publishedAt ?? firstSeenAt)
  if (!Number.isFinite(base)) return null
  return Math.max(0, (now.getTime() - base) / (HOUR * 1000))
}

export interface SnapshotPlan {
  intervalSec: number
  nextCaptureAt: string
  stopAfter: string
}

/**
 * 다음 촬영 계획. 추적 대상이 아니면 null.
 * 종료 시각을 항상 함께 못 박는다 — 끝이 없는 스케줄은 요금 폭탄의 다른 이름이다.
 */
export function planNextCapture(input: {
  preset: SnapshotPreset
  publishedAt: string | null
  firstSeenAt: string
  now?: Date
}): SnapshotPlan | null {
  const now = input.now ?? new Date()
  const age = contentAgeHours(input.publishedAt, input.firstSeenAt, now)
  if (age === null) return null

  const intervalSec = snapshotIntervalSec(input.preset, age)
  if (intervalSec === null) return null

  const base = Date.parse(input.publishedAt ?? input.firstSeenAt)
  return {
    intervalSec,
    nextCaptureAt: new Date(now.getTime() + intervalSec * 1000).toISOString(),
    stopAfter: new Date(base + SNAPSHOT_STOP_AFTER_DAYS * DAY * 1000).toISOString(),
  }
}
