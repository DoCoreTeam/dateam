'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Lock, Sparkles, FileDown } from 'lucide-react'
import { saveDeptReport, aggregateDept, exportDeptDocx } from './org-actions'
import RichText from '@/components/ui/RichText'
import { useEscClose } from '@/lib/use-esc-close'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })

export type AggState = 'none' | 'draft' | 'confirmed'
// admin/reports와 동일한 flat 스키마(SSOT: mergeAndRefineByCategory)
export interface FlatRow { category: string; performance: string; plan: string; issues: string }
// 구 스냅샷(authors[] 계층) 호환용 — flat 필드는 optional(구형은 authors만 존재)
interface AuthorBlock { name: string; rank?: string; performance: string; plan: string; issues: string }
export interface AnyRow { category: string; performance?: string; plan?: string; issues?: string; authors?: AuthorBlock[] }

// 구 authors[] 형식 → flat로 정규화(데이터 보존: 작성자명 굵게 prefix). 신형은 그대로.
export function normalizeRows(body: AnyRow[]): FlatRow[] {
  return (body ?? []).map((r) => {
    if (Array.isArray(r.authors) && r.authors.length > 0) {
      const join = (f: 'performance' | 'plan' | 'issues') =>
        r.authors!.map((a) => `<p><strong>${a.name}${a.rank ? ` ${a.rank}` : ''}</strong></p>${a[f] || ''}`).join('')
      return { category: r.category, performance: join('performance'), plan: join('plan'), issues: join('issues') }
    }
    return { category: r.category, performance: r.performance || '', plan: r.plan || '', issues: r.issues || '' }
  })
}

// 취합 상태 뱃지 — 조직현황 카드/취합 패널 공용(SSOT). 화면마다 색맵 복붙 금지.
export function aggBadge(agg: AggState) {
  const m = {
    confirmed: { t: '확정', c: 'var(--success)', b: 'var(--success-bg)', br: 'var(--success-border)' },
    draft: { t: '초안', c: 'var(--text-muted)', b: 'var(--surface-muted)', br: 'var(--color-border)' },
    none: { t: '미취합', c: 'var(--warning)', b: 'var(--warning-bg)', br: 'var(--warning-border)' },
  }[agg]
  return <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: m.c, background: m.b, border: `var(--hairline) solid ${m.br}`, padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)' }}>{m.t}</span>
}

const FIELDS = [
  { key: 'performance' as const, label: '성과' },
  { key: 'plan' as const, label: '계획' },
  { key: 'issues' as const, label: '이슈/협조' },
]

interface DeptReportPanelProps {
  deptId: string
  deptName: string
  weekStart: string
  /** 편집·취합 권한(부서장 또는 어드민). false면 조회 전용 */
  editable: boolean
  agg: AggState
  /** 저장 취합본 raw(구 authors[] 호환) — 패널이 내부에서 normalizeRows로 정규화. 서버컴포넌트가 client 함수를 호출하지 않도록 raw로 받는다. */
  initialBody: AnyRow[]
}

/**
 * 부서 취합 주간보고 패널 — 멤버(조직현황)·어드민(주간보고 취합) 공용 SSOT.
 * 취합본 표시 + AI 취합/재취합(확정본 경고) + 셀 편집 + 임시저장/확정 + Word 내보내기.
 * 서버 액션(aggregateDept·saveDeptReport)이 권한(부서장 또는 admin)을 강제한다.
 */
