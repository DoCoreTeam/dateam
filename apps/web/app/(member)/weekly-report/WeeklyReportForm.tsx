'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save } from 'lucide-react'
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

  const dateRange = getWeekDateRange(selectedWeek)

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateRow(idx: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }

  function handleWeekChange(week: string) {
    setSelectedWeek(week)
    setRows([{ ...EMPTY_ROW }])
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

  const TH: React.CSSProperties = {
    padding: '0.625rem 0.875rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#64748b',
    background: '#f8fafc',
    textAlign: 'left',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
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

      {/* category 자동완성 */}
      <datalist id="category-list">
        {pastCategories.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* 테이블 */}
      <div style={{ overflowX: 'auto', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '120px' }} />
            <col />
            <col />
            <col />
            <col style={{ width: '40px' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH}>구분</th>
              <th style={{ ...TH, color: '#6366f1' }}>성과 <span style={{ color: '#94a3b8', fontWeight: 400 }}>({dateRange.perf})</span></th>
              <th style={{ ...TH, color: '#0891b2' }}>계획 <span style={{ color: '#94a3b8', fontWeight: 400 }}>({dateRange.plan})</span></th>
              <th style={{ ...TH, color: '#dc2626' }}>이슈/협조사항</th>
              <th style={TH} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: idx < rows.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                {/* 구분 */}
                <td style={{ padding: '0.75rem 0.875rem', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>
                  <input
                    type="text"
                    list="category-list"
                    value={row.category}
                    onChange={(e) => updateRow(idx, 'category', e.target.value)}
                    placeholder="구분"
                    style={{
                      width: '100%',
                      border: 'none',
                      outline: 'none',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      background: 'transparent',
                      fontFamily: 'inherit',
                    }}
                  />
                </td>
                {/* 성과 */}
                <td style={{ padding: '0.5rem', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>
                  <TiptapEditor
                    value={row.performance}
                    onChange={(html) => updateRow(idx, 'performance', html)}
                    placeholder="이번 주 주요 성과…"
                    minHeight={120}
                  />
                </td>
                {/* 계획 */}
                <td style={{ padding: '0.5rem', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>
                  <TiptapEditor
                    value={row.plan}
                    onChange={(html) => updateRow(idx, 'plan', html)}
                    placeholder="다음 주 계획…"
                    minHeight={120}
                  />
                </td>
                {/* 이슈 */}
                <td style={{ padding: '0.5rem', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>
                  <TiptapEditor
                    value={row.issues}
                    onChange={(html) => updateRow(idx, 'issues', html)}
                    placeholder="이슈 또는 협조사항…"
                    minHeight={120}
                  />
                </td>
                {/* 삭제 */}
                <td style={{ padding: '0.5rem', verticalAlign: 'top', textAlign: 'center' }}>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      title="행 삭제"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '0.25rem', display: 'inline-flex' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 행 추가 + 저장 */}
      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          onClick={addRow}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            fontSize: '0.8125rem', color: '#6366f1', background: 'none',
            border: '1px dashed #c7d2fe', borderRadius: '0.5rem',
            padding: '0.5rem 0.875rem', cursor: 'pointer',
          }}
        >
          <Plus size={14} />
          행 추가
        </button>
        <button type="submit" className="btn-primary" disabled={pending}>
          <Save size={15} />
          {pending ? '저장 중...' : '저장'}
        </button>
      </div>
    </form>
  )
}
