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

  const todaySummary = summaryMap.get(todayStr)

  return (
    <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
          {monthLabel}
        </h3>
        <a
          href="/calendar"
          style={{ fontSize: '0.75rem', color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}
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
          if (!day) return <div key={idx} style={{ minHeight: 44 }} />
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
                borderRadius: '0.5rem', border: 'none',
                background: isToday ? '#6366f1' : 'transparent',
                cursor: 'pointer', minHeight: 44,
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

      {/* 오늘 업무 미리보기 */}
      {todaySummary && todaySummary.preview.length > 0 && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', margin: '0 0 0.5rem', letterSpacing: '0.02em' }}>
            오늘 업무 미리보기
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {todaySummary.preview.slice(0, 3).map((p, i) => {
              const dotColor = p.entry_type === 'done'
                ? '#16a34a'
                : p.entry_type === 'blocker'
                  ? '#dc2626'
                  : p.entry_type === 'doing'
                    ? '#2563eb'
                    : '#6366f1'
              return (
                <div key={i} style={{ display: 'flex', gap: '0.375rem', alignItems: 'flex-start' }}>
                  <span style={{ color: dotColor, flexShrink: 0, fontSize: '0.625rem', marginTop: '0.2rem' }}>●</span>
                  <span style={{
                    fontSize: '0.8125rem', color: '#334155',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {p.content}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