export default function DeptReportPanel({ deptId, deptName, weekStart, editable, agg, initialBody }: DeptReportPanelProps) {
  const router = useRouter()
  const normalizedInitial = useMemo(() => normalizeRows(initialBody), [initialBody])
  const [rows, setRows] = useState<FlatRow[]>(normalizedInitial)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<AggState>(agg)
  const [confirmReagg, setConfirmReagg] = useState(false)
  const [editingCell, setEditingCell] = useState<{ idx: number; field: 'performance' | 'plan' | 'issues' } | null>(null)
  const [exportingDocx, setExportingDocx] = useState(false)

  useEffect(() => { setRows(normalizedInitial); setDirty(false); setLocalStatus(agg) }, [normalizedInitial, agg])
  useEscClose(() => setConfirmReagg(false), confirmReagg)

  // 확정본 재취합 가드: confirmed 상태면 확인 후 진행(재취합 시 draft로 내려가 재확정 필요 고지).
  function onAggregate() {
    if (localStatus === 'confirmed') { setConfirmReagg(true); return }
    void runAggregate()
  }

  // 취합: 멤버·어드민 동일 경로(aggregateDept → mergeAndRefineByCategory). 재취합 결과는 draft로 저장.
  async function runAggregate() {
    setConfirmReagg(false)
    setBusy(true); setMsg(null)
    try {
      const r = await aggregateDept(deptId, weekStart)
      if (!r.ok) { setMsg(`취합 실패: ${r.error ?? '알 수 없는 오류'}`); return }
      setRows((r.body as FlatRow[]) ?? []); setDirty(false)
      setLocalStatus((r.status as AggState) ?? 'draft')
      setMsg('AI 취합 완료 — 결과는 초안(draft)으로 저장됩니다. 셀별 "수정"으로 다듬고 "확정"하세요')
      router.refresh()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '취합 실패')
    } finally {
      setBusy(false)
    }
  }
  async function save(confirm: boolean) {
    setBusy(true); setMsg(null)
    const r = await saveDeptReport(deptId, weekStart, rows, confirm)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '저장 실패'); return }
    setMsg(confirm ? '확정 저장 완료' : '임시 저장 완료'); setDirty(false)
    setLocalStatus(confirm ? 'confirmed' : 'draft')
    router.refresh()
  }
  // Word(.docx) 내보내기 — 멤버·어드민 동일 SSOT(buildDocx). 화면 취합본 그대로(WYSIWYG) 부서명 주입.
  async function onExportDocx() {
    setExportingDocx(true); setMsg(null)
    try {
      const r = await exportDeptDocx(deptId, weekStart, rows)
      if (!r.ok) { setMsg(r.error); return }
      const bin = atob(r.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = r.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '내보내기 실패')
    } finally {
      setExportingDocx(false)
    }
  }

  const updateCell = (idx: number, field: 'performance' | 'plan' | 'issues', html: string) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: html } : r)); setDirty(true)
    setLocalStatus('draft')
  }

  const activeValue = editingCell ? rows[editingCell.idx]?.[editingCell.field] ?? '' : ''

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)' }}>
      {/* 헤더 — 기존 취합과 동일 톤 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', padding: 'var(--space-4) var(--space-5)', background: 'linear-gradient(to right, var(--surface-bg), var(--brand-soft))', borderBottom: 'var(--hairline) solid var(--brand-soft-2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <Sparkles size={16} color="var(--brand)" />
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>{deptName} 취합 주간보고</span>
          {aggBadge(localStatus)}
          {!editable && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><Lock size={11} /> 조회 전용</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {rows.length > 0 && (
            <button onClick={onExportDocx} disabled={exportingDocx} title="Word(.docx) 내보내기"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: '#fff', color: 'var(--text-muted)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: exportingDocx ? 'wait' : 'pointer', opacity: exportingDocx ? 0.7 : 1 }}>
              <FileDown size={14} /> {exportingDocx ? '내보내는 중…' : 'Word 내보내기'}
            </button>
          )}
          {editable && (
            <button onClick={onAggregate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
              <Sparkles size={14} /> {busy ? 'AI 취합 중…' : agg === 'none' ? 'AI 취합' : '재취합'}
            </button>
          )}
        </div>
      </div>

      {msg && <div role="status" style={{ padding: '0.625rem 1.25rem', background: 'var(--brand-soft)', borderBottom: 'var(--hairline) solid var(--brand-soft-2)', fontSize: 'var(--fs-sm)', color: 'var(--brand-dark)' }}>{msg}</div>}

      {busy ? (
        <div style={{ padding: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--brand)' }}>
          <Sparkles size={15} /> AI가 부서원 보고를 카테고리별로 취합·정제 중…
        </div>
      ) : rows.length === 0 ? (
        <p style={{ padding: 'var(--space-5)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)', margin: 0 }}>
          {editable ? '아직 취합본이 없습니다. 상단 "AI 취합"으로 부서원 보고를 모으세요.' : '아직 확정된 취합본이 없습니다.'}
        </p>
      ) : (
        <div>
          {rows.map((row, idx) => (
            <div key={`${row.category}-${idx}`} style={{ borderBottom: 'var(--hairline) solid var(--surface-muted)' }}>
              {/* 카테고리 섹션 헤더 */}
              <div style={{ padding: '0.625rem 1.25rem', background: 'var(--color-bg)', fontWeight: 700, fontSize: 'var(--fs-sm)', color: 'var(--brand-dark)' }}>{row.category}</div>
              {/* 성과/계획/이슈 (카테고리별 통합·정제 — admin/reports와 동일 flat 구조) */}
              <div style={{ padding: 'var(--space-3) var(--space-5)' }}>
                <div className="responsive-grid-cols-3" style={{ display: 'grid', gap: 'var(--space-3)' }}>
                  {FIELDS.map((f) => (
                    <div key={f.key}>
                      <div style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-faint)', marginBottom: '0.2rem' }}>{f.label}</div>
                      <RichText html={row[f.key]} />
                      {editable && (
                        <button onClick={() => setEditingCell({ idx, field: f.key })} style={{ marginTop: '0.3rem', padding: '0.1rem 0.35rem', fontSize: '0.68rem', color: 'var(--text-faint)', background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', cursor: 'pointer' }}>수정</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editable && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0.875rem 1.25rem', borderTop: 'var(--hairline) solid var(--surface-muted)' }}>
          {localStatus === 'confirmed' && !dirty ? (
            <button disabled style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-4)', cursor: 'default' }}>✓ 확정됨</button>
          ) : (
            <button onClick={() => save(true)} disabled={busy} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: '#fff', background: 'var(--success)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-4)', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>{dirty && localStatus === 'confirmed' ? '재확정' : '확정'}</button>
          )}
          <button onClick={() => save(false)} disabled={busy} style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text-muted)', background: 'var(--surface-muted)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-4)', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>임시저장</button>
          {dirty && <span style={{ alignSelf: 'center', fontSize: 'var(--fs-xs)', color: 'var(--warning)' }}>저장되지 않은 변경</span>}
        </div>
      )}

      {editingCell && (
        <EditorModal
          title={`${FIELDS.find((f) => f.key === editingCell.field)?.label} 수정`}
          value={activeValue}
          onChange={(html: string) => updateCell(editingCell.idx, editingCell.field, html)}
          onClose={() => setEditingCell(null)}
        />
      )}

      {/* 확정본 재취합 가드 — confirmed 상태에서 재취합 시 draft 강등·재확정 필요 고지 */}
      {confirmReagg && (
        <div onClick={() => setConfirmReagg(false)} className="modal-backdrop">
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="확정본 재취합"
            className="modal-card"
            style={{ padding: 'var(--space-6)', maxWidth: 420, width: '100%' }}
          >
            <div className="tape-title" style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>확정본 재취합</div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 var(--space-5)' }}>
              이 주간보고는 <strong style={{ color: 'var(--success)' }}>확정</strong> 상태입니다. 재취합하면 부서원 보고를 다시 병합해 <strong>초안(draft)</strong>으로 덮어쓰며, 다시 확정해야 합니다. 계속할까요?
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmReagg(false)} style={{ padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', border: 'var(--border-w) solid var(--border-color)', background: 'var(--surface-bg)', color: 'var(--text)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' }}>취소</button>
              <button onClick={() => void runAggregate()} style={{ padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' }}>재취합</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
