/**
 * 순차 큐 + 최소 간격 — **한 번에 하나씩, 너무 빠르지 않게**
 *
 * ## 왜 필요한가 (명세 §20)
 *
 * 한 번의 크론 실행이 분봉·시세·호가를 잇달아 부른다. 월물이 둘(정규·미니)이면 여섯이고,
 * 백필이 붙으면 수십이 된다. 그걸 한꺼번에 던지면 KIS 한도(계좌당 초당 약 18~20건)에 걸리고,
 * 걸린 뒤에는 **그 분의 봉이 통째로 빈다.**
 *
 * 한도보다 훨씬 낮은 간격(기본 200ms)으로 줄을 세운다. 분당 300건이면 1-A 에 충분히 넉넉하다.
 *
 * ## 왜 시계를 주입받나
 *
 * 「간격을 지켰는가」는 시간이 지나야 알 수 있는 사실이다. 실제 시계로 시험하면
 * 200ms 짜리 시험이 다섯 개면 1초를 그냥 기다린다. 시계를 주입받으면 즉시 판정된다.
 */

export interface RateQueueOptions {
  /** 호출 사이 최소 간격. 설정 `kis_min_interval_ms` */
  minIntervalMs: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface RateQueue {
  /** 줄 뒤에 붙인다. 앞의 일이 끝나고 간격이 찰 때까지 기다렸다 돈다 */
  run<T>(task: () => Promise<T>): Promise<T>
  /** 지금까지 실제로 기다린 시간의 합. 시험과 관측이 읽는다 */
  totalWaitedMs(): number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createRateQueue(options: RateQueueOptions): RateQueue {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const minInterval = Math.max(0, options.minIntervalMs)

  /**
   * 꼬리 약속. 새 일은 이 약속 뒤에 붙는다 — 이것이 「순차」의 전부다.
   * 앞 일이 실패해도 줄은 이어져야 하므로 실패를 삼켜 이어 붙인다(결과는 호출자가 받는다).
   */
  let tail: Promise<unknown> = Promise.resolve()
  let lastStartedAt = -Infinity
  let waited = 0

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        const gap = now() - lastStartedAt
        if (gap < minInterval) {
          const waitMs = minInterval - gap
          waited += waitMs
          await sleep(waitMs)
        }
        lastStartedAt = now()
        return task()
      })
      tail = result.then(() => undefined, () => undefined)
      return result as Promise<T>
    },
    totalWaitedMs: () => waited,
  }
}
