import 'server-only'

/**
 * KIS 조회 — **조회만 한다** (명세 M1)
 *
 * 부를 수 있는 것은 `KIS_QUOTATIONS` 넷뿐이고, 주문 계열은 그 표에 없다.
 * 「나중에 쓸지 모르니」로 한 줄 더 적어 두지 않는다 — 적어 두면 부르는 코드는 한 줄이다.
 *
 * 호출은 전부 순차 큐를 지난다. 한 번의 크론 실행이 분봉·시세·호가를 잇달아 부르는데,
 * 한꺼번에 던지면 KIS 한도에 걸리고 그 분의 봉이 통째로 빈다.
 */

import { createRateQueue, type RateQueue } from './rate-queue.ts'
import {
  buildHeaders,
  buildUrl,
  minuteBarParams,
  symbolParams,
  parseMinuteBars,
  nextMinuteCursor,
  readEnvelope,
  type KisAuth,
  type KisEnvelope,
  type KisFailure,
  type ParsedMinuteBar,
  type RawMinuteBar,
} from './kis-request.ts'
import { KIS_QUOTATIONS, type KisEnv, type KisQuotationKey } from './endpoints.ts'

export type KisResult<T> = { ok: true; value: T } | ({ ok: false } & KisFailure)

export interface KisClientOptions {
  env: KisEnv
  auth: KisAuth
  /** 설정 `kis_min_interval_ms` */
  minIntervalMs: number
  /** 이어 조회를 몇 번까지 하나. 한 실행이 1분 안에 끝나야 한다(§14.3) */
  maxPages?: number
}

async function call<T>(
  queue: RateQueue,
  env: KisEnv,
  auth: KisAuth,
  key: KisQuotationKey,
  params: Record<string, string>,
): Promise<KisResult<KisEnvelope<T>>> {
  return queue.run(async () => {
    let response: Response
    try {
      response = await fetch(buildUrl(env, key, params), {
        method: 'GET',
        headers: buildHeaders(auth, key),
        cache: 'no-store',
      })
    } catch (error) {
      // 연결 자체가 안 된 것과 거절당한 것은 다른 사유다. 뭉뚱그리면 원인을 못 찾는다
      return {
        ok: false as const,
        reason: `network:${error instanceof Error ? error.name : 'unknown'}`,
        userMessage: '증권사에 연결하지 못했습니다',
      }
    }
    const body = (await response.json().catch(() => null)) as KisEnvelope<T> | null
    const failure = readEnvelope(body, response.status)
    if (failure) return { ok: false as const, ...failure }
    return { ok: true as const, value: body as KisEnvelope<T> }
  })
}

export interface MinuteBarsResult {
  bars: ParsedMinuteBar[]
  /** 읽을 수 없어 버린 줄 수. 0 이 아니면 그 사실이 기록에 남아야 한다 */
  dropped: number
  /** 상한에 걸려 더 못 읽고 멈췄나. 멈춘 것을 「끝났다」로 읽으면 결측이 조용해진다 */
  truncated: boolean
}

export interface KisClient {
  /**
   * `from` 부터 `until` 까지의 1분 봉. 한 번에 102건까지라 필요하면 이어 조회한다.
   */
  minuteBars(input: { contractCode: string; from: Date; until: Date }): Promise<KisResult<MinuteBarsResult>>
  /** 현재가·미결제약정 등 */
  price(contractCode: string): Promise<KisResult<Record<string, string>>>
  /** 최우선 호가 */
  askingPrice(contractCode: string): Promise<KisResult<Record<string, string>>>
  /**
   * 기준일부터의 휴장일 표. 한 번에 100일 남짓이라 이어 조회한다.
   *
   * 「몇 거래일 남았나」를 이 표로 센다. 주말만 빼고 세면 추석이 낀 해에
   * 여유가 실제보다 많아 보여 월물 교체가 늦는다.
   */
  holidays(input: { from: Date; maxPages?: number }): Promise<KisResult<HolidayRow[]>>
}

export interface HolidayRow {
  /** YYYY-MM-DD (서울) */
  date: string
  /** 개장일인가 */
  open: boolean
}

