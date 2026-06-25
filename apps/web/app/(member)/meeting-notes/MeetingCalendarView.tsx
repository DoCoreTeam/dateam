// 캘린더 보기 — 기존 /calendar 그리드와 동일한 공용 클래스(globals.css SSOT) 재사용으로 시각 통일.
//  calendar-month-board / calendar-weekday-row / calendar-weekday / calendar-month-grid /
//  calendar-day-cell / calendar-day-number / cal-event-chip / calendar-nav-btn / calendar-period-label
//  회의는 날짜 칸에 cal-event-chip(시각+제목)으로 배치, 클릭 시 상세로 이동. ?ym=YYYY-MM 월 이동.
import Link from 'next/link'
import { ChevronLeft, ChevronRight, CalendarClock } from 'lucide-react'
import { formatKstTime } from '@/lib/calendar/format-time'
import { kstDateKey } from '@/lib/datetime/kst'
import type { MeetingListItemView } from './list-types'

interface Props {
  items: MeetingListItemView[]
  ym: string // 'YYYY-MM'
  q: string
  sort: string
  filter: string
}

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function parseYm(ym: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return { year: Number(m[1]), month: Number(m[2]) } // month 1..12
}

// 1-indexed month 기준 이전/다음 달의 YYYY-MM (연 경계 처리)
function shiftYm(year: number, month: number, delta: number): string {
  const idx = (year * 12 + (month - 1)) + delta
  const y = Math.floor(idx / 12)
  const mm = (idx % 12) + 1
  return `${y}-${String(mm).padStart(2, '0')}`
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null
  // KST 기준 날짜(datetime SSOT) — 서버 컴포넌트에서 new Date().getDate()는 서버TZ(UTC)라 자정 경계 오분류.
  return kstDateKey(iso) || null
}

export default function MeetingCalendarView({ items, ym, q, sort, filter }: Props) {
  const { year, month } = parseYm(ym)

  function navHref(targetYm: string): string {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (sort !== 'recent') params.set('sort', sort)
    if (filter !== 'all') params.set('filter', filter)
    params.set('view', 'calendar')
    params.set('ym', targetYm)
    return `/meeting-notes?${params.toString()}`
  }

  // 날짜 → 회의 목록
  const byDay = new Map<string, MeetingListItemView[]>()
  for (const m of items) {
    const k = dayKey(m.meeting_at)
    if (!k) continue
    const arr = byDay.get(k)
    if (arr) arr.push(m); else byDay.set(k, [m])
  }

  // 기존 캘린더와 동일한 셀 구성: firstDay 만큼 빈칸 + 1..daysInMonth
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const todayKey = (() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()

  return (
    <div style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <Link href={navHref(shiftYm(year, month, -1))} className="calendar-nav-btn" aria-label="이전 달">
          <ChevronLeft size={16} strokeWidth={2.4} />
        </Link>
        <span className="calendar-period-label">{year}년 {month}월</span>
        <Link href={navHref(shiftYm(year, month, 1))} className="calendar-nav-btn" aria-label="다음 달">
          <ChevronRight size={16} strokeWidth={2.4} />
        </Link>
      </div>

      <section className="calendar-month-board" aria-label={`${year}년 ${month}월 월간 캘린더`}>
        <div className="calendar-weekday-row">
          {WEEK_DAYS.map((d, i) => (
            <div key={d} className={`calendar-weekday ${i === 0 ? 'is-sun' : ''} ${i === 6 ? 'is-sat' : ''}`}>{d}</div>
          ))}
        </div>
        <div className="calendar-month-grid">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className="calendar-day-cell is-empty" aria-hidden="true" />
            const pad = (n: number) => String(n).padStart(2, '0')
            const dateStr = `${year}-${pad(month)}-${pad(day)}`
            const dayItems = byDay.get(dateStr) ?? []
            const dow = (firstDay + day - 1) % 7
            const isToday = dateStr === todayKey
            return (
              <div key={day} className={`calendar-day-cell ${isToday ? 'is-today' : ''}`} aria-label={`${dateStr}${dayItems.length ? `, 회의 ${dayItems.length}건` : ''}`}>
                <span className={`calendar-day-number ${dow === 0 ? 'is-sun' : ''} ${dow === 6 ? 'is-sat' : ''}`}>{day}</span>
                {dayItems.map((m) => (
                  <Link key={m.id} href={`/meeting-notes/${m.id}`} className="cal-event-chip" title={m.title}>
                    <span className="cal-type-icon cal-type-icon--event" aria-hidden="true">
                      <CalendarClock size={11} strokeWidth={2.4} />
                    </span>
                    {m.meeting_at && <span className="cal-event-time">{formatKstTime(m.meeting_at)}</span>}
                    {m.title || '(제목 없음)'}
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
