'use client'

import { useMemo, useState, useTransition } from 'react'
import { upsertRoutineCheck } from './actions'
import { cn } from '@/lib/utils'
import type { RoutineCheck } from '@/types/database'
import type { RoutineItemParsed } from '@/lib/routine-defaults'
import EmptyState from '@/components/ui/EmptyState'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { resolveListQuery } from '@/lib/ui/list-query'

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
        borderRadius: 'var(--radius)',
        border: checked ? 'none' : `1.5px solid ${disabled && !isToday ? 'var(--color-border)' : 'var(--border-subtle)'}`,
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
          <path d="M2 6L5 9L10 3" stroke="var(--brand-fg)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
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
  // 검색·정렬·페이지가 없는 고정 매트릭스 — URL 상태를 만들지 않고 표 렌더러만 재사용한다
  const listQuery = useMemo(
    () => resolveListQuery(new URLSearchParams(), { sort: { key: 'name', dir: 'asc' }, view: 'table' }),
    [],
  )

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

  // 컬럼은 한 벌만 선언한다 — 표와 모바일 카드를 같은 정의로 그린다
  const dailyColumns: ColumnDef<RoutineItemParsed>[] = [
    {
      key: 'name', header: '루틴', primary: true, width: '200px',
      cell: (item) => {
        const rowCompleted = weekDates.filter((d) => checks[`${item.name}|${d}`]).length
        const rowRate = Math.round((rowCompleted / 7) * 100)
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text)', fontWeight: 500 }}>{item.name}</span>
            <span className={cn('badge', rowRate === 100 ? 'badge-emerald' : 'badge-slate')} style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>
              {rowRate}%
            </span>
          </div>
        )
      },
    },
    ...weekDates.map((date, i) => ({
      key: date,
      header: `${DAY_LABELS[i]} ${new Date(date).getDate()}`,
      align: 'left' as const,
      cell: (item: RoutineItemParsed) => {
        const key = `${item.name}|${date}`
        const isChecked = !!checks[key]
        const isToday = date === todayStr
        const isFuture = date > todayStr
        return (
          <CheckBox
            checked={isChecked}
            disabled={isPending || isFuture}
            isToday={isToday}
            label={`${item.name} ${date} ${isChecked ? '완료됨' : '미완료'}`}
            onToggle={() => !isFuture && handleToggle(item.name, date)}
          />
        )
      },
    })),
  ]

  return (
    <div>
      {/* 달성률 요약 바 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', fontWeight: 500 }}>주간 달성률</span>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--brand)' }}>{overallRate}%</span>
        </div>
        <div style={{ height: '6px', borderRadius: '9999px', backgroundColor: 'var(--color-border)', overflow: 'hidden' }}>
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
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', margin: '0.5rem 0 0' }}>
          {completedUnits} / {totalUnits} 완료
        </p>
      </div>

      {/* 주간 루틴 (단일 체크박스) */}
      {weeklyItems.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', marginBottom: '1rem' }}>
          <div style={{ padding: '0.875rem 1.25rem', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              주간 루틴
            </span>
            <span className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>주 1회</span>
          </div>
          <div style={{ padding: 'var(--space-2) var(--space-0)' }}>
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
                    padding: 'var(--space-3) var(--space-5)',
                    borderBottom: idx < weeklyItems.length - 1 ? 'var(--hairline) solid var(--surface-muted)' : 'none',
                    backgroundColor: isChecked ? 'var(--surface-bg)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <CheckBox
                      checked={isChecked}
                      disabled={isPending}
                      label={`${item.name} 이번 주 ${isChecked ? '완료됨' : '미완료'}`}
                      onToggle={() => handleToggle(item.name, weekStart)}
                    />
                    <span
                      style={{
                        fontSize: 'var(--fs-base)',
                        color: isChecked ? 'var(--text)' : 'var(--text)',
                        fontWeight: 500,
                        textDecoration: isChecked ? 'none' : 'none',
                      }}
                    >
                      {item.name}
                    </span>
                  </div>
                  <span
                    className={cn('badge', isChecked ? 'badge-emerald' : 'badge-slate')}
                    style={{ fontSize: 'var(--fs-2xs)' }}
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
            <div style={{ padding: '0.875rem 1.25rem', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                일간 루틴
              </span>
              <span className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>매일</span>
            </div>
          )}
          <ListSurface
            rows={dailyItems}
            columns={dailyColumns}
            query={listQuery}
            rowKey={(item) => item.name}
            empty={{ title: '일간 루틴이 없어요', description: '관리자가 루틴 템플릿을 등록하면 여기에 표시됩니다' }}
          />
        </div>
      )}

      {/* 루틴 없음 */}
      {weeklyItems.length === 0 && dailyItems.length === 0 && (
        <EmptyState
          title="등록된 루틴이 없어요"
          description="관리자가 루틴 템플릿을 만들면 이 주의 체크 항목이 나타납니다"
        />
      )}
    </div>
  )
}
