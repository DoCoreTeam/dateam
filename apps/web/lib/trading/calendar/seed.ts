import 'server-only'

/**
 * 세션 캘린더 채우기 — **주말만 안다**
 *
 * ## 무엇을 모르는가 (솔직하게)
 *
 * 공휴일을 모른다. 이 저장소에 거래소 휴장일 출처가 없고, 명세 §6.6 은
 * Release 1 에서 이런 것을 **관리자가 직접 등록**한다고 적는다.
 *
 * 그래서 평일을 전부 거래일 후보로 세우고 `source='manual'` 로 표시한다.
 * 휴장일에는 봉이 한 줄도 안 오고, 그 사실이 그날 실행 기록(`trading_job_runs.reason`)에
 * 남아 화면에서 보인다. 관리자가 그 줄을 지우거나 고치면 그 뒤로는 안 묻는다.
 *
 * **몰라서 조용히 비워 두지 않는다** — 없는 줄과 휴장일을 구분할 수 없게 만드는 것이
 * 모르는 것보다 나쁘다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { dateRange } from './date-range.ts'
import { buildRegularSession, isWeekendInSeoul, type SessionWindow } from './session.ts'
import { decideEnsureSession } from './seed-window.ts'

export interface SeedInput {
  /** `YYYY-MM-DD` (서울). 포함 */
  fromDate: string
  /** 포함 */
  toDate: string
  /** 그 달 만기일들. `contracts/sync.ts` 가 계산해 넘긴다 */
  expiryDates: readonly string[]
}

export interface SeedResult {
  /** 새로 세운 거래일 수 */
  inserted: number
  /** 이미 있어서 건드리지 않은 날 수 */
  skipped: number
  /** 주말이라 안 세운 날 수 */
  weekends: number
}

function toRow(window: SessionWindow) {
  return {
    trade_date: window.tradeDate,
    session: window.session,
    open_auction_start: window.openAuctionStart?.toISOString() ?? null,
    continuous_start: window.continuousStart.toISOString(),
    continuous_end: window.continuousEnd.toISOString(),
    close_auction_end: window.closeAuctionEnd?.toISOString() ?? null,
    source: 'manual',
    note: '평일 자동 생성 — 휴장일은 봉이 안 오는 것으로 드러난다',
  }
}

/**
 * 없는 날만 세운다.
 *
 * **이미 있는 줄은 절대 덮지 않는다.** 관리자가 고쳐 둔 개장 시간이 자동 생성으로
 * 되돌아가면 그날 판단이 통째로 어긋난다(마이그레이션이 상태 플래그를 덮어쓴 전례와 같은 사고다).
 */
export async function seedRegularSessions(input: SeedInput): Promise<SeedResult> {
  const days = dateRange(input.fromDate, input.toDate)
  const weekdays = days.filter((d) => !isWeekendInSeoul(d))
  const expiry = new Set(input.expiryDates)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_session_calendar')
    .select('trade_date')
    .eq('session', 'regular')
    .gte('trade_date', input.fromDate)
    .lte('trade_date', input.toDate)
  if (error) throw new Error(`세션 캘린더를 읽지 못했습니다: ${error.message}`)

  const existing = new Set(((data ?? []) as { trade_date: string }[]).map((r) => r.trade_date))
  const missing = weekdays.filter((d) => !existing.has(d))
  if (missing.length === 0) {
    return { inserted: 0, skipped: weekdays.length, weekends: days.length - weekdays.length }
  }

  const rows = missing.map((d) => toRow(buildRegularSession({ tradeDate: d, isExpiryDay: expiry.has(d) })))
  const { error: writeError } = await admin.from('trading_session_calendar').insert(rows)
  if (writeError) throw new Error(`세션 캘린더를 세우지 못했습니다: ${writeError.message}`)

  return {
    inserted: rows.length,
    skipped: weekdays.length - rows.length,
    weekends: days.length - weekdays.length,
  }
}

/** 그날의 창 하나. 없으면 null — 없는 것을 「휴장」으로 단정하지 않는다 */
export async function loadSessionWindow(tradeDate: string): Promise<SessionWindow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_session_calendar')
    .select('trade_date, session, open_auction_start, continuous_start, continuous_end, close_auction_end')
    .eq('trade_date', tradeDate)
    .eq('session', 'regular')
    .maybeSingle()
  if (error) throw new Error(`세션 캘린더를 읽지 못했습니다: ${error.message}`)
  if (!data) return null
  return {
    tradeDate: data.trade_date,
    session: 'regular',
    openAuctionStart: data.open_auction_start ? new Date(data.open_auction_start) : null,
    continuousStart: new Date(data.continuous_start),
    continuousEnd: new Date(data.continuous_end),
    closeAuctionEnd: data.close_auction_end ? new Date(data.close_auction_end) : null,
  }
}

/**
 * 그날 세션 창을 확실히 마련한다 — **없으면 세우고 돌려준다.**
 *
 * 크론이 매분 부른다. 있는 날은 읽기 한 번으로 끝나고, 없는 날만 한 줄을 세운다.
 * 이 함수가 없던 동안 캘린더는 영원히 비어 있었고 수집이 한 줄도 안 됐다.
 *
 * @param lastTradingDays 이 상품의 최종거래일들. 그 날은 접속매매가 15:20 에 끝난다
 */
export async function ensureSessionWindow(
  tradeDate: string,
  lastTradingDays: ReadonlySet<string>,
): Promise<{ window: SessionWindow | null; created: boolean; reason: string }> {
  const existing = await loadSessionWindow(tradeDate)
  const action = decideEnsureSession({
    tradeDate,
    exists: existing !== null,
    isWeekend: isWeekendInSeoul(tradeDate),
    lastTradingDays,
  })

  if (action.kind === 'use') return { window: existing, created: false, reason: 'session_exists' }
  if (action.kind === 'skip') return { window: null, created: false, reason: `no_session:${action.reason}` }

  const built = buildRegularSession({ tradeDate, isExpiryDay: action.isExpiryDay })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_session_calendar').insert(toRow(built))
  if (error) {
    /**
     * 유일 키에 걸렸으면 **같은 분에 다른 실행이 먼저 세운 것**이다. 오류가 아니라 경주다 —
     * 그쪽이 세운 줄을 읽어 쓴다.
     */
    const again = await loadSessionWindow(tradeDate)
    if (again) return { window: again, created: false, reason: 'session_created_by_other' }
    throw new Error(`세션 줄을 세우지 못했습니다: ${error.message}`)
  }
  return { window: built, created: true, reason: action.isExpiryDay ? 'session_created:expiry' : 'session_created' }
}
