'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import {
  type DayCellStat,
  type MonthSummary,
  buildCalendarGrid,
  todayKst,
} from '@/lib/admin/daily-monitoring'
import { buildUrl } from './url'

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const

interface Props {
  month: string // YYYY-MM
  byDate: Record<string, DayCellStat>
  totalActiveMembers: number
  summary: MonthSummary
  selectedDate: string
  baseParams: Record<string, string>
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 작성 활동(참여) 농도(0~1) → 양성 틴트 강도. 0명=무음영. */
function writeShade(stat: DayCellStat | undefined, total: number): number {
  if (!stat || total <= 0 || stat.writerCount <= 0) return 0
  return Math.max(0, Math.min(1, stat.writerCount / total))
}

export default function MonitoringCalendar({
  month,
  byDate,
  totalActiveMembers,
  summary,
  selectedDate,
  baseParams,
}: Props) {
  const router = useRouter()
  const weeks = buildCalendarGrid(month)
  const today = todayKst()
  const [year, mon] = month.split('-')

  function goMonth(delta: number) {
    router.push(buildUrl(baseParams, { month: shiftMonth(month, delta), page: undefined }))
  }

  function selectDay(date: string) {
    router.push(buildUrl(baseParams, { month, date, page: undefined }))
  }

  return (
    <section className="monitor-calendar" aria-label="월간 작성 현황 달력">
      <div className="monitor-cal-nav">
        <button
          type="button"
          className="calendar-nav-btn"
          onClick={() => goMonth(-1)}
          aria-label="이전 달"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="monitor-cal-period">
          {year}년 {Number(mon)}월
        </span>
        <button
          type="button"
          className="calendar-nav-btn"
          onClick={() => goMonth(1)}
          aria-label="다음 달"
        >
          <ChevronRight size={18} />
        </button>
        <span className="monitor-cal-legend">작성 인원 / 전체 {totalActiveMembers}명</span>
      </div>

      <div className="monitor-month-stats" aria-label="이번 달 작성 추이">
        <span className="monitor-stat">
          작성일 <b>{summary.daysWithLogs}</b>일
        </span>
        <span className="monitor-stat">
          작성일 평균 <b>{summary.avgWriters}</b>명
        </span>
        <span className="monitor-stat">
          누적 작성 <b>{summary.totalWriterDays}</b>인·일
        </span>
        <span className={`monitor-stat${summary.blockerDays > 0 ? ' is-danger' : ''}`}>
          블로커 발생 <b>{summary.blockerDays}</b>일
        </span>
      </div>

      <div className="calendar-month-board">
        <div className="calendar-weekday-row" role="row">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`calendar-weekday${i === 6 ? ' is-sun' : i === 5 ? ' is-sat' : ''}`}
              role="columnheader"
            >
              {w}
            </div>
          ))}
        </div>
        <div className="calendar-month-grid">
          {weeks.flat().map(({ date, inMonth }, idx) => {
            const stat = byDate[date]
            const isToday = date === today
            const isSelected = date === selectedDate
            const dow = idx % 7 // 0=월 ... 6=일
            // 활동 농도 → 은은한 양성 틴트. 저참여도도 보이게 sqrt 스케일, 상한 0.32.
            const shade = writeShade(stat, totalActiveMembers)
            const fillOpacity = inMonth && shade > 0 ? Math.min(0.32, 0.1 + Math.sqrt(shade) * 0.4) : 0
            const cls = [
              'monitor-day-cell',
              inMonth ? '' : 'is-out',
              isToday ? 'is-today' : '',
              isSelected ? 'is-selected' : '',
              dow >= 5 ? 'is-weekend' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={date}
                type="button"
                className={cls}
                onClick={() => selectDay(date)}
                aria-pressed={isSelected}
                aria-label={`${date} 작성 ${stat?.writerCount ?? 0}명${stat?.hasBlocker ? ', 블로커 있음' : ''}`}
              >
                <span
                  className={`monitor-day-num${dow === 6 ? ' is-sun' : dow === 5 ? ' is-sat' : ''}`}
                >
                  {Number(date.slice(8, 10))}
                </span>
                <span
                  className="monitor-day-fill"
                  aria-hidden="true"
                  style={{ opacity: fillOpacity }}
                />
                {stat && stat.writerCount > 0 && (
                  <span className="monitor-day-badge">
                    ● {stat.writerCount}/{totalActiveMembers}
                  </span>
                )}
                {stat?.hasBlocker && (
                  <span className="monitor-day-blocker" title="블로커 있음">
                    <AlertTriangle size={11} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
