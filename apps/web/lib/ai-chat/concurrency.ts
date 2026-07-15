// 병렬 심층분석 워커풀용 동시성 유틸(SSOT). 순수 유틸 — 부작용 없음(타이머 제외).
// 기존 apps/web/lib/ai-chat/probe-models.ts의 mapWithConcurrency는 재시도/중단이 필요 없는
// 단순 케이스라 그대로 둔다(하위호환, 기존 import처 변경 없음). 재시도·백오프·중단이 필요한
// 신규 호출부(병렬 심층분석 등)는 이 모듈의 runWithConcurrency를 사용한다.

export interface RunOptions {
  /** 실패 시 재시도 횟수. 기본 0(재시도 없음). */
  retries?: number
  /** 지수 백오프 기준(ms). 1차 재시도 backoffMs, 2차 backoffMs*3, 3차 backoffMs*9 … 기본 500.
   *  (factor 3 — 부하 높은 러너에서 타이머 스케줄 지터[수십 ms]가 첫 짧은 간격에 절대값으로
   *   더해져도 연속 간격 비율이 무너지지 않도록 충분히 벌림) */
  backoffMs?: number
  /** 중단 신호. aborted 상태면 신규 착수를 중단한다. */
  signal?: AbortSignal
}

export type SettledResult<R> =
  | { ok: true; value: R }
  | { ok: false; error: Error }

function toError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(String(err))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runWithRetry<T, R>(
  item: T,
  index: number,
  worker: (item: T, index: number) => Promise<R>,
  retries: number,
  backoffMs: number,
): Promise<SettledResult<R>> {
  let attempt = 0
  while (true) {
    try {
      const value = await worker(item, index)
      return { ok: true, value }
    } catch (err) {
      if (attempt >= retries) {
        return { ok: false, error: toError(err) }
      }
      const delay = backoffMs * 3 ** attempt
      await sleep(delay)
      attempt += 1
    }
  }
}

/**
 * items를 limit 동시성으로 worker 실행. 순서 보존 결과 반환.
 * - worker가 throw하면 retries만큼 지수 백오프 후 재시도, 그래도 실패면 해당 항목에서
 *   throw를 되던지지 않고 결과 배열에 에러를 담아 반환(항목 1개 실패가 전체를 죽이지 않음).
 * - signal.aborted면 신규 착수를 중단한다(이미 진행 중인 항목은 완료까지 기다림).
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  opts: RunOptions = {},
): Promise<SettledResult<R>[]> {
  const retries = opts.retries ?? 0
  const backoffMs = opts.backoffMs ?? 500
  const signal = opts.signal

  const results: SettledResult<R>[] = new Array(items.length)
  if (items.length === 0) return results

  const workerCount = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  async function poolWorker(): Promise<void> {
    while (true) {
      if (signal?.aborted) return
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      results[i] = await runWithRetry(items[i], i, worker, retries, backoffMs)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => poolWorker()))
  return results
}
