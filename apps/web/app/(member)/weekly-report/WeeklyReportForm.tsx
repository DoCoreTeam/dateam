'use client'

import { useState, useTransition, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, Pencil, AlertTriangle, RotateCcw, Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'
import { upsertWeeklyReport, deleteAllWeeklyReports } from './actions'
import DiffConfirmModal, { type DiffItem } from '@/components/ui/DiffConfirmModal'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })
const SpotlightOnboarding = dynamic(() => import('@/components/ui/SpotlightOnboarding'), { ssr: false })

const REFINE_STEPS = [
  { label: '내용 분석 중…',    detail: '입력 내용과 전주 데이터 비교 중' },
  { label: 'AI 정비 중…',      detail: 'Gemini AI가 내용을 다듬는 중' },
  { label: '결과 적용 중…',    detail: '정비된 내용을 반영하는 중' },
]

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
  isFirstTimeUser: boolean
  hasCarryForward?: boolean
  hasSavedData?: boolean
  prevWeekCategories?: string[]
  orgName?: string
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
  isFirstTimeUser,
  hasCarryForward = false,
  hasSavedData = false,
  prevWeekCategories = [],
  orgName = '',
}: WeeklyReportFormProps) {
  const router = useRouter()
  const [selectedWeek, setSelectedWeek] = useState(initialWeek)
  const [rows, setRows] = useState<Row[]>(prefillRows.length > 0 ? prefillRows : [{ ...EMPTY_ROW }])
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetPending, startResetTransition] = useTransition()
  const [isRefining, setIsRefining] = useState(false)
  const [refineError, setRefineError] = useState('')
  const [refineStep, setRefineStep] = useState(0)
  const [refineElapsed, setRefineElapsed] = useState(0)
  const [highlightedKeys, setHighlightedKeys] = useState<Set<string>>(new Set())
  const [diffItems, setDiffItems] = useState<DiffItem[]>([])
  const [showDiffModal, setShowDiffModal] = useState(false)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refineTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([])
  const refineIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const refinedRowsRef = useRef<Row[]>([])

  function clearRefineTimers() {
    refineTimerRefs.current.forEach(clearTimeout)
    refineTimerRefs.current = []
    if (refineIntervalRef.current) { clearInterval(refineIntervalRef.current); refineIntervalRef.current = null }
  }

  useEffect(() => () => { clearRefineTimers() }, [])

  const handleRefine = useCallback(async () => {
    clearRefineTimers()
    setRefineError('')
    setRefineStep(0)
    setRefineElapsed(0)
    setIsRefining(true)

    const startedAt = Date.now()
    refineIntervalRef.current = setInterval(() => setRefineElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500)
    refineTimerRefs.current.push(setTimeout(() => setRefineStep(1), 1200))
    refineTimerRefs.current.push(setTimeout(() => setRefineStep(2), 5500))

    try {
      const res = await fetch('/api/weekly-report/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, prevCategories: prevWeekCategories }),
      })
      const data = await res.json() as { rows?: Row[]; error?: string }
      if (!res.ok || !data.rows) {
        setRefineError(data.error ?? 'AI 정비 중 오류가 발생했습니다')
        return
      }
      const refined: Row[] = data.rows
      refinedRowsRef.current = refined

      const fields: Array<DiffItem['field']> = ['performance', 'plan', 'issues']
      const items: DiffItem[] = []
      refined.forEach((r) => {
        const orig = rows.find((o) => o.category === r.category)
        if (!orig) return
        fields.forEach((f) => {
          if (r[f] !== orig[f]) {
            items.push({ category: r.category, field: f, original: orig[f], refined: r[f], accepted: true })
          }
        })
      })

      if (items.length === 0) {
        setRefineError('변경된 내용이 없습니다')
        return
      }

      setDiffItems(items)
      setShowDiffModal(true)
    } catch {
      setRefineError('네트워크 오류가 발생했습니다')
    } finally {
      clearRefineTimers()
      setIsRefining(false)
    }
  }, [rows, prevWeekCategories])

  const handleDiffConfirm = useCallback((confirmedItems: DiffItem[]) => {
    setShowDiffModal(false)
    const fields: Array<DiffItem['field']> = ['performance', 'plan', 'issues']
    const newRows = refinedRowsRef.current.map((refined) => {
      const orig = rows.find((o) => o.category === refined.category)
      if (!orig) return refined
      const applied = { ...refined }
      fields.forEach((f) => {
        const di = confirmedItems.find((d) => d.category === refined.category && d.field === f)
        applied[f] = di ? (di.accepted ? di.refined : di.original) : refined[f]
      })
      return applied
    })
    const changed = new Set<string>()
    confirmedItems.filter((i) => i.accepted).forEach((i) => changed.add(`${i.category}-${i.field}`))
    setRows(newRows)
    setHighlightedKeys(changed)
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedKeys(new Set()), 4000)
  }, [rows])

  const hasExistingData = hasSavedData

  function handleReset() {
    setResetError('')
    startResetTransition(async () => {
      const result = await deleteAllWeeklyReports(initialWeek)
      if (result.ok) {
        const dest = initialWeek !== thisWeek
          ? `/weekly-report?tab=mine&editWeek=${initialWeek}&reset=1`
          : '/weekly-report?tab=mine&reset=1'
        router.push(dest)
      } else {
        setResetError(result.error)
      }
    })
  }

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
    router.push(`/weekly-report?tab=mine&editWeek=${week}`)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setSubmitError('')

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
      router.push('/weekly-report?tab=mine&saved=1')
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
    <style>{`
      @keyframes progress-indeterminate {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
    `}</style>
    <SpotlightOnboarding autoStart={isFirstTimeUser} />

    {/* 전체화면 AI 다듬기 로딩 오버레이 */}
    {isRefining && (
      <div
        role="status"
        aria-live="polite"
        aria-label={`AI로 다듬는 중 — ${REFINE_STEPS[Math.min(refineStep, REFINE_STEPS.length - 1)].label}`}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(248,247,255,0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      >
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          {orgName && (
            <div aria-hidden style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '0.08em', userSelect: 'none' }}>
              {orgName.split('').map((ch, i) => (
                <span key={i} style={{ display: 'inline-block', animation: 'char-wave 1.8s ease-in-out infinite', animationDelay: `${i * 0.12}s` }}>
                  {ch}
                </span>
              ))}
            </div>
          )}
          <span aria-hidden style={{ fontSize: '0.875rem', color: '#6d28d9', fontWeight: 600 }}>
            {REFINE_STEPS[Math.min(refineStep, REFINE_STEPS.length - 1)].label}
          </span>
          <div role="progressbar" aria-busy="true" aria-label="AI 다듬기 진행 중" style={{ width: 120, height: 3, borderRadius: 3, background: '#ede9fe', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '40%', borderRadius: 3, background: '#8b5cf6', animation: 'progress-indeterminate 1.4s ease-in-out infinite' }} />
          </div>
          <span aria-hidden style={{ fontSize: '0.75rem', color: '#a78bfa' }}>{refineElapsed}초</span>
        </div>
      </div>
    )}

    {showDiffModal && (
      <DiffConfirmModal
        items={diffItems}
        onConfirm={handleDiffConfirm}
        onCancel={() => setShowDiffModal(false)}
      />
    )}

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
      {/* carry-forward 안내 */}
      {hasCarryForward && (
        <div role="status" aria-live="polite" style={{
          padding: '0.75rem 1rem', backgroundColor: '#eff6ff',
          border: '1px solid #bfdbfe', borderRadius: '0.625rem',
          marginBottom: '1rem', fontSize: '0.8125rem', color: '#1d4ed8',
        }}>
          전주 계획에서 성과를 이월했습니다. 실제 성과로 수정 후 저장해 주세요.
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
      {refineError && (
        <div role="alert" style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.625rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#b91c1c' }}>
          {refineError}
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
                <td
                  id={idx === 0 ? 'onboarding-category' : undefined}
                  style={{ padding: '0.75rem 0.875rem', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}
                >
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
                  id={idx === 0 ? 'onboarding-performance' : undefined}
                  value={row.performance}
                  placeholder="이번 주 주요 성과…"
                  highlighted={highlightedKeys.has(`${row.category}-performance`)}
                  onClick={() => setModalTarget({ rowIdx: idx, field: 'performance' })}
                />
                {/* 계획 */}
                <EditorCell
                  id={idx === 0 ? 'onboarding-plan' : undefined}
                  value={row.plan}
                  placeholder="다음 주 계획…"
                  highlighted={highlightedKeys.has(`${row.category}-plan`)}
                  onClick={() => setModalTarget({ rowIdx: idx, field: 'plan' })}
                />
                {/* 이슈 */}
                <EditorCell
                  id={idx === 0 ? 'onboarding-issues' : undefined}
                  value={row.issues}
                  placeholder="이슈 또는 협조사항…"
                  highlighted={highlightedKeys.has(`${row.category}-issues`)}
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

      {/* 행 추가 + 초기화 + 저장 */}
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
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {hasExistingData && !showResetConfirm && (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              disabled={pending || resetPending || isRefining}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                fontSize: '0.8125rem', color: '#dc2626', background: '#fff1f2',
                border: '1px solid #fecaca', borderRadius: '0.5rem',
                padding: '0.5rem 0.875rem', cursor: 'pointer',
              }}
            >
              <RotateCcw size={13} />
              초기화
            </button>
          )}
          <button
            type="button"
            onClick={handleRefine}
            disabled={pending || resetPending || isRefining}
            title="AI가 작성한 내용을 정비합니다 (빈 항목에는 내용을 생성하지 않습니다)"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              fontSize: '0.8125rem', color: '#7c3aed', background: '#f5f3ff',
              border: '1px solid #ddd6fe', borderRadius: '0.5rem',
              padding: '0.5rem 0.875rem', cursor: isRefining ? 'wait' : 'pointer',
              opacity: isRefining ? 0.7 : 1,
            }}
          >
            <Sparkles size={13} />
            {isRefining ? '다듬는 중...' : 'AI로 다듬기'}
          </button>
          <button type="submit" className="btn-primary" disabled={pending || resetPending || isRefining}>
            <Save size={15} />
            {pending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>


      {/* 초기화 강성 경고 */}
      {showResetConfirm && (
        <div style={{
          marginTop: '1rem', padding: '1rem',
          backgroundColor: '#fff1f2', border: '1px solid #fca5a5', borderRadius: '0.75rem',
        }}>
          <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
            <AlertTriangle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div>
              <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#b91c1c', margin: '0 0 0.375rem' }}>
                정말 초기화하시겠습니까?
              </p>
              <p style={{ fontSize: '0.8125rem', color: '#7f1d1d', margin: 0, lineHeight: 1.6 }}>
                <strong>{new Date(initialWeek).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 주</strong>에 저장된
                보고서 전체가 삭제되며 <strong>복구가 어렵습니다.</strong>
              </p>
            </div>
          </div>
          {resetError && (
            <p style={{ fontSize: '0.8125rem', color: '#b91c1c', margin: '0 0 0.625rem', fontWeight: 600 }}>
              오류: {resetError}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetPending}
              style={{
                padding: '0.5rem 1.25rem', backgroundColor: '#dc2626', color: '#fff',
                border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: 700,
              }}
            >
              {resetPending ? '삭제 중...' : '삭제 확정'}
            </button>
            <button
              type="button"
              onClick={() => { setShowResetConfirm(false); setResetError('') }}
              disabled={resetPending}
              style={{
                padding: '0.5rem 1rem', backgroundColor: '#fff', color: '#475569',
                border: '1px solid #cbd5e1', borderRadius: '0.5rem', cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </form>
    </>
  )
}

function EditorCell({
  id,
  value,
  placeholder,
  highlighted = false,
  onClick,
}: {
  id?: string
  value: string
  placeholder: string
  highlighted?: boolean
  onClick: () => void
}) {
  const hasContent = !!value && value !== '<p></p>'

  return (
    <td
      id={id}
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
          border: highlighted ? '1px solid #a78bfa' : '1px dashed #e2e8f0',
          background: highlighted ? '#faf5ff' : 'transparent',
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
