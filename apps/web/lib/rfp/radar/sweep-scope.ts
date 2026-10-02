/**
 * 수집이 보는 범위
 *
 * ## 무엇이 잘못돼 있었나
 *
 * 거르기가 `rfp_sources` 를 **최근 500건만** 읽었다. 실측 2026-10-01: 공고 567건이라
 * 옛 67건은 어떤 규칙에도 안 걸렸다. 규칙을 새로 만들어도 **그 전에 들어온 공고에는
 * 영영 안 걸린다** — 사용자는 「규칙이 안 먹는다」로 읽는다.
 *
 * ## 왜 한 번에 다 안 읽나
 *
 * 공고는 계속 쌓인다. 한 요청이 전부를 읽으려 들면 어느 날부터 그 요청이 죽고,
 * 죽으면 **아무것도 안 걸린다.** 그래서 한 번에 읽는 양을 정해 두고 **나눠 돈다.**
 *
 * 쪽을 나누는 것과 다른 점: 여기는 사람이 보는 목록이 아니라 기계가 훑는 범위다.
 * 못 본 쪽이 남으면 다음 번에 그 자리부터 이어 간다.
 */

/** 한 번에 읽는 공고 수 */
export const SWEEP_BATCH = 500

/** 한 번의 수집에서 돌 최대 쪽 수. 넘으면 다음 수집이 이어 간다 */
export const MAX_BATCHES = 10

export interface SweepRange {
  offset: number
  limit: number
}

/**
 * 이번 수집이 돌 범위들.
 *
 * 전체를 batch 크기로 나눈다. 상한을 넘으면 거기서 끊고, 끊긴 사실은 부르는 쪽이 안다.
 */
export function sweepRanges(totalSources: number, batch = SWEEP_BATCH, maxBatches = MAX_BATCHES): SweepRange[] {
  if (totalSources <= 0) return []
  const need = Math.ceil(totalSources / batch)
  const rounds = Math.min(need, maxBatches)
  return Array.from({ length: rounds }, (_, i) => ({ offset: i * batch, limit: batch }))
}

/** 이번에 다 못 봤나 — 못 봤으면 화면이 그 사실을 말해야 한다 */
export function sweepTruncated(totalSources: number, batch = SWEEP_BATCH, maxBatches = MAX_BATCHES): boolean {
  return Math.ceil(totalSources / batch) > maxBatches
}
