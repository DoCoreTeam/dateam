'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Sparkles, CheckSquare, Square } from 'lucide-react'
import type { DailyLog } from '@/types/database'

interface WeeklyRow {
  category: string
  performance: string
  plan: string
  issues: string
}

interface DailyTaskSelectorProps {
  weekStart: string
  onGenerate: (rows: WeeklyRow[]) => void
}

const ENTRY_TYPE_LABEL: Record<string, string> = {
  done: '완료',
  doing: '진행중',
  planned: '예정',
  blocker: '이슈',
  note: '메모',
}

const ENTRY_TYPE_COLOR: Record<string, string> = {
  done: '#15803d',
  doing: '#0891b2',
  planned: '#7c3aed',
  blocker: '#dc2626',
  note: '#64748b',
}

const GENERATE_STEPS = [
  { label: '일일업무 분석 중…', detail: '선택된 업무를 분류하는 중' },
  { label: 'AI 생성 중…', detail: '주간보고 스타일로 변환하는 중' },
  { label: '결과 적용 중…', detail: '폼에 반영하는 중' },
]

export default function DailyTaskSelector({ weekStart, onGenerate }: DailyTaskSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
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

  useEffect(() => {
    if (isOpen && tasks.length === 0 && !loading) {
      fetchTasks()
    }
  }, [isOpen, tasks.length, loading, fetchTasks])

  function toggleTask(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)))
    }
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
      const res = await fetch('/api/weekly-report/generate-from-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: selected.map((t) => ({
            content: t.content,
            entry_type: t.entry_type,
            log_date: t.log_date,
            is_resolved: t.is_resolved,
            priority: t.priority,
          })),
        }),
      })
      const data = await res.json() as { rows?: WeeklyRow[]; error?: string }
      if (!res.ok || !data.rows) {
        setError(data.error ?? 'AI 생성 중 오류가 발생했습니다')
        return
      }
      onGenerate(data.rows)
      setIsOpen(false)
    } catch {
      setError('네트워크 오류가 발생했습니다')
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

  return (
    <div style={{ marginBottom: '1.25rem', border: '1px solid #e2e8f0', borderRadius: '0.75rem', overflow: 'hidden' }}>
      {/* 헤더 */}
      <button
        id="onboarding-daily-selector"
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.875rem 1rem', background: '#f8fafc', border: 'none', cursor: 'pointer',
          fontSize: '0.875rem', fontWeight: 600, color: '#475569',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Sparkles size={14} color="#7c3aed" />
          <span>일일업무에서 주간보고 생성</span>
          {tasks.length > 0 && (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 }}>
              ({selectedIds.size}/{tasks.length}개 선택)
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
      </button>

      {/* 패널 */}
      {isOpen && (
        <div style={{ padding: '1rem', borderTop: '1px solid #e2e8f0' }}>
          {loading && (
            <p style={{ fontSize: '0.8125rem', color: '#64748b', textAlign: 'center', padding: '1rem 0' }}>
              이번 주 업무를 불러오는 중…
            </p>
          )}

          {error && (
            <div role="alert" style={{ padding: '0.625rem 0.875rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', marginBottom: '0.75rem', fontSize: '0.8125rem', color: '#b91c1c' }}>
              {error}
            </div>
          )}

          {!loading && tasks.length === 0 && !error && (
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>
              이번 주 등록된 일일업무가 없습니다
            </p>
          )}

          {!loading && tasks.length > 0 && (
            <>
              {/* 전체 선택 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  onClick={toggleAll}
                  style={{ fontSize: '0.8125rem', color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem', padding: 0 }}
                >
                  {selectedIds.size === tasks.length
                    ? <CheckSquare size={14} />
                    : <Square size={14} />}
                  {selectedIds.size === tasks.length ? '전체 해제' : '전체 선택'}
                </button>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  {Object.keys(byDate).length}일치 업무
                </span>
              </div>

              {/* 날짜별 업무 목록 */}
              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {Object.entries(byDate)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, logs]) => (
                    <div key={date}>
                      <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.375rem' }}>
                        {new Date(date + 'T12:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {logs.map((task) => (
                          <label
                            key={task.id}
                            style={{
                              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                              padding: '0.5rem 0.625rem', borderRadius: '0.5rem', cursor: 'pointer',
                              background: selectedIds.has(task.id) ? '#f5f3ff' : '#fafafa',
                              border: `1px solid ${selectedIds.has(task.id) ? '#ddd6fe' : '#f1f5f9'}`,
                              transition: 'background 120ms',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(task.id)}
                              onChange={() => toggleTask(task.id)}
                              style={{ marginTop: '2px', flexShrink: 0, accentColor: '#7c3aed' }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.125rem' }}>
                                <span style={{
                                  fontSize: '0.6875rem', fontWeight: 600,
                                  color: ENTRY_TYPE_COLOR[task.entry_type] ?? '#64748b',
                                  background: '#f8fafc', border: '1px solid #e2e8f0',
                                  borderRadius: '0.25rem', padding: '0 0.3rem',
                                }}>
                                  {ENTRY_TYPE_LABEL[task.entry_type] ?? task.entry_type}
                                </span>
                              </div>
                              <p style={{ fontSize: '0.8125rem', color: '#0f172a', margin: 0, lineHeight: 1.5 }}>
                                {task.content}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>

              {/* 생성 버튼 */}
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                {generating && (
                  <span style={{ fontSize: '0.8125rem', color: '#64748b', marginRight: '0.75rem', alignSelf: 'center' }}>
                    {currentStep.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || selectedIds.size === 0}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.625rem 1.25rem', borderRadius: '0.5rem',
                    background: generating || selectedIds.size === 0 ? '#e2e8f0' : 'linear-gradient(135deg, #7c3aed, var(--brand))',
                    color: generating || selectedIds.size === 0 ? '#94a3b8' : '#fff',
                    border: 'none', cursor: generating || selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem', fontWeight: 600,
                    transition: 'opacity 120ms',
                  }}
                >
                  <Sparkles size={14} />
                  {generating ? '생성 중...' : `주간보고 생성 (${selectedIds.size}개 업무)`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
