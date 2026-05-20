'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'

interface WeekGroup {
  weekStart: string
  reports: WeeklyReport[]
}

interface ReportAccordionProps {
  groups: WeekGroup[]
}

export default function ReportAccordion({ groups }: ReportAccordionProps) {
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(
    new Set(groups.length > 0 ? [groups[0].weekStart] : [])
  )

  function toggleWeek(weekStart: string) {
    setOpenWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(weekStart)) {
        next.delete(weekStart)
      } else {
        next.add(weekStart)
      }
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
        작성된 주간보고가 없습니다
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {groups.map((group) => {
        const isOpen = openWeeks.has(group.weekStart)
        const weekDate = new Date(group.weekStart)
        const weekLabel = weekDate.toLocaleDateString('ko-KR', {
          month: 'long',
          day: 'numeric',
        })

        return (
          <div
            key={group.weekStart}
            className="card"
            style={{ overflow: 'hidden' }}
          >
            <button
              onClick={() => toggleWeek(group.weekStart)}
              aria-expanded={isOpen}
              style={{
                width: '100%',
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                borderBottom: isOpen ? '1px solid #e2e8f0' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a' }}>
                  {weekLabel} 주
                </span>
                <span className="badge badge-slate">
                  {group.reports.length}건
                </span>
              </div>
              <ChevronDown
                size={16}
                color="#94a3b8"
                style={{
                  transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 200ms',
                }}
              />
            </button>

            {isOpen && (
              <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {group.reports.map((report) => (
                  <div
                    key={report.id}
                    style={{
                      padding: '1rem',
                      backgroundColor: '#f8fafc',
                      borderRadius: '0.75rem',
                      border: '1px solid #f1f5f9',
                    }}
                  >
                    <div style={{ marginBottom: '0.75rem' }}>
                      <span className="badge badge-indigo">{report.category}</span>
                    </div>

                    {report.performance && (
                      <div style={{ marginBottom: '0.625rem' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          성과
                        </p>
                        <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {report.performance}
                        </p>
                      </div>
                    )}

                    {report.plan && (
                      <div style={{ marginBottom: '0.625rem' }}>
                        <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          계획
                        </p>
                        <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {report.plan}
                        </p>
                      </div>
                    )}

                    {report.issues && (
                      <div>
                        <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          이슈/협조사항
                        </p>
                        <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {report.issues}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
