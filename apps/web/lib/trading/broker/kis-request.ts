/**
 * KIS 요청을 만들고 응답을 읽는 자리 — 순수 함수
 *
 * 네트워크를 안 탄다. 그래서 「주소에 바깥 값이 안 섞이는가」 「102건을 어떻게 이어 조회하는가」
 * 「응답을 봉으로 어떻게 읽는가」를 실제로 시험할 수 있다.
 * 서버 배선은 `kis-client.ts` 가 맡는다(그쪽은 `server-only` 라 시험이 import 할 수 없다).
 */

import {
  kisHost,
  KIS_QUOTATIONS,
  FID_MARKET_INDEX_FUTURES,
  FID_HOUR_1M,
  type KisEnv,
  type KisQuotationKey,
} from './endpoints.ts'

export interface KisAuth {
  accessToken: string
  appKey: string
  appSecret: string
}

/**
 * 요청 머리.
 *
 * `tr_id` 가 곧 「무엇을 묻는가」다. 여기 오는 값은 `KIS_QUOTATIONS` 의 것뿐이고,
 * 주문 계열 TR 은 그 표에 없다(M1).
 */
export function buildHeaders(auth: KisAuth, key: KisQuotationKey): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    authorization: `Bearer ${auth.accessToken}`,
    appkey: auth.appKey,
    appsecret: auth.appSecret,
    tr_id: KIS_QUOTATIONS[key].trId,
    // 개인·법인은 'P', 제휴사는 'B'. 우리는 개인 계좌다
    custtype: 'P',
  }
}

/**
 * 주소.
 *
 * 호스트는 상수 둘 중 하나, 경로는 상수 표에서 온다. **바깥 값은 질의 문자열에만 들어간다** —
 * 종목코드가 주소의 호스트나 경로를 바꿀 수 없으므로 사설망을 물릴 길이 없다(보안 S4).
 */
export function buildUrl(
  env: KisEnv,
  key: KisQuotationKey,
  params: Readonly<Record<string, string>>,
): string {
  const url = new URL(KIS_QUOTATIONS[key].path, kisHost(env))
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url.toString()
}

/** `2026-09-26T01:23:45+09:00` → `{ date: '20260926', time: '012345' }` (서울 기준) */
export function seoulDateTimeParts(at: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  // en-CA 의 24시 표기는 자정을 '24' 로 줄 때가 있다. 그대로 넘기면 KIS 가 거부한다
  const hour = get('hour') === '24' ? '00' : get('hour')
  return {
    date: `${get('year')}${get('month')}${get('day')}`,
    time: `${hour}${get('minute')}${get('second')}`,
  }
}

export interface MinuteBarQuery {
  contractCode: string
  /** 이 시각 **이전**의 봉을 최신순으로 준다. 이어 조회는 이 값을 뒤로 밀어 간다 */
  until: Date
  /** 과거 데이터까지 포함할 것인가. 당일만 볼 때는 false */
  includePast: boolean
}

export function minuteBarParams(query: MinuteBarQuery): Record<string, string> {
  const { date, time } = seoulDateTimeParts(query.until)
  return {
    FID_COND_MRKT_DIV_CODE: FID_MARKET_INDEX_FUTURES,
    FID_INPUT_ISCD: query.contractCode,
    FID_HOUR_CLS_CODE: FID_HOUR_1M,
    FID_PW_DATA_INCU_YN: query.includePast ? 'Y' : 'N',
    // 허봉(체결 없는 분을 채워 넣은 가짜 봉)은 받지 않는다. 거래량 0 인 진짜 봉과 섞이면
    // 「거래가 없었다」와 「값이 없다」를 구분할 수 없다
    FID_FAKE_TICK_INCU_YN: 'N',
    FID_INPUT_DATE_1: date,
    FID_INPUT_HOUR_1: time,
  }
}

export function symbolParams(contractCode: string): Record<string, string> {
  return {
    FID_COND_MRKT_DIV_CODE: FID_MARKET_INDEX_FUTURES,
    FID_INPUT_ISCD: contractCode,
  }
}

