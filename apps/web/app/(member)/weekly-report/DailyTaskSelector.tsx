'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import DailyTaskItem from './DailyTaskItem'
import { generateWeeklyRows, type WeeklyRow } from '@/lib/weekly-report/generate-client'
import type { DailyLog } from '@/types/database'

interface DailyTaskSelectorProps {
  weekStart: string
  onGenerate: (rows: WeeklyRow[]) => void
  /** 'inline'=폼 상단 접이식(기본), 'side'=우측 사이드패널(상시 펼침·소형). */
  variant?: 'inline' | 'side'
}

const GENERATE_STEPS = [
  { label: '일일업무 분석 중…', detail: '선택된 업무를 분류하는 중' },
  { label: 'AI 생성 중…', detail: '주간보고 스타일로 변환하는 중' },
  { label: '결과 적용 중…', detail: '폼에 반영하는 중' },
]

export default function DailyTaskSelector({ weekStart, onGenerate, variant = 'inline' }: DailyTaskSelectorProps) {
  const isSide = variant === 'side'
  const [isOpen, setIsOpen] = useState(isSide) // 사이드 변형은 상시 펼침
  const [tasks, setTasks] = useState<DailyLog[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateStep, setGenerateStep] = useState(0)
  const [error, setError] = useState('')

  const fetchTasks = useCallback(async () => {
    if (!weekStart) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/daily/week?start=${weekStart}`)
      if (!res.ok) throw new Error('업무 조회 실패')
      const data = await res.json() as DailyLog[]
      const filtered = data.filter((t) => t.content?.trim())
      setTasks(filtered)
      setSelectedIds(new Set(filtered.map((t) => t.id)))
    } catch {
      setError('일일업무를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  // 페치는 weekStart별로 1회만. deps에 tasks.length/loading을 넣으면 일일보고가 없는
  // 주차(빈 결과)에서 loading이 true→false로 토글될 때마다 조건이 재충족되어 무한
  // 재요청 루프(=화면 깜빡임)가 발생한다. ref 가드로 주차당 1회만 페치한다.
  const fetchedWeekRef = useRef<string | null>(null)
  useEffect(() => {
    if (isOpen && fetchedWeekRef.current !== weekStart) {
      fetchedWeekRef.current = weekStart
      fetchTasks()
    }
  }, [isOpen, weekStart, fetchTasks])

  function toggleTask(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 마스터 체크박스(전체선택/해제) — 3-state indeterminate.
  const masterRef = useRef<HTMLInputElement>(null)
  const allSelected = tasks.length > 0 && selectedIds.size === tasks.length
  const someSelected = selectedIds.size > 0 && !allSelected
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someSelected
  }, [someSelected])
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(tasks.map((t) => t.id)))
  }

  async function handleGenerate() {
    const selected = tasks.filter((t) => selectedIds.has(t.id))
    if (selected.length === 0) {
      setError('최소 1개 이상의 업무를 선택해 주세요')
      return
    }
    setError('')
    setGenerating(true)
    setGenerateStep(0)

    const stepTimers: ReturnType<typeof setTimeout>[] = []
    stepTimers.push(setTimeout(() => setGenerateStep(1), 1000))
    stepTimers.push(setTimeout(() => setGenerateStep(2), 4000))

    try {
      const rows = await generateWeeklyRows(
        selected.map((t) => ({
          content: t.content,
          entry_type: t.entry_type,
          log_date: t.log_date,
          is_resolved: t.is_resolved,
          priority: t.priority,
        })),
      )
      onGenerate(rows)
      if (!isSide) setIsOpen(false) // 사이드 변형은 반영 후에도 계속 열어둠
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류가 발생했습니다')
    } finally {
      stepTimers.forEach(clearTimeout)
      setGenerating(false)
    }
  }

  const byDate = tasks.reduce<Record<string, DailyLog[]>>((acc, t) => {
    if (!acc[t.log_date]) acc[t.log_date] = []
    acc[t.log_date].push(t)
    return acc
  }, {})

  const currentStep = GENERATE_STEPS[Math.min(generateStep, GENERATE_STEPS.length - 1)]

  const headerInner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Sparkles size={14} color="var(--brand)" />
        <span>{isSide ? '일일보고에서 가져오기' : '일일업무에서 주간보고 생성'}</span>
        {tasks.length > 0 && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontWeight: 400 }}>
            ({selectedIds.size}/{tasks.length}개 선택)
          </span>
        )}
      </div>
      {!isSide && (isOpen ? <ChevronUp size={16} color="var(--text-faint)" /> : <ChevronDown size={16} color="var(--text-faint)" />)}
    </>
  )

  return (
    <div style={{ marginBottom: isSide ? 0 : '1.25rem', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {/* 헤더 — 사이드 변형은 정적(토글 아님), 인라인 변형은 접이식 버튼 */}
      {isSide ? (
        <div
          id="onboarding-daily-selector"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.75rem 0.875rem', background: 'var(--color-bg)',
            fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)',
          }}
        >
          {headerInner}
        </div>
      ) : (
        <button
          id="onboarding-daily-selector"
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.875rem 1rem', background: 'var(--color-bg)', border: 'none', cursor: 'pointer',
            fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-muted)',
          }}
        >
          {headerInner}
        </button>
      )}

      {/* 패널 */}
      {isOpen && (
        <div style={{ padding: 'var(--space-4)', borderTop: 'var(--border-w-2) solid var(--border-color)' }}>
          {loading && (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-4) var(--space-0)' }}>
              이번 주 업무를 불러오는 중…
            </p>
          )}

          {error && (
            <div role="alert" style={{ padding: '0.625rem 0.875rem', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          {!loading && tasks.length === 0 && !error && (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', textAlign: 'center', padding: 'var(--space-4) var(--space-0)' }}>
              이번 주 등록된 일일업무가 없습니다
            </p>
          )}

          {!loading && tasks.length > 0 && (
            <>
              {/* 전체 선택 — 마스터 체크박스(3-state) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--brand)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <input ref={masterRef} type="checkbox" checked={allSelected} onChange={toggleAll}
                    aria-label={allSelected ? '전체 해제' : '전체 선택'}
                    style={{ accentColor: 'var(--brand)', cursor: 'pointer' }} />
                  {allSelected ? '전체 해제' : '전체 선택'}
                </label>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                  {Object.keys(byDate).length}일치 업무
                </span>
              </div>

              {/* 날짜별 업무 목록 */}
              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {Object.entries(byDate)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, logs]) => (
                    <div key={date}>
                      <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.375rem' }}>
                        {new Date(date + 'T12:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        {logs.map((task) => (
                          <DailyTaskItem
                            key={task.id}
                            task={task}
                            checked={selectedIds.has(task.id)}
                            onToggle={toggleTask}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>

              {/* 생성 버튼 */}
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                {generating && (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginRight: '0.75rem', alignSelf: 'center' }}>
                    {currentStep.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || selectedIds.size === 0}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: '0.625rem 1.25rem', borderRadius: 'var(--radius)',
                    background: generating || selectedIds.size === 0 ? 'var(--color-border)' : 'linear-gradient(135deg, var(--brand), var(--brand))',
                    color: generating || selectedIds.size === 0 ? 'var(--text-faint)' : '#fff',
                    border: 'none', cursor: generating || selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                    fontSize: 'var(--fs-base)', fontWeight: 600,
                    transition: 'opacity 120ms',
                  }}
                >
                  <Sparkles size={14} />
                  {generating ? '생성 중...' : isSide ? `폼에 반영 (${selectedIds.size})` : `주간보고 생성 (${selectedIds.size}개 업무)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
