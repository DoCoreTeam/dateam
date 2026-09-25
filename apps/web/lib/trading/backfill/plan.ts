/**
 * 백필 계획 — **무엇을 아직 안 받았나** (순수 함수)
 *
 * ## 왜 계획을 따로 세우나
 *
 * KIS 분봉은 한 번에 102건이다. 한 달치를 받으려면 수백 번을 이어 물어야 하고,
 * 이어 조회는 **끝나는 조건이 틀리면 영원히 안 끝난다** — 같은 구간을 계속 다시 받는다.
 * 그래서 「다음에 어디를 물을까」를 순수 함수로 떼어 시험할 수 있게 한다.
 *
 * ## 빈 구간과 안 받은 구간은 다르다
 *
 * 봉이 0건인 구간에는 두 가지가 있다: **시장이 쉰 것**과 **아직 안 받은 것**.
 * 둘을 같게 다루면 휴장일을 영원히 다시 받거나, 못 받은 구간을 휴장으로 착각한다.
 * 그래서 「받아 봤다」는 사실을 따로 센다.
 */

/** 이미 가지고 있는 봉의 시작 시각들 */
export interface HeldBars {
  /** 정렬돼 있지 않아도 된다 */
  startAtMs: readonly number[]
}

export interface BackfillWindow {
  /** 포함 */
  fromMs: number
  /** 제외 */
  toMs: number
}

export interface BackfillChunk {
  /** 이 시각 이전을 물어본다 (KIS 는 최신순으로 준다) */
  untilMs: number
  /** 이 시각까지만 필요하다 */
  fromMs: number
}

const MINUTE_MS = 60_000

/** KIS 분봉 1회 상한 (명세 §20) */
export const MAX_BARS_PER_CALL = 102

/**
 * 아직 안 받은 구간들.
 *
 * 가진 봉 사이의 **구멍**만 돌려준다. 이미 있는 자리를 다시 물으면 그만큼 느려지고
 * KIS 호출 한도를 그만큼 낭비한다.
 */
export function missingRanges(window: BackfillWindow, held: HeldBars): BackfillWindow[] {
  const have = new Set(held.startAtMs)
  const gaps: BackfillWindow[] = []
  let runStart: number | null = null

  for (let t = window.fromMs; t < window.toMs; t += MINUTE_MS) {
    if (have.has(t)) {
      if (runStart !== null) { gaps.push({ fromMs: runStart, toMs: t }); runStart = null }
      continue
    }
    if (runStart === null) runStart = t
  }
  if (runStart !== null) gaps.push({ fromMs: runStart, toMs: window.toMs })
  return gaps
}

/**
 * 한 구간을 102건씩 끊는다 — **뒤에서 앞으로**.
 *
 * KIS 가 「이 시각 이전」을 최신순으로 주므로 끝에서부터 물어야 이어진다.
 * 각 조각의 `untilMs` 는 반드시 **앞 조각보다 작아진다** — 안 그러면 안 끝난다.
 */
export function chunkRange(range: BackfillWindow): BackfillChunk[] {
  const chunks: BackfillChunk[] = []
  let until = range.toMs
  // 상한을 둔다. 계산이 틀려 안 줄어들면 여기서 멈추고 그 사실이 드러난다
  for (let i = 0; i < 10_000 && until > range.fromMs; i += 1) {
    const from = Math.max(range.fromMs, until - MAX_BARS_PER_CALL * MINUTE_MS)
    chunks.push({ untilMs: until, fromMs: from })
    until = from
  }
  return chunks
}

/** 이 구간을 채우려면 몇 번 물어야 하나. 화면이 진행을 말할 수 있게 */
export function plannedCallCount(window: BackfillWindow, held: HeldBars): number {
  return missingRanges(window, held).reduce((sum, r) => sum + chunkRange(r).length, 0)
}

export type ChunkOutcome =
  /** 봉을 받았다 */
  | { kind: 'filled'; count: number }
  /** 물어봤는데 0건이었다 — 시장이 쉰 구간이다 */
  | { kind: 'empty' }
  /** 못 물어봤다 */
  | { kind: 'failed'; reason: string }

export interface BackfillProgress {
  planned: number
  filled: number
  emptyChunks: number
  failed: number
  barsSaved: number
}

/**
 * 계속 물어도 되나.
 *
 * **실패가 이어지면 멈춘다.** 한도에 걸렸거나 토큰이 죽은 상태에서 수백 번을 더 물으면
 * 그만큼 더 막히고, 그 사이 실시간 수집까지 같이 죽는다.
 */
export function shouldContinue(progress: BackfillProgress, maxFailures: number): boolean {
  return progress.failed < maxFailures
}
