'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, Pencil } from 'lucide-react'
import dynamic from 'next/dynamic'
import { upsertWeeklyReport } from './actions'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })

interface Row {
  category: string
  performance: string
  plan: string
  issues: string
}

interface WeeklyReportFormProps {
  weekOptions: string[]
  thisWeek: string
  initialWeek: string
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
  initialWeek,
  pastCategories,
  prefillRows,
}: WeeklyReportFormProps) {
  const router = useRouter()
  const [selectedWeek, setSelectedWeek] = useState(initialWeek)
  const [rows, setRows] = useState<Row[]>(prefillRows.length > 0 ? prefillRows : [{ ...EMPTY_ROW }])
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)

  type ModalTarget = { rowIdx: number; field: 'performance' | 'plan' | 'issues' } | null
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null)

  const FIELD_LABELS: Record<'performance' | 'plan' | 'issues', string> = {
    performance: '성과',
    plan: '계획',
    issues: '이슈/협조사항',
  }

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
      if (initialWeek !== thisWeek) {
        router.push('/weekly-report?tab=mine')
      } else {
        router.refresh()
      }
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

  const isEditMode = initialWeek !== thisWeek

  return (
    <>
    {modalTarget && (
      <EditorModal
        title={`${rows[modalTarget.rowIdx].category || '항목'} — ${FIELD_LABELS[modalTarget.field]}`}
        value={rows[modalTarget.rowIdx][modalTarget.field]}
        placeholder={
          modalTarget.field === 'performance' ? '이번 주 주요 성과…'
          : modalTarget.field === 'plan' ? '다음 주 계획…'
          : '이슈 또는 협조사항…'
        }
        onChange={(html) => updateRow(modalTarget.rowIdx, modalTarget.field, html)}
        onClose={() => setModalTarget(null)}
      />
    )}
    <form onSubmit={handleSubmit}>
      {/* 수정 모드 배너 */}
      {isEditMode && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.75rem 1rem', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
          borderRadius: '0.625rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#1d4ed8',
        }}>
          <span>✏️ <strong>{new Date(initialWeek).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 주</strong> 보고서 수정 중</span>
          <button
            type="button"
            onClick={() => router.push('/weekly-report?tab=mine')}
            style={{ fontSize: '0.8125rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '0.125rem 0.375rem' }}
          >
            취소
          </button>
        </div>
      )}
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
                <EditorCell
                  value={row.performance}
                  placeholder="이번 주 주요 성과…"
                  onClick={() => setModalTarget({ rowIdx: idx, field: 'performance' })}
                />
                {/* 계획 */}
                <EditorCell
                  value={row.plan}
                  placeholder="다음 주 계획…"
                  onClick={() => setModalTarget({ rowIdx: idx, field: 'plan' })}
                />
                {/* 이슈 */}
                <EditorCell
                  value={row.issues}
                  placeholder="이슈 또는 협조사항…"
                  onClick={() => setModalTarget({ rowIdx: idx, field: 'issues' })}
                />
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
    </>
  )
}

function EditorCell({
  value,
  placeholder,
  onClick,
}: {
  value: string
  placeholder: string
  onClick: () => void
}) {
  const hasContent = !!value && value !== '<p></p>'

  return (
    <td
      onClick={onClick}
      style={{
        padding: '0.5rem',
        verticalAlign: 'top',
        borderRight: '1px solid #f1f5f9',
        cursor: 'pointer',
        minHeight: '80px',
      }}
    >
      <div
        style={{
          minHeight: '80px',
          padding: '0.5rem 0.625rem',
          borderRadius: '0.5rem',
          border: '1px dashed #e2e8f0',
          position: 'relative',
          transition: 'border-color 120ms, background 120ms',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = '#a5b4fc'
          el.style.backgroundColor = '#f8f9ff'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = '#e2e8f0'
          el.style.backgroundColor = 'transparent'
        }}
      >
        {hasContent ? (
          <div
            className="report-rich"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            // HTML from Tiptap editor controlled by authenticated user
            dangerouslySetInnerHTML={{ __html: value }}
          />
        ) : (
          <span style={{ fontSize: '0.8125rem', color: '#cbd5e1' }}>{placeholder}</span>
        )}
        <div
          style={{
            position: 'absolute', top: '0.375rem', right: '0.375rem',
            color: '#a5b4fc', opacity: 0.7,
          }}
        >
          <Pencil size={11} />
        </div>
      </div>
    </td>
  )
}