export function createKisClient(options: KisClientOptions): KisClient {
  const queue = createRateQueue({ minIntervalMs: options.minIntervalMs })
  const { env, auth } = options
  const maxPages = options.maxPages ?? 8

  return {
    async minuteBars({ contractCode, from, until }) {
      const collected: ParsedMinuteBar[] = []
      let dropped = 0
      let cursor = until
      let truncated = false

      for (let page = 0; page < maxPages; page += 1) {
        const result = await call<RawMinuteBar[]>(queue, env, auth, 'minuteChart', minuteBarParams({
          contractCode,
          until: cursor,
          // 오늘 안에서만 물으면 과거 포함을 켤 이유가 없다 — 켜면 응답이 무거워진다
          includePast: from.getTime() < startOfSeoulDay(until).getTime(),
        }))
        if (!result.ok) return result

        const rows = (result.value.output2 ?? []) as RawMinuteBar[]
        const parsed = parseMinuteBars(rows)
        dropped += parsed.dropped
        collected.push(...parsed.bars.filter((b) => b.startAt.getTime() >= from.getTime()))

        const next = nextMinuteCursor(parsed.bars, from)
        if (!next) break
        cursor = next
        // 마지막 바퀴인데 더 남았으면 잘렸다고 말한다
        if (page === maxPages - 1) truncated = true
      }

      // 이어 조회가 겹칠 수 있다. 시각으로 하나만 남긴다
      const byTime = new Map(collected.map((b) => [b.startAt.getTime(), b]))
      const bars = [...byTime.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      return { ok: true, value: { bars, dropped, truncated } }
    },

    async price(contractCode) {
      const result = await call<Record<string, string>>(queue, env, auth, 'price', symbolParams(contractCode))
      if (!result.ok) return result
      const output = result.value.output ?? result.value.output1
      if (!output) return { ok: false, reason: 'kis_empty_output', userMessage: '증권사 시세가 비어 있습니다' }
      return { ok: true, value: output }
    },

    async holidays({ from, maxPages: pages }) {
      const rows: HolidayRow[] = []
      let fk = ''
      let nk = ''
      const limit = pages ?? maxPages
      for (let page = 0; page < limit; page += 1) {
        const result = await call<Record<string, string>[]>(queue, env, auth, 'holidays', {
          BASS_DT: seoulYmd(from),
          CTX_AREA_FK: fk,
          CTX_AREA_NK: nk,
        })
        if (!result.ok) return result
        const output = (result.value.output ?? result.value.output1 ?? []) as Record<string, string>[]
        for (const row of output) {
          const raw = (row.bass_dt ?? '').trim()
          // 여덟 자리가 아니면 우리가 읽을 수 있는 날짜가 아니다. 조용히 오늘로 접지 않는다
          if (!/^\d{8}$/.test(raw)) continue
          rows.push({
            date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
            open: (row.opnd_yn ?? '').trim().toUpperCase() === 'Y',
          })
        }
        // 이어 조회 열쇠가 안 오거나 그대로면 끝이다
        const envelope = result.value as unknown as Record<string, string>
        const nextFk = (envelope.ctx_area_fk100 ?? '').trim()
        const nextNk = (envelope.ctx_area_nk100 ?? '').trim()
        if (output.length === 0 || (nextFk === fk && nextNk === nk)) break
        fk = nextFk
        nk = nextNk
        if (fk === '' && nk === '') break
      }
      // 같은 날이 두 번 오면 하나만 남긴다
      const byDate = new Map(rows.map((r) => [r.date, r]))
      return { ok: true, value: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) }
    },

    async askingPrice(contractCode) {
      const result = await call<Record<string, string>>(queue, env, auth, 'askingPrice', symbolParams(contractCode))
      if (!result.ok) return result
      const output = result.value.output1 ?? result.value.output
      if (!output) return { ok: false, reason: 'kis_empty_output', userMessage: '증권사 호가가 비어 있습니다' }
      return { ok: true, value: output }
    },
  }
}

/** 서울 기준 YYYYMMDD. KIS 는 하이픈 없는 여덟 자리를 받는다 */
function seoulYmd(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at).replace(/-/g, '')
}

/** 서울 기준 그날 00:00 */
function startOfSeoulDay(at: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at)
  return new Date(`${ymd}T00:00:00+09:00`)
}

export { KIS_QUOTATIONS }
