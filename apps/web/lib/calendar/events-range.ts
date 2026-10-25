// KST 날짜 범위의 일정 목록 SSOT (P0170 I07)
// /api/calendar/events 와 /api/calendar/month?include=events 가 같은 함수를 쓴다
// 두 창구가 따로 세면 「월별에는 없고 기간에는 있는」 일정이 다시 생긴다

import { kstDateKey, kstRangeToUtc } from '../datetime/kst.ts'
import { isOrphanDailyEvent } from './orphan-event.ts'

/** 반복 일정을 펼칠 때 한 일정이 낼 수 있는 최대 개수 */
const MAX_OCCURRENCES = 400
/** 한 번에 읽는 일정 행 상한 */
const ROW_LIMIT = 1000
const DAY_MS = 864e5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export class CalendarRangeError extends Error {}

/**
 * start~end(YYYY-MM-DD, KST, 양끝 포함)에 걸린 일정, 반복은 펼친다
 * 읽기 범위는 RLS(본인 + 조직 계층), is_mine 은 화면이 수정 삭제를 그릴지 정하는 근거다
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listCalendarEventsInRange(supabase: any, userId: string, start: string, end: string): Promise<Row[]> {
  // KST 날짜 범위를 UTC 절대시각 경계로 환산(datetime SSOT). 'Z' 직접 앵커 금지, 9시간 어긋남 방지
  const { fromIso, toIso } = kstRangeToUtc(start, end)
  const fromMs = new Date(fromIso).getTime()
  const toMs = new Date(toIso).getTime()

  // 단발: 범위 내 시작 / 반복: 시작이 범위 끝 이전이면 후보 (전개는 아래)
  // 반복(rrule)은 시작이 범위 이전이어도 범위 내 occurrence 를 만들 수 있어 하한에서 제외
  const { data, error } = await supabase.from('calendar_events')
    .select('id, title, description, start_at, end_at, all_day, source, link_kind, link_id, status, user_id, rrule')
    .lte('start_at', toIso)
    .or(`start_at.gte.${fromIso},rrule.not.is.null`)
    .order('start_at', { ascending: true })
    .limit(ROW_LIMIT)
  if (error) throw new CalendarRangeError(error.message)

  // 고아 방지: 원본 일일업무가 삭제된 자동생성 일정(link_kind='daily')은 노출하지 않는다
  // 본인 소유 이벤트에만 적용(타인 링크 로그는 RLS로 못 읽어 오탐). daily_logs 는 soft-delete 기준
  const ownDailyLinkIds = Array.from(new Set(
    (data ?? [])
      .filter((ev: Row) => ev.user_id === userId && ev.link_kind === 'daily' && ev.link_id)
      .map((ev: Row) => ev.link_id as string),
  ))
  const liveLogIds = new Set<string>()
  if (ownDailyLinkIds.length > 0) {
    const { data: liveLogs } = await supabase.from('daily_logs').select('id').in('id', ownDailyLinkIds).is('deleted_at', null)
    for (const r of liveLogs ?? []) liveLogIds.add(r.id as string)
  }

  const out: Row[] = []
  for (const ev of data ?? []) {
    if (isOrphanDailyEvent(ev, userId, liveLogIds)) continue
    const isMine = ev.user_id === userId
    const baseMs = new Date(ev.start_at).getTime()
    if (!ev.rrule) {
      if (baseMs >= fromMs && baseMs <= toMs) out.push({ ...ev, base_id: ev.id, is_mine: isMine })
      continue
    }
    // 반복 전개 (FREQ=DAILY / WEEKLY 단순 지원)
    const stepMs = (/FREQ=WEEKLY/i.test(ev.rrule) ? 7 : 1) * DAY_MS
    let occ = baseMs
    for (let guard = 0; occ <= toMs && guard < MAX_OCCURRENCES; guard++) {
      if (occ >= fromMs) {
        const iso = new Date(occ).toISOString()
        // 사본 id 의 날짜는 KST 날짜다, UTC 로 자르면 KST 00:00~08:59 시작 일정이 하루 앞선다
        out.push({ ...ev, id: `${ev.id}:${kstDateKey(iso)}`, base_id: ev.id, start_at: iso, is_mine: isMine })
      }
      occ += stepMs
    }
  }
  return out.sort((a, b) => (a.start_at < b.start_at ? -1 : 1))
}
