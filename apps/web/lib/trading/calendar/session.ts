/**
 * 세션 캘린더 — **장이 언제 열리고 언제 판단하는가**
 *
 * ## 왜 시각을 표에 두고 계산하나 (명세 §6.3)
 *
 * 청산 시각은 고정값이 아니다. 평일은 접속매매가 15:35 에 끝나지만 **만기일은 15:20** 이고,
 * 연초 첫 거래일이나 수능일처럼 거래소가 시간을 바꾸는 날도 있다.
 * 화면이나 코드에 15:20 을 적어 두면 그런 날마다 틀린 값을 그린다 —
 * 그리고 틀린 청산 시각은 포지션이 남은 채 장이 끝나는 것을 뜻한다.
 *
 * 그래서 규칙은 하나다: **당일 청산 = 그날 접속매매 종료 − N분.**
 *
 * ## 왜 단일가를 따로 가르나 (D-40)
 *
 * 개장 전(08:30~08:45)과 장 마감(15:35~15:45) 단일가 구간은 체결 방식이 다르다.
 * 그 구간의 봉으로 판단하면 접속매매와 다른 시장을 보고 판단하는 것이 된다.
 * **수집은 해도 되고 판단은 안 한다** — 나중에 백테스트가 그 사실을 알아야 하므로 지우지 않는다.
 */

import { kstWallToIso } from '../../datetime/kst.ts'

export type SessionKind = 'regular' | 'night'

/** `trading_session_calendar` 한 줄을 코드가 쓰는 꼴로 */
export interface SessionWindow {
  tradeDate: string
  session: SessionKind
  /** 개장 전 단일가 시작. 없는 세션(야간)은 null */
  openAuctionStart: Date | null
  continuousStart: Date
  continuousEnd: Date
  /** 장 마감 단일가 종료. 만기일처럼 없으면 null */
  closeAuctionEnd: Date | null
}

/** 평일 정규장 기본 시각 (거래소 기준, 명세 §6.3) */
export const REGULAR_TIMES = {
  openAuctionStart: '08:30',
  continuousStart: '08:45',
  continuousEnd: '15:35',
  closeAuctionEnd: '15:45',
} as const

/**
 * 만기일. 접속매매가 15:20 에 끝난다.
 *
 * 장 마감 단일가가 있는지는 구현 시 거래소 기준으로 확인해야 한다(명세 §6.3).
 * 확인 전까지는 **없는 것으로 둔다** — 있다고 가정하고 없으면 판단 가능한 구간을
 * 실제보다 좁게 잡는 쪽이고, 없다고 가정하고 있으면 단일가 봉으로 판단하게 된다.
 * 둘 중 안전한 쪽은 앞이 아니라 **정확히 아는 데까지만** 쓰는 것이다.
 */
export const EXPIRY_TIMES = {
  openAuctionStart: '08:30',
  continuousStart: '08:45',
  continuousEnd: '15:20',
  closeAuctionEnd: null,
} as const

export interface BuildSessionInput {
  /** `YYYY-MM-DD` (서울) */
  tradeDate: string
  isExpiryDay: boolean
  /** 거래소가 시간을 바꾼 날. 적힌 값이 기본값을 이긴다 */
  override?: Partial<Record<keyof typeof REGULAR_TIMES, string | null>>
}

/**
 * 하루치 정규장 창.
 *
 * 저장은 UTC 로 한다 — `kstWallToIso` 가 +09:00 을 앵커로 박아 주므로
 * 서버가 어느 시간대에서 돌든 같은 절대시각이 들어간다.
 */
export function buildRegularSession(input: BuildSessionInput): SessionWindow {
  const base: Record<keyof typeof REGULAR_TIMES, string | null> = input.isExpiryDay
    ? { ...EXPIRY_TIMES }
    : { ...REGULAR_TIMES }
  const times = { ...base, ...(input.override ?? {}) }

  const at = (time: string | null): Date | null =>
    time === null ? null : new Date(kstWallToIso(input.tradeDate, time))

  const continuousStart = at(times.continuousStart)
  const continuousEnd = at(times.continuousEnd)
  if (!continuousStart || !continuousEnd) {
    // 접속매매 구간이 없는 거래일은 없다. 여기서 막지 않으면 판단 구간이 통째로 비고,
    // 화면에는 「봉이 안 온다」로 보인다
    throw new Error(`접속매매 시각이 비어 있습니다: ${input.tradeDate}`)
  }

  return {
    tradeDate: input.tradeDate,
    session: 'regular',
    openAuctionStart: at(times.openAuctionStart),
    continuousStart,
    continuousEnd,
    closeAuctionEnd: at(times.closeAuctionEnd),
  }
}

/**
 * 이 시각이 판단 대상인가.
 *
 * 경계는 **시작은 포함, 끝은 제외**다. 08:45:00 봉은 접속매매 첫 봉이고,
 * 15:35:00 봉은 이미 단일가다. 양쪽을 다 포함하면 하루에 봉이 하나 더 생긴다.
 */
export function isContinuousTrading(window: SessionWindow, at: Date): boolean {
  const t = at.getTime()
  return t >= window.continuousStart.getTime() && t < window.continuousEnd.getTime()
}

