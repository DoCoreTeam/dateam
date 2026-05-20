'use client'

import { useState, useTransition } from 'react'
import { upsertRoutineCheck } from './actions'
import { cn } from '@/lib/utils'
import type { RoutineCheck } from '@/types/database'

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

interface RoutineGridProps {
  weekDates: string[] // ISO date strings, 월~일 7개
  weekStart: string
  initialChecks: RoutineCheck[]
  todayStr: string
  routineNames: string[]
}

export default function RoutineGrid({
  weekDates,
  weekStart,
  initialChecks,
  todayStr,
  routineNames,
}: RoutineGridProps) {
  const [isPending, startTransition] = useTransition()

  // 체크 상태: "routineName|checkDate" → boolean
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    initialChecks.forEach((c) => {
      map[`${c.routine_name}|${c.check_date}`] = c.is_completed
    })
    return map
  })

  function handleToggle(routineName: string, checkDate: string) {
    const key = `${routineName}|${checkDate}`
    const newValue = !checks[key]
    setChecks((prev) => ({ ...prev, [key]: newValue }))

    startTransition(async () => {
      await upsertRoutineCheck(routineName, checkDate, weekStart, newValue)
    })
  }

  const totalCells = routineNames.length * 7
  const completedCells = Object.values(checks).filter(Boolean).length
  const overallRate = Math.round((completedCells / totalCells) * 100)

  return (
    <div>
      {/* 달성률 요약 바 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 500 }}>주간 달성률</span>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#6366f1' }}>{overallRate}%</span>
        </div>
        <div
          style={{
            height: '6px',
            borderRadius: '9999px',
            backgroundColor: '#e2e8f0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${overallRate}%`,
              borderRadius: '9999px',
              background: 'linear-gradient(90deg, #6366f1, #818cf8)',
              transition: 'width 300ms cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        </div>
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.5rem 0 0' }}>
          {completedCells} / {totalCells} 완료
        </p>
      </div>

      {/* 루틴 그리드 */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
            <thead>
              <tr>
                <th
                  style={{
                    padding: '1rem 1.25rem',
                    textAlign: 'left',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: '#64748b',
                    borderBottom: '1px solid #e2e8f0',
                    width: '200px',
                  }}
                >
                  루틴
                </th>
                {weekDates.map((date, i) => {
                  const isToday = date === todayStr
                  return (
                    <th
                      key={date}
                      style={{
                        padding: '1rem 0.5rem',
                        textAlign: 'center',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: isToday ? '#6366f1' : '#64748b',
                        borderBottom: '1px solid #e2e8f0',
                        minWidth: '60px',
                      }}
                    >
                      <div>{DAY_LABELS[i]}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: isToday ? 700 : 400,
                          color: isToday ? '#6366f1' : '#94a3b8',
                          marginTop: '0.125rem',
                        }}
                      >
                        {new Date(date).getDate()}
                      </div>
                      {isToday && (
                        <div
                          style={{
                            width: '4px',
                            height: '4px',
                            borderRadius: '50%',
                            backgroundColor: '#6366f1',
                            margin: '0.25rem auto 0',
                          }}
                        />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {routineNames.map((routine, rIdx) => {
                const rowCompleted = weekDates.filter((d) => checks[`${routine}|${d}`]).length
                const rowRate = Math.round((rowCompleted / 7) * 100)

                return (
                  <tr key={routine}>
                    <td
                      style={{
                        padding: '0.875rem 1.25rem',
                        borderBottom: rIdx < routineNames.length - 1 ? '1px solid #f1f5f9' : 'none',
                        verticalAlign: 'middle',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>
                          {routine}
                        </span>
                        <span
                          className={cn('badge', rowRate === 100 ? 'badge-emerald' : 'badge-slate')}
                          style={{ fontSize: '0.6875rem', flexShrink: 0 }}
                        >
                          {rowRate}%
                        </span>
                      </div>
                    </td>
                    {weekDates.map((date) => {
                      const key = `${routine}|${date}`
                      const isChecked = !!checks[key]
                      const isToday = date === todayStr
                      const isFuture = date > todayStr

                      return (
                        <td
                          key={date}
                          style={{
                            padding: '0.875rem 0.5rem',
                            textAlign: 'center',
                            borderBottom: rIdx < routineNames.length - 1 ? '1px solid #f1f5f9' : 'none',
                            backgroundColor: isToday ? '#fafbff' : 'transparent',
                          }}
                        >
                          <button
                            onClick={() => !isFuture && handleToggle(routine, date)}
                            disabled={isPending || isFuture}
                            aria-label={`${routine} ${date} ${isChecked ? '완료됨' : '미완료'}`}
                            aria-pressed={isChecked}
                            style={{
                              width: '2rem',
                              height: '2rem',
                              borderRadius: '0.5rem',
                              border: isChecked
                                ? 'none'
                                : `1.5px solid ${isFuture ? '#e2e8f0' : '#cbd5e1'}`,
                              backgroundColor: isChecked ? '#6366f1' : 'transparent',
                              cursor: isFuture ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              opacity: isFuture ? 0.35 : 1,
                              transition: 'all 120ms cubic-bezier(0.16,1,0.3,1)',
                            }}
                          >
                            {isChecked && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path
                                  d="M2 6L5 9L10 3"
                                  stroke="white"
                                  strokeWidth="1.75"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
