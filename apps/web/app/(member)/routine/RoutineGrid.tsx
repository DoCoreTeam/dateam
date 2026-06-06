'use client'

import { useState, useTransition } from 'react'
import { upsertRoutineCheck } from './actions'
import { cn } from '@/lib/utils'
import type { RoutineCheck } from '@/types/database'
import type { RoutineItemParsed } from '@/lib/routine-defaults'

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

interface RoutineGridProps {
  weekDates: string[]
  weekStart: string
  initialChecks: RoutineCheck[]
  todayStr: string
  routineItems: RoutineItemParsed[]
}

function CheckBox({
  checked,
  disabled,
  isToday,
  label,
  onToggle,
}: {
  checked: boolean
  disabled: boolean
  isToday?: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      aria-pressed={checked}
      style={{
        width: '2rem',
        height: '2rem',
        borderRadius: '0.5rem',
        border: checked ? 'none' : `1.5px solid ${disabled && !isToday ? '#e2e8f0' : '#cbd5e1'}`,
        backgroundColor: checked ? 'var(--brand)' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled && !checked ? 0.35 : 1,
        transition: 'all 120ms cubic-bezier(0.16,1,0.3,1)',
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

export default function RoutineGrid({
  weekDates,
  weekStart,
  initialChecks,
  todayStr,
  routineItems,
}: RoutineGridProps) {
  const [isPending, startTransition] = useTransition()

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
      const result = await upsertRoutineCheck(routineName, checkDate, weekStart, newValue)
      if (result.error) {
        setChecks((prev) => ({ ...prev, [key]: !newValue }))
      }
    })
  }

  const weeklyItems = routineItems.filter((r) => r.freq === 'weekly')
  const dailyItems = routineItems.filter((r) => r.freq === 'daily')

  // 달성률 계산
  const weeklyTotal = weeklyItems.length
  const weeklyCompleted = weeklyItems.filter((r) => !!checks[`${r.name}|${weekStart}`]).length
  const dailyTotal = dailyItems.length * 7
  const dailyCompleted = dailyItems.reduce((sum, r) => {
    return sum + weekDates.filter((d) => !!checks[`${r.name}|${d}`]).length
  }, 0)

  const totalUnits = weeklyTotal + dailyTotal
  const completedUnits = weeklyCompleted + dailyCompleted
  const overallRate = totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0

  return (
    <div>
      {/* 달성률 요약 바 */}
      <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 500 }}>주간 달성률</span>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--brand)' }}>{overallRate}%</span>
        </div>
        <div style={{ height: '6px', borderRadius: '9999px', backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${overallRate}%`,
              borderRadius: '9999px',
              background: 'linear-gradient(90deg, var(--brand), var(--brand))',
              transition: 'width 300ms cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        </div>
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.5rem 0 0' }}>
          {completedUnits} / {totalUnits} 완료
        </p>
      </div>

      {/* 주간 루틴 (단일 체크박스) */}
      {weeklyItems.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', marginBottom: '1rem' }}>
          <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              주간 루틴
            </span>
            <span className="badge badge-slate" style={{ fontSize: '0.6875rem' }}>주 1회</span>
          </div>
          <div style={{ padding: '0.5rem 0' }}>
            {weeklyItems.map((item, idx) => {
              const key = `${item.name}|${weekStart}`
              const isChecked = !!checks[key]

              return (
                <div
                  key={item.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1.25rem',
                    borderBottom: idx < weeklyItems.length - 1 ? '1px solid #f1f5f9' : 'none',
                    backgroundColor: isChecked ? '#fafbff' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <CheckBox
                      checked={isChecked}
                      disabled={isPending}
                      label={`${item.name} 이번 주 ${isChecked ? '완료됨' : '미완료'}`}
                      onToggle={() => handleToggle(item.name, weekStart)}
                    />
                    <span
                      style={{
                        fontSize: '0.875rem',
                        color: isChecked ? '#374151' : '#374151',
                        fontWeight: 500,
                        textDecoration: isChecked ? 'none' : 'none',
                      }}
                    >
                      {item.name}
                    </span>
                  </div>
                  <span
                    className={cn('badge', isChecked ? 'badge-emerald' : 'badge-slate')}
                    style={{ fontSize: '0.6875rem' }}
                  >
                    {isChecked ? '완료' : '미완료'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 일간 루틴 (7일 그리드) */}
      {dailyItems.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {dailyItems.length > 0 && weeklyItems.length > 0 && (
            <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                일간 루틴
              </span>
              <span className="badge badge-slate" style={{ fontSize: '0.6875rem' }}>매일</span>
            </div>
          )}
          <div className="table-responsive">
            <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding: '1rem 1.25rem', textAlign: 'left', fontSize: '0.8125rem', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: '200px' }}>
                    루틴
                  </th>
                  {weekDates.map((date, i) => {
                    const isToday = date === todayStr
                    return (
                      <th key={date} style={{ padding: '1rem 0.5rem', textAlign: 'center', fontSize: '0.8125rem', fontWeight: 600, color: isToday ? 'var(--brand)' : '#64748b', borderBottom: '1px solid #e2e8f0', minWidth: '60px' }}>
                        <div>{DAY_LABELS[i]}</div>
                        <div style={{ fontSize: '0.75rem', fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--brand)' : '#94a3b8', marginTop: '0.125rem' }}>
                          {new Date(date).getDate()}
                        </div>
                        {isToday && <div style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--brand)', margin: '0.25rem auto 0' }} />}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {dailyItems.map((item, rIdx) => {
                  const rowCompleted = weekDates.filter((d) => checks[`${item.name}|${d}`]).length
                  const rowRate = Math.round((rowCompleted / 7) * 100)

                  return (
                    <tr key={item.name}>
                      <td className="card-header" style={{ padding: '0.875rem 1.25rem', borderBottom: rIdx < dailyItems.length - 1 ? '1px solid #f1f5f9' : 'none', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>{item.name}</span>
                          <span className={cn('badge', rowRate === 100 ? 'badge-emerald' : 'badge-slate')} style={{ fontSize: '0.6875rem', flexShrink: 0 }}>
                            {rowRate}%
                          </span>
                        </div>
                      </td>
                      {weekDates.map((date, i) => {
                        const key = `${item.name}|${date}`
                        const isChecked = !!checks[key]
                        const isToday = date === todayStr
                        const isFuture = date > todayStr

                        return (
                          <td key={date} data-label={DAY_LABELS[i]} style={{ padding: '0.875rem 0.5rem', textAlign: 'center', borderBottom: rIdx < dailyItems.length - 1 ? '1px solid #f1f5f9' : 'none', backgroundColor: isToday ? '#fafbff' : 'transparent' }}>
                            <CheckBox
                              checked={isChecked}
                              disabled={isPending || isFuture}
                              isToday={isToday}
                              label={`${item.name} ${date} ${isChecked ? '완료됨' : '미완료'}`}
                              onToggle={() => !isFuture && handleToggle(item.name, date)}
                            />
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
      )}

      {/* 루틴 없음 */}
      {weeklyItems.length === 0 && dailyItems.length === 0 && (
        <div className="card" style={{ padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
          등록된 루틴이 없습니다
        </div>
      )}
    </div>
  )
}