/** 단일가 구간인가. 수집은 하고 판단은 안 하는 자리 */
export function isAuctionWindow(window: SessionWindow, at: Date): boolean {
  const t = at.getTime()
  const openAuction =
    window.openAuctionStart !== null &&
    t >= window.openAuctionStart.getTime() &&
    t < window.continuousStart.getTime()
  const closeAuction =
    window.closeAuctionEnd !== null &&
    t >= window.continuousEnd.getTime() &&
    t < window.closeAuctionEnd.getTime()
  return openAuction || closeAuction
}

/**
 * 당일 청산 시각 — **접속매매 종료에서 N분 뺀 값**.
 *
 * 고정 시각이 아니다. 평일(종료 15:35)은 15:20, 만기일(종료 15:20)은 15:05 이 된다.
 * 화면도 이 함수를 부른다 — 화면이 따로 계산하면 만기일에 둘이 갈린다.
 */
export function sameDayExitAt(window: SessionWindow, minutesBefore: number): Date {
  return new Date(window.continuousEnd.getTime() - minutesBefore * 60_000)
}

/**
 * 새 신호를 내면 안 되는 구간인가 (SR-04 의 시간 부분).
 *
 * 1-A 는 신호를 내지 않지만 **판단 기록에 이 사실을 남겨 둬야** 1-B 가
 * 「그때 신호를 냈다면」을 같은 기준으로 다시 셀 수 있다.
 */
export function isNewEntryBlocked(
  window: SessionWindow,
  at: Date,
  options: { openingMinutes: number; closingMinutes: number },
): boolean {
  if (!isContinuousTrading(window, at)) return true
  const sinceOpen = at.getTime() - window.continuousStart.getTime()
  const untilClose = window.continuousEnd.getTime() - at.getTime()
  return sinceOpen < options.openingMinutes * 60_000 || untilClose <= options.closingMinutes * 60_000
}

/** 주말인가. 공휴일은 여기서 모른다 — 거래소 공지를 사람이 넣는다(§6.6) */
export function isWeekendInSeoul(tradeDate: string): boolean {
  const day = new Date(`${tradeDate}T12:00:00+09:00`).getUTCDay()
  return day === 0 || day === 6
}


// ── 야간장 ───────────────────────────────────────────────

/**
 * 야간장 시각 (명세 §6.3 「야간장 18:00~06:00」).
 *
 * 자정을 넘는다 — 시작은 하루, 끝은 다음 날이다. 이 하나가 정규장과 다른 전부이고,
 * 놓치면 자정 이후 봉이 통째로 「장외」로 밀린다.
 */
export const NIGHT_TIMES = { start: '18:00', end: '06:00' } as const

/**
 * 야간 세션이 **어느 거래일에 속하나** (명세 §6.4).
 *
 * `next`  — 저녁 18:00 에 시작한 장은 **다음 거래일**의 것이다(거래소 관례)
 * `same`  — 시작한 날의 것이다
 *
 * 기본을 `next` 로 둔다. 손익과 일일 한도가 거래일 기준이라(§6.4) 귀속이 틀리면
 * 밤에 난 결과가 어제 몫으로 잡히고, 한도가 이미 닫힌 날에 거래한 것처럼 보인다.
 * 거래소 기준을 확인하면 설정으로 바꾼다.
 */
export type NightTradeDateRule = 'next' | 'same'

/** 저녁 `startDate` 에 시작한 야간장이 속하는 거래일 */
export function nightTradeDate(startDate: string, rule: NightTradeDateRule): string {
  if (rule === 'same') return startDate
  const at = new Date(`${startDate}T12:00:00+09:00`)
  at.setUTCDate(at.getUTCDate() + 1)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at)
}

/**
 * 야간 세션 창 하나.
 *
 * @param startDate 저녁이 시작한 날 (`YYYY-MM-DD`, 서울)
 */
export function buildNightSession(startDate: string, rule: NightTradeDateRule): SessionWindow {
  const endDate = nightTradeDate(startDate, 'next')
  return {
    tradeDate: nightTradeDate(startDate, rule),
    session: 'night',
    // 야간장에는 개장 전 단일가가 없다. 없는 것을 있다고 적지 않는다
    openAuctionStart: null,
    continuousStart: new Date(kstWallToIso(startDate, NIGHT_TIMES.start)),
    continuousEnd: new Date(kstWallToIso(endDate, NIGHT_TIMES.end)),
    closeAuctionEnd: null,
  }
}

/**
 * 이 시각이 야간장 시간대인가 — **캘린더 없이** 답한다.
 *
 * 줄을 세우기 전에 물어야 하는 질문이라 표를 안 본다.
 * 자정을 넘으므로 「시작보다 크다」와 「끝보다 작다」를 한꺼번에 쓰면 틀린다.
 */
export function isNightHour(at: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false,
  }).format(at))
  return hour >= 18 || hour < 6
}

/** 이 시각이 속한 야간장의 **시작 날**. 새벽이면 전날 저녁이다 */
export function nightStartDateOf(at: Date): string {
  const seoulDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at)
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false,
  }).format(at))
  if (hour >= 18) return seoulDate
  const prev = new Date(`${seoulDate}T12:00:00+09:00`)
  prev.setUTCDate(prev.getUTCDate() - 1)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(prev)
}
