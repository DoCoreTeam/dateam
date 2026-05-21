'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles } from 'lucide-react'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })

interface AdminReportsPreviewProps {
  week: string
  member: string
  orgName?: string
}

type PreviewRow = {
  userName: string; orgName: string; category: string
  performance: string; plan: string; issues: string; weekStart: string
}

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

const ALLOWED_TAGS = /^(p|ul|ol|li|strong|em|br|span|b|i)$/i
function sanitizeHtml(html: string): string {
  return html.replace(/<([a-z][a-z0-9]*)[^>]*>/gi, (match, tag: string) =>
    ALLOWED_TAGS.test(tag) ? `<${tag.toLowerCase()}>` : ''
  ).replace(/<\/([a-z][a-z0-9]*)[^>]*>/gi, (match, tag: string) =>
    ALLOWED_TAGS.test(tag) ? `</${tag.toLowerCase()}>` : ''
  )
}

function RichCell({ html }: { html: string }) {
  if (!html) return <span style={{ color: '#cbd5e1' }}>-</span>
  if (html.startsWith('<'))
    return <div className="report-rich" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
  return (
    <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151', lineHeight: 1.6 }}>
      {html}
    </p>
  )
}

const STEPS = [
  { label: '보고서 데이터 조회 중…', detail: 'DB에서 주간보고 불러오는 중' },
  { label: 'Gemini AI 정제 중…',    detail: '오타·중복·포맷을 AI가 교정하는 중' },
  { label: '결과 정리 중…',         detail: '정제된 데이터를 테이블로 변환하는 중' },
]

export default function AdminReportsPreview({ week, member, orgName = '' }: AdminReportsPreviewProps) {
  const [rows, setRows] = useState<PreviewRow[]>([])
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

  function clearTimers() {
    timerRefs.current.forEach(clearTimeout)
    timerRefs.current = []
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
  }

  useEffect(() => () => clearTimers(), [])

  async function handlePreview() {
    clearTimers()
    setLoading(true)
    setError(null)
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
      const res = await fetch(`/api/reports/preview?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? '미리보기 불러오기 실패')
      }
      const data = await res.json() as { reports: PreviewRow[] }
      if (myId !== reqIdRef.current) return
      setRows(data.reports)
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

  function updateCell(rowIdx: number, field: EditableField, value: string) {
    setRows(prev => prev.map((row, i) => (i === rowIdx ? { ...row, [field]: value } : row)))
  }

  const activeCell = editingCell !== null ? rows[editingCell.rowIdx] : null
  const activeValue = activeCell && editingCell ? activeCell[editingCell.field] : ''

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes progress-indeterminate {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>

      {/* Trigger button + inline status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={handlePreview}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem',
            background: loading ? '#6d6abe' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff', border: 'none', borderRadius: '0.5rem',
            fontSize: '0.875rem', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.85 : 1, transition: 'opacity 200ms',
            boxShadow: '0 2px 8px rgba(99,102,241,0.35)',
            flexShrink: 0,
          }}
        >
          {loading
            ? <span style={{ display: 'inline-block', width: '0.875rem', height: '0.875rem', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            : <Sparkles size={15} />}
          AI 정제 미리보기
        </button>

        {/* Inline status — 버튼 옆에 붙어 레이아웃 영향 없음 */}
        {loading && (
          <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            {/* Step dots */}
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexShrink: 0 }}>
              {STEPS.map((_, i) => {
                const done = i < statusStep
                const active = i === statusStep
                return (
                  <span
                    key={i}
                    style={{
                      width: done ? 8 : active ? 10 : 6,
                      height: done ? 8 : active ? 10 : 6,
                      borderRadius: '50%',
                      background: done ? '#7c3aed' : active ? '#a78bfa' : '#ddd6fe',
                      transition: 'all 300ms',
                      flexShrink: 0,
                    }}
                  />
                )
              })}
            </div>

            {/* Current step label */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#6d28d9', whiteSpace: 'nowrap' }}>
                {STEPS[statusStep].label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {/* Thin progress bar */}
                <div role="progressbar" aria-label="AI 정제 진행 중" style={{ width: 80, height: 3, borderRadius: 3, background: '#ede9fe', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '40%', borderRadius: 3, background: '#8b5cf6', animation: 'progress-indeterminate 1.4s ease-in-out infinite' }} />
                </div>
                <span style={{ fontSize: '0.6875rem', color: '#a78bfa', whiteSpace: 'nowrap' }}>{elapsed}초</span>
              </div>
            </div>
          </div>
        )}

        {error && <p style={{ margin: 0, fontSize: '0.8125rem', color: '#ef4444' }}>{error}</p>}
      </div>

      {/* Preview panel */}
      {rows.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem', overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '0.75rem' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', background: 'linear-gradient(to right, #f8f7ff, #fdf4ff)', borderBottom: '1px solid #e9d5ff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <Sparkles size={16} color="#7c3aed" />
              <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1e1b4b' }}>AI 정제 미리보기</span>
              <span style={{ padding: '0.125rem 0.5rem', background: '#ede9fe', color: '#6d28d9', borderRadius: '9999px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                Gemini AI
              </span>
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.7 : 1, transition: 'opacity 150ms' }}
            >
              {downloading ? '다운로드 중…' : 'DOCX 다운로드'}
            </button>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table className="table-base" style={{ minWidth: 900, width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {TH_COLS.map(({ label, width }) => (
                    <th key={label} style={{ padding: '0.625rem 0.875rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.03em', borderBottom: '1px solid #e2e8f0', width, whiteSpace: 'nowrap' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr key={rowIdx} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                    <td style={{ padding: '0.75rem 0.875rem', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: '0.75rem', color: '#6366f1', fontWeight: 600 }}>{row.orgName}</div>
                      <div style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500, marginTop: '0.125rem' }}>{row.userName}</div>
                    </td>
                    <td style={{ padding: '0.75rem 0.875rem', fontSize: '0.8125rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{row.category}</td>
                    {EDITABLE_FIELDS.map(field => (
                      <td key={field} style={{ padding: '0.75rem 0.875rem', verticalAlign: 'top' }}>
                        <RichCell html={row[field]} />
                        <button
                          onClick={() => setEditingCell({ rowIdx, field })}
                          style={{ marginTop: '0.375rem', padding: '0.125rem 0.375rem', fontSize: '0.7rem', color: '#9ca3af', background: 'none', border: '1px solid #e5e7eb', borderRadius: '0.25rem', cursor: 'pointer', lineHeight: 1.4 }}
                        >
                          수정
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
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
          onClose={() => setEditingCell(null)}
        />
      )}
    </>
  )
}
