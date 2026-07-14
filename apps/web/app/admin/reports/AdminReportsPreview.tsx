'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles, RefreshCw } from 'lucide-react'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })
import AXDotLoader from '@/components/ui/AXDotLoader'
import RichText from '@/components/ui/RichText'
import AXLoadingOverlay from '@/components/ui/AXLoadingOverlay'

interface AdminReportsPreviewProps {
  week: string
  member: string
  members?: string // 부서 필터 시 소속 멤버 user_id csv
  deptName?: string // 부서 필터 시 부서명 (조직 칸 표시용)
  orgName?: string
}

type PreviewRow = {
  userName: string; orgName: string; category: string
  performance: string; plan: string; issues: string; weekStart: string
}

// 구버전 캐시(사람별 분류) 무효화를 위해 버전 올림

type EditingCell = { rowIdx: number; field: 'performance' | 'plan' | 'issues' } | null

const EDITABLE_FIELDS = ['performance', 'plan', 'issues'] as const
type EditableField = typeof EDITABLE_FIELDS[number]

const FIELD_LABELS: Record<EditableField, string> = {
  performance: '성과',
  plan: '계획',
  issues: '이슈/협조사항',
}

const TH_COLS = [
  { label: '조직', width: 130 },
  { label: '구분', width: 80 },
  { label: '성과' },
  { label: '계획' },
  { label: '이슈/협조사항' },
]

function RichCell({ html }: { html: string }) {
  return <RichText html={html} style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6 }} />
}

const STEPS = [
  { label: '보고서 데이터 조회 중…', detail: 'DB에서 주간보고 불러오는 중' },
  { label: 'AI 취합 중…',           detail: '오타·중복·포맷을 AI가 교정하는 중' },
  { label: '결과 정리 중…',         detail: '정제된 데이터를 테이블로 변환하는 중' },
]

