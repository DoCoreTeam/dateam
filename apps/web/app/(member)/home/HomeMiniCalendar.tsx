'use client'

import { useRouter } from 'next/navigation'
import type { DayLogSummary } from '../daily/actions'

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

interface Props {
  year: number
  month: number
  todayStr: string
  monthSummary: DayLogSummary[]
}

export default function HomeMiniCalendar({ year, month, todayStr, monthSummary }: Props) {
  const router = useRouter()

  const summaryMap = new Map(monthSummary.map((s) => [s.date, s]))

  const firstDow = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const monthLabel = new Date(year, month - 1).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
  })

  return (
    <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
          {monthLabel}
        </h3>
        <a
          href="/calendar"
          style={{ fontSize: '0.75rem', color: 'var(--brand)', textDecoration: 'none', fontWeight: 600 }}
        >
          전체 보기 →
        </a>
      </div>

      {/* 요일 헤더 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '0.25rem' }}>
        {WEEK_DAYS.map((d, i) => (
          <div
            key={d}
            style={{
              textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600,
              color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#94a3b8',
              padding: '0.2rem 0',
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} style={{ minHeight: 32 }} />
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = dateStr === todayStr
          const summary = summaryMap.get(dateStr)
          const dow = idx % 7

          return (
            <button
              key={idx}
              onClick={() => router.push(`/daily?date=${dateStr}`)}
              aria-label={`${month}월 ${day}일`}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: '2px',
                padding: '0.25rem 0',
                borderRadius: 'var(--radius)', border: 'none',
                background: isToday ? 'var(--brand)' : 'transparent',
                cursor: 'pointer', minHeight: 32,
              }}
            >
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: isToday ? 700 : 400,
                color: isToday ? '#ffffff' : dow === 0 ? '#ef4444' : dow === 6 ? '#3b82f6' : '#334155',
              }}>
                {day}
              </span>
              {summary && (
                <span style={{
                  width: 4, height: 4, borderRadius: '50%', display: 'block',
                  background: summary.hasBlocker
                    ? '#ef4444'
                    : isToday
                      ? 'rgba(255,255,255,0.7)'
                      : '#22c55e',
                }} />
              )}
            </button>
          )
        })}
      </div>

    </div>
  )
}
