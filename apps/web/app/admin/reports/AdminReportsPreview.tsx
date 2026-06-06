'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles, RefreshCw } from 'lucide-react'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })
import AXDotLoader from '@/components/ui/AXDotLoader'
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

const ALLOWED_TAGS = /^(p|ul|ol|li|strong|em|br|span|b|i)$/i
function sanitizeHtml(html: string): string {
  return html.replace(/<([a-z][a-z0-9]*)[^>]*>/gi, (match, tag: string) =>
    ALLOWED_TAGS.test(tag) ? `<${tag.toLowerCase()}>` : ''
  ).replace(/<\/([a-z][a-z0-9]*)[^>]*>/gi, (match, tag: string) =>
    ALLOWED_TAGS.test(tag) ? `</${tag.toLowerCase()}>` : ''
  )
}

const CACHE_V = 5
const CACHE_TTL = 24 * 60 * 60 * 1000

interface CacheEntry { v: number; savedAt: number; rows: PreviewRow[] }

function cacheKey(week: string, member: string) {
  return `ai-preview::${week}::${member || 'all'}`
}

function readCache(week: string, member: string): PreviewRow[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(week, member))
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry
    if (entry.v !== CACHE_V || Date.now() - entry.savedAt > CACHE_TTL) return null
    const rows = entry.rows
    if (!Array.isArray(rows) || rows.length === 0) return null
    const f = rows[0]
    if (typeof f !== 'object' || f === null || !('category' in f) || !('performance' in f)) return null
    return rows
  } catch { return null }
}

function writeCache(week: string, member: string, rows: PreviewRow[]) {
  try {
    const entry: CacheEntry = { v: CACHE_V, savedAt: Date.now(), rows }
    sessionStorage.setItem(cacheKey(week, member), JSON.stringify(entry))
  } catch { /* quota 초과 등 무시 */ }
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
  { label: 'AI 취합 중…',           detail: '오타·중복·포맷을 AI가 교정하는 중' },
  { label: '결과 정리 중…',         detail: '정제된 데이터를 테이블로 변환하는 중' },
]

export default function AdminReportsPreview({ week, member, members = '', deptName = '', orgName = '' }: AdminReportsPreviewProps) {
  const tag = member || (members ? `d:${members}` : '') // 캐시/필터 구분 태그
  const displayOrg = deptName || orgName // 부서 필터 시 부서명, 아니면 회사명
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [fromCache, setFromCache] = useState(false)
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

  // 마운트/필터 변경 시 sessionStorage에서 복원
  useEffect(() => {
    const cached = readCache(week, tag)
    if (cached) {
      const normalized = displayOrg ? cached.map(r => ({ ...r, orgName: displayOrg })) : cached
      if (displayOrg) writeCache(week, tag, normalized)
      setRows(normalized)
      setFromCache(true)
    } else {
      setRows([])
      setFromCache(false)
    }
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
    setFromCache(false)
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
      const res = await fetch(`/api/reports/preview?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? '미리보기 불러오기 실패')
      }
      const data = await res.json() as { reports: PreviewRow[] }
      if (myId !== reqIdRef.current) return
      const rowsOut = displayOrg ? data.reports.map(r => ({ ...r, orgName: displayOrg })) : data.reports
      setRows(rowsOut)
      writeCache(week, tag, rowsOut)
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
    setRows(prev => {
      const next = prev.map((row, i) => (i === rowIdx ? { ...row, [field]: value } : row))
      writeCache(week, tag, next)
      return next
    })
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={handlePreview}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem',
            background: loading ? '#6d6abe' : 'linear-gradient(135deg, var(--brand), var(--brand))',
            color: '#fff', border: 'none', borderRadius: '0.5rem',
            fontSize: '0.875rem', fontWeight: 600,
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
          <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexShrink: 0 }}>
              {STEPS.map((_, i) => {
                const done = i < statusStep
                const active = i === statusStep
                return (
                  <span key={i} style={{ width: done ? 8 : active ? 10 : 6, height: done ? 8 : active ? 10 : 6, borderRadius: '50%', background: done ? '#7c3aed' : active ? '#a78bfa' : '#ddd6fe', transition: 'all 300ms', flexShrink: 0 }} />
                )
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#6d28d9', whiteSpace: 'nowrap' }}>{STEPS[Math.min(statusStep, STEPS.length - 1)].label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div role="progressbar" aria-busy="true" aria-label="AI 취합 진행 중" style={{ width: 80, height: 3, borderRadius: 3, background: '#ede9fe', overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '40%', borderRadius: 3, background: 'var(--brand)', animation: 'progress-indeterminate 1.4s ease-in-out infinite' }} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
              <Sparkles size={16} color="#7c3aed" />
              <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1e1b4b' }}>AI 주간보고 취합</span>
              <span style={{ padding: '0.125rem 0.5rem', background: '#ede9fe', color: '#6d28d9', borderRadius: '9999px', fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                Gemini AI
              </span>
              {fromCache && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.125rem 0.5rem', background: '#fef9c3', color: '#92400e', borderRadius: '9999px', fontSize: '0.6875rem', fontWeight: 600 }}>
                  <RefreshCw size={10} />
                  세션 캐시 — 최신 데이터로 다시 생성하려면 버튼을 누르세요
                </span>
              )}
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.7 : 1, transition: 'opacity 150ms', flexShrink: 0 }}
            >
              {downloading ? '다운로드 중…' : 'DOCX 다운로드'}
            </button>
          </div>

          {/* Table */}
          <div className="table-responsive">
            <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                    <tr key={rowIdx} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                      <td className="mobile-only card-header">
                        <span style={{ fontWeight: 600, color: 'var(--brand)' }}>{row.orgName} {row.userName ? `(${row.userName})` : ''}</span>
                      </td>
                      {spanMap.has(rowIdx) && (
                        <td
                          rowSpan={spanMap.get(rowIdx)}
                          className="card-hide"
                          style={{ padding: '0.75rem 0.875rem', whiteSpace: 'nowrap', verticalAlign: 'middle', borderRight: '1px solid #f1f5f9' }}
                        >
                          <div style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 600 }}>{row.orgName}</div>
                          {row.userName && (
                            <div style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500, marginTop: '0.125rem' }}>{row.userName}</div>
                          )}
                        </td>
                      )}
                      <td data-label="구분" style={{ padding: '0.75rem 0.875rem', fontSize: '0.8125rem', color: '#6b7280', whiteSpace: 'nowrap' }}>{row.category}</td>
                      {EDITABLE_FIELDS.map(field => (
                        <td key={field} data-label={FIELD_LABELS[field]} style={{ padding: '0.75rem 0.875rem', verticalAlign: 'top' }}>
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
          onClose={() => setEditingCell(null)}
        />
      )}
    </>
  )
}