export default function AdminReportsPreview({ week, member, members = '', deptName = '', orgName = '' }: AdminReportsPreviewProps) {
  const displayOrg = deptName || orgName // 부서 필터 시 부서명, 아니면 회사명
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [saved, setSaved] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [editingCell, setEditingCell] = useState<EditingCell>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusStep, setStatusStep] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const reqIdRef = useRef(0)
  const downloadingRef = useRef(false)
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([])
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // 마운트/필터 변경 시 DB 저장본에서 복원 (Gemini 미호출)
  useEffect(() => {
    const myId = ++reqIdRef.current
    const params = new URLSearchParams({ week })
    if (member) params.set('member', member)
    if (members) params.set('members', members)
    setRows([])
    setSaved(false)
    setSavedAt(null)
    setRestoring(true)
    fetch(`/api/reports/preview?${params.toString()}`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: { reports: PreviewRow[]; saved: boolean; updatedAt: string | null } | null) => {
        if (myId !== reqIdRef.current) return
        const rowsOut = displayOrg && data?.reports ? data.reports.map(r => ({ ...r, orgName: displayOrg })) : (data?.reports ?? [])
        setRows(rowsOut)
        setSaved(!!data?.saved && rowsOut.length > 0)
        setSavedAt(data?.updatedAt ?? null)
      })
      .catch(() => { /* 조회 실패 시 빈 상태 유지 */ })
      .finally(() => { if (myId === reqIdRef.current) setRestoring(false) })
  }, [week, member, members, displayOrg])

  function clearTimers() {
    timerRefs.current.forEach(clearTimeout)
    timerRefs.current = []
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
  }

  useEffect(() => () => clearTimers(), [])

  useEffect(() => {
    if (loading) {
      prevFocusRef.current = document.activeElement as HTMLElement
      overlayRef.current?.focus()
    } else {
      prevFocusRef.current?.focus()
      prevFocusRef.current = null
    }
  }, [loading])

  async function handlePreview() {
    clearTimers()
    setLoading(true)
    setError(null)
    setSaved(false)
    setStatusStep(0)
    setElapsed(0)
    const myId = ++reqIdRef.current

    const startedAt = Date.now()
    elapsedRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500)
    timerRefs.current.push(setTimeout(() => setStatusStep(1), 1800))
    timerRefs.current.push(setTimeout(() => setStatusStep(2), 6000))

    try {
      const params = new URLSearchParams({ week })
      if (member) params.set('member', member)
      if (members) params.set('members', members)
      const res = await fetch(`/api/reports/preview?${params.toString()}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? '미리보기 불러오기 실패')
      }
      const data = await res.json() as { reports: PreviewRow[]; updatedAt?: string | null }
      if (myId !== reqIdRef.current) return
      const rowsOut = displayOrg ? data.reports.map(r => ({ ...r, orgName: displayOrg })) : data.reports
      setRows(rowsOut)
      setSaved(true)
      setSavedAt(data.updatedAt ?? new Date().toISOString())
    } catch (err) {
      if (myId === reqIdRef.current) {
        setError(err instanceof Error ? err.message : '알 수 없는 오류')
      }
    } finally {
      if (myId === reqIdRef.current) {
        clearTimers()
        setLoading(false)
      }
    }
  }

  async function handleDownload() {
    if (downloadingRef.current) return
    downloadingRef.current = true
    setDownloading(true)
    try {
      const res = await fetch('/api/reports/export-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (!res.ok) { setError('DOCX 생성 실패'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      a.download = match?.[1] ?? 'Weekly_Report.docx'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      downloadingRef.current = false
      setDownloading(false)
    }
  }

  // 편집은 로컬 상태만 갱신(키스트로크마다 PUT 금지). DB 영속은 모달 닫힐 때 1회.
  function updateCell(rowIdx: number, field: EditableField, value: string) {
    setRows(prev => prev.map((row, i) => (i === rowIdx ? { ...row, [field]: value } : row)))
  }

  // 편집 종료 시 현재 취합본을 DB에 저장(fire-and-forget). 실패해도 다음 편집/취합 시 재저장됨.
  function persistEdits(next: PreviewRow[]) {
    fetch('/api/reports/preview', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week, member, members, reports: next }),
    }).then(res => { if (res.ok) { setSaved(true); setSavedAt(new Date().toISOString()) } }).catch(() => { /* 저장 실패 무시 */ })
  }

  const activeCell = editingCell !== null ? rows[editingCell.rowIdx] : null
  const activeValue = activeCell && editingCell ? activeCell[editingCell.field] : ''

  return (
    <>
      <AXLoadingOverlay
        ref={overlayRef}
        isLoading={loading}
        brandName={orgName || undefined}
        label={STEPS[Math.min(statusStep, STEPS.length - 1)].label}
        elapsed={elapsed}
        ariaLabel={`AI 취합 중 — ${STEPS[Math.min(statusStep, STEPS.length - 1)].label}`}
      />

      {/* Trigger button + inline status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <button
          onClick={handlePreview}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-4)',
            background: loading ? 'var(--brand-dark)' : 'linear-gradient(135deg, var(--brand), var(--brand))',
            color: '#fff', border: 'none', borderRadius: 'var(--radius)',
            fontSize: 'var(--fs-base)', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.85 : 1, transition: 'opacity 200ms',
            boxShadow: '0 2px 8px rgba(124,58,237,0.35)',
            flexShrink: 0,
          }}
        >
          {loading ? <AXDotLoader size={5} color="#fff" /> : <Sparkles size={15} />}
          AI 주간보고 취합
        </button>

        {/* Inline loading status — aria-hidden: overlay가 동일 정보를 발화함 */}
        {loading && (
          <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexShrink: 0 }}>
              {STEPS.map((_, i) => {
                const done = i < statusStep
                const active = i === statusStep
                return (
                  <span key={i} style={{ width: done ? 8 : active ? 10 : 6, height: done ? 8 : active ? 10 : 6, borderRadius: '50%', background: done ? 'var(--brand)' : active ? 'var(--brand-soft-2)' : 'var(--brand-soft-2)', transition: 'all 300ms', flexShrink: 0 }} />
                )
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand)', whiteSpace: 'nowrap' }}>{STEPS[Math.min(statusStep, STEPS.length - 1)].label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div role="progressbar" aria-busy="true" aria-label="AI 취합 진행 중" style={{ width: 80, height: 3, borderRadius: 3, background: 'var(--brand-soft-2)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '40%', borderRadius: 3, background: 'var(--brand)', animation: 'progress-indeterminate 1.4s ease-in-out infinite' }} />
                </div>
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--brand-soft-2)', whiteSpace: 'nowrap' }}>{elapsed}초</span>
              </div>
            </div>
          </div>
        )}

        {restoring && !loading && rows.length === 0 && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>저장본 불러오는 중…</span>
        )}

        {error && <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{error}</p>}
      </div>

      {/* Preview panel */}
      {rows.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem', overflow: 'hidden', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)', background: 'linear-gradient(to right, var(--surface-bg), var(--brand-soft))', borderBottom: 'var(--hairline) solid var(--brand-soft-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
              <Sparkles size={16} color="var(--brand)" />
              <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>AI 주간보고 취합</span>
              <span style={{ padding: '0.125rem 0.5rem', background: 'var(--brand-soft-2)', color: 'var(--brand)', borderRadius: '9999px', fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '0.04em' }}>
                Gemini AI
              </span>
              {saved && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.125rem 0.5rem', background: 'var(--success-bg)', color: 'var(--success)', borderRadius: '9999px', fontSize: 'var(--fs-2xs)', fontWeight: 600 }}>
                  <RefreshCw size={10} />
                  저장됨{savedAt ? ` · ${new Date(savedAt).toLocaleString('ko-KR')}` : ''} — 원본 반영은 다시 취합
                </span>
              )}
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.7 : 1, transition: 'opacity 150ms', flexShrink: 0 }}
            >
              {downloading ? '다운로드 중…' : 'DOCX 다운로드'}
            </button>
          </div>

          {/* Table */}
          <div className="table-responsive">
            <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  {TH_COLS.map(({ label, width }) => (
                    <th key={label} style={{ padding: '0.625rem 0.875rem', textAlign: 'left', fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.03em', borderBottom: 'var(--border-w-2) solid var(--border-color)', width, whiteSpace: 'nowrap' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // 동일 orgName 연속 행 → rowSpan 계산
                  const spanMap = new Map<number, number>()
                  let i = 0
                  while (i < rows.length) {
                    let j = i + 1
                    while (j < rows.length && rows[j].orgName === rows[i].orgName) j++
                    spanMap.set(i, j - i)
                    i = j
                  }
                  return rows.map((row, rowIdx) => (
                    <tr key={rowIdx} style={{ borderBottom: 'var(--hairline) solid var(--surface-muted)', verticalAlign: 'top' }}>
                      <td className="mobile-only card-header">
                        <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{row.orgName} {row.userName ? `(${row.userName})` : ''}</span>
                      </td>
                      {spanMap.has(rowIdx) && (
                        <td
                          rowSpan={spanMap.get(rowIdx)}
                          className="card-hide"
                          style={{ padding: '0.75rem 0.875rem', whiteSpace: 'nowrap', verticalAlign: 'middle', borderRight: 'var(--hairline) solid var(--surface-muted)' }}
                        >
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', fontWeight: 600 }}>{row.orgName}</div>
                          {row.userName && (
                            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: 500, marginTop: '0.125rem' }}>{row.userName}</div>
                          )}
                        </td>
                      )}
                      <td data-label="구분" style={{ padding: '0.75rem 0.875rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{row.category}</td>
                      {EDITABLE_FIELDS.map(field => (
                        <td key={field} data-label={FIELD_LABELS[field]} style={{ padding: '0.75rem 0.875rem', verticalAlign: 'top' }}>
                          <RichCell html={row[field]} />
                          <button
                            onClick={() => setEditingCell({ rowIdx, field })}
                            style={{ marginTop: '0.375rem', padding: '0.125rem 0.375rem', fontSize: '0.7rem', color: 'var(--text-faint)', background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer', lineHeight: 1.4 }}
                          >
                            수정
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Editor Modal */}
      {editingCell !== null && (
        <EditorModal
          title={`${FIELD_LABELS[editingCell.field]} 수정`}
          value={activeValue}
          placeholder="내용을 입력하세요"
          onChange={html => updateCell(editingCell.rowIdx, editingCell.field, html)}
          onClose={() => { setEditingCell(null); persistEdits(rows) }}
        />
      )}
    </>
  )
}
