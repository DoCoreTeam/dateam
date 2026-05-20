'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, ChevronDown } from 'lucide-react'
import dynamic from 'next/dynamic'
import { upsertWeeklyReport } from './actions'

const TiptapEditor = dynamic(() => import('@/components/ui/TiptapEditor'), { ssr: false })

interface Row {
  category: string
  performance: string
  plan: string
  issues: string
}

interface WeeklyReportFormProps {
  weekOptions: string[]
  thisWeek: string
  pastCategories: string[]
  prefillRows: Row[]
}

function getWeekDateRange(weekStart: string): { perf: string; plan: string } {
  const start = new Date(weekStart)
  const perfEnd = new Date(start)
  perfEnd.setDate(start.getDate() + 4)

  const planStart = new Date(start)
  planStart.setDate(start.getDate() + 7)
  const planEnd = new Date(planStart)
  planEnd.setDate(planStart.getDate() + 4)

  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`

  return {
    perf: `${fmt(start)}~${fmt(perfEnd)}`,
    plan: `${fmt(planStart)}~${fmt(planEnd)}`,
  }
}

const EMPTY_ROW: Row = { category: '', performance: '', plan: '', issues: '' }

export default function WeeklyReportForm({
  weekOptions,
  thisWeek,
  pastCategories,
  prefillRows,
}: WeeklyReportFormProps) {
  const router = useRouter()
  const [selectedWeek, setSelectedWeek] = useState(thisWeek)
  const [rows, setRows] = useState<Row[]>(prefillRows.length > 0 ? prefillRows : [{ ...EMPTY_ROW }])
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const dateRange = getWeekDateRange(selectedWeek)

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx))
    setCollapsed((prev) => {
      const next = new Set<number>()
      prev.forEach((i) => { if (i < idx) next.add(i); else if (i > idx) next.add(i - 1) })
      return next
    })
  }

  function updateRow(idx: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }

  function toggleCollapse(idx: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function handleWeekChange(week: string) {
    setSelectedWeek(week)
    setRows([{ ...EMPTY_ROW }])
    setCollapsed(new Set())
    setSubmitSuccess(false)
    setSubmitError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setSubmitError('')
    setSubmitSuccess(false)

    const formData = new FormData()
    formData.set('week_start', selectedWeek)
    formData.set('row_count', String(rows.length))
    rows.forEach((r, i) => {
      formData.set(`row_category_${i}`, r.category)
      formData.set(`row_performance_${i}`, r.performance)
      formData.set(`row_plan_${i}`, r.plan)
      formData.set(`row_issues_${i}`, r.issues)
    })

    const result = await upsertWeeklyReport(formData)

    if (result.ok) {
      setSubmitSuccess(true)
      router.refresh()
    } else {
      setSubmitError(result.error)
    }

    setPending(false)
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* 주차 선택 */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="week_start" className="label">주차</label>
        <select
          id="week_start"
          required
          className="input-field"
          style={{ cursor: 'pointer', maxWidth: '320px' }}
          value={selectedWeek}
          onChange={(e) => handleWeekChange(e.target.value)}
        >
          {weekOptions.map((w) => (
            <option key={w} value={w}>
              {new Date(w).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 주
              {w === thisWeek ? ' (이번 주)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 알림 */}
      {submitError && (
        <div role="alert" style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.625rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#b91c1c' }}>
          {submitError}
        </div>
      )}
      {submitSuccess && (
        <div role="status" style={{ padding: '0.75rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.625rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#15803d' }}>
          주간보고가 저장되었습니다
        </div>
      )}

      {/* category 자동완성 datalist */}
      <datalist id="category-list">
        {pastCategories.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* 섹션 카드 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {rows.map((row, idx) => {
          const isCollapsed = collapsed.has(idx)
          return (
            <div
              key={idx}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '0.75rem',
                overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              {/* 카드 헤더 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: '0.625rem 1rem',
                  background: '#f8fafc',
                  borderBottom: isCollapsed ? 'none' : '1px solid #e2e8f0',
                }}
              >
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', minWidth: '1.25rem' }}>
                  {idx + 1}
                </span>
                <input
                  type="text"
                  list="category-list"
                  value={row.category}
                  onChange={(e) => updateRow(idx, 'category', e.target.value)}
                  placeholder="구분 (예: 개발, 기획, 운영…)"
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    fontFamily: 'inherit',
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleCollapse(idx)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.25rem', display: 'flex' }}
                  title={isCollapsed ? '펼치기' : '접기'}
                >
                  <ChevronDown
                    size={16}
                    style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 200ms' }}
                  />
                </button>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '0.25rem', display: 'flex' }}
                    title="섹션 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* 카드 바디 (에디터 3개) */}
              {!isCollapsed && (
                <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* 성과 */}
                  <div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#6366f1',
                        marginBottom: '0.375rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      성과 <span style={{ color: '#94a3b8', fontWeight: 400 }}>({dateRange.perf})</span>
                    </div>
                    <TiptapEditor
                      value={row.performance}
                      onChange={(html) => updateRow(idx, 'performance', html)}
                      placeholder="이번 주 주요 성과를 입력하세요…"
                      minHeight={100}
                    />
                  </div>

                  {/* 계획 */}
                  <div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#0891b2',
                        marginBottom: '0.375rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      계획 <span style={{ color: '#94a3b8', fontWeight: 400 }}>({dateRange.plan})</span>
                    </div>
                    <TiptapEditor
                      value={row.plan}
                      onChange={(html) => updateRow(idx, 'plan', html)}
                      placeholder="다음 주 계획을 입력하세요…"
                      minHeight={100}
                    />
                  </div>

                  {/* 이슈 */}
                  <div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#dc2626',
                        marginBottom: '0.375rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      이슈/협조사항
                    </div>
                    <TiptapEditor
                      value={row.issues}
                      onChange={(html) => updateRow(idx, 'issues', html)}
                      placeholder="이슈 또는 협조사항을 입력하세요…"
                      minHeight={80}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 섹션 추가 + 저장 */}
      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          onClick={addRow}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            fontSize: '0.8125rem',
            color: '#6366f1',
            background: 'none',
            border: '1px dashed #c7d2fe',
            borderRadius: '0.5rem',
            padding: '0.5rem 0.875rem',
            cursor: 'pointer',
          }}
        >
          <Plus size={14} />
          섹션 추가
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          <Save size={15} />
          {pending ? '저장 중...' : '저장'}
        </button>
      </div>
    </form>
  )
}