/** KIS 가 준 분봉 한 줄 */
export interface RawMinuteBar {
  stck_bsop_date?: string
  stck_cntg_hour?: string
  futs_prpr?: string
  futs_oprc?: string
  futs_hgpr?: string
  futs_lwpr?: string
  cntg_vol?: string
}

export interface ParsedMinuteBar {
  /** 봉이 **시작**하는 시각. KIS 는 서울 시간의 날짜·시각 문자열로 준다 */
  startAt: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** `20260926` + `091500` (서울) → UTC Date */
export function seoulStampToDate(date: string, time: string): Date | null {
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) return null
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` +
    `T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * 응답을 봉으로 읽는다.
 *
 * **읽을 수 없는 줄은 버리고 센다.** 조용히 빼면 결측이 되고, 결측은 「시장이 조용했다」와
 * 구분되지 않는다. 몇 줄을 왜 버렸는지가 부르는 쪽까지 올라가야 한다.
 */
export function parseMinuteBars(rows: readonly RawMinuteBar[]): {
  bars: ParsedMinuteBar[]
  dropped: number
} {
  const bars: ParsedMinuteBar[] = []
  let dropped = 0
  for (const row of rows) {
    const startAt = seoulStampToDate(row.stck_bsop_date ?? '', row.stck_cntg_hour ?? '')
    const open = num(row.futs_oprc)
    const high = num(row.futs_hgpr)
    const low = num(row.futs_lwpr)
    const close = num(row.futs_prpr)
    if (!startAt || open === null || high === null || low === null || close === null) {
      dropped += 1
      continue
    }
    // 거래량은 없을 수 있다. 0 인 분도 정상 봉이므로 없으면 0 으로 읽는다(§6.2)
    bars.push({ startAt, open, high, low, close, volume: num(row.cntg_vol) ?? 0 })
  }
  // 최신순으로 오지만 순서를 믿지 않는다. 이어 조회 경계에서 섞이면 커서가 뒤로 안 간다
  bars.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  return { bars, dropped }
}

/**
 * 이어 조회 커서 — **다음에 어디부터 물을 것인가**
 *
 * 한 번에 102건까지만 오므로 더 필요하면 가장 오래된 봉 **직전**부터 다시 묻는다.
 * 같은 시각을 그대로 다시 물으면 같은 102건이 또 오고 **영원히 안 끝난다.**
 *
 * @returns 더 물을 필요가 없으면 null
 */
export function nextMinuteCursor(
  bars: readonly ParsedMinuteBar[],
  earliestWanted: Date,
): Date | null {
  if (bars.length === 0) return null
  const oldest = bars[0].startAt
  if (oldest.getTime() <= earliestWanted.getTime()) return null
  return new Date(oldest.getTime() - 60_000)
}

/** KIS 응답 봉투. `rt_cd` 가 '0' 이 아니면 실패다 */
export interface KisEnvelope<T> {
  rt_cd?: string
  msg_cd?: string
  msg1?: string
  output?: T
  output1?: T
  output2?: T
}

export interface KisFailure {
  reason: string
  userMessage: string
}

/**
 * 성공인가. 실패면 **사유와 사람이 읽을 문장을 둘 다** 만든다(조용한 실패 금지).
 *
 * KIS 의 `msg1` 을 그대로 보여 주지 않는다 — 내부 구조나 계좌 관련 문구가 섞여 나올 수 있다.
 * 기계가 읽을 자리(`reason`)에는 코드만 남긴다.
 */
export function readEnvelope<T>(body: KisEnvelope<T> | null, httpStatus: number): KisFailure | null {
  if (!body) {
    return { reason: `http_${httpStatus}:no_body`, userMessage: '증권사 응답을 읽지 못했습니다' }
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { reason: `http_${httpStatus}`, userMessage: '증권사 조회가 실패했습니다' }
  }
  if (body.rt_cd !== undefined && body.rt_cd !== '0') {
    return {
      reason: `kis_${body.msg_cd ?? body.rt_cd}`,
      userMessage: '증권사가 조회를 거절했습니다',
    }
  }
  return null
}
