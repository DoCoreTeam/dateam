'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, Lock, Pencil, Users, Sparkles } from 'lucide-react'
import { saveDeptReport, aggregateDept } from './org-actions'
import RichText from '@/components/ui/RichText'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })

interface SlimNode { id: string; type: string; parent_id: string | null; name: string }
interface DeptStat { memberCount: number; reportedCount: number; agg: 'none' | 'draft' | 'confirmed' }
// admin/reports와 동일한 flat 스키마(SSOT: mergeAndRefineByCategory)
interface FlatRow { category: string; performance: string; plan: string; issues: string }
// 구 스냅샷(authors[] 계층) 호환용 — flat 필드는 optional(구형은 authors만 존재)
interface AuthorBlock { name: string; rank?: string; performance: string; plan: string; issues: string }
interface AnyRow { category: string; performance?: string; plan?: string; issues?: string; authors?: AuthorBlock[] }

// 구 authors[] 형식 → flat로 정규화(데이터 보존: 작성자명 굵게 prefix). 신형은 그대로.
function normalizeRows(body: AnyRow[]): FlatRow[] {
  return (body ?? []).map((r) => {
    if (Array.isArray(r.authors) && r.authors.length > 0) {
      const join = (f: 'performance' | 'plan' | 'issues') =>
        r.authors!.map((a) => `<p><strong>${a.name}${a.rank ? ` ${a.rank}` : ''}</strong></p>${a[f] || ''}`).join('')
      return { category: r.category, performance: join('performance'), plan: join('plan'), issues: join('issues') }
    }
    return { category: r.category, performance: r.performance || '', plan: r.plan || '', issues: r.issues || '' }
  })
}


const FIELDS = [
  { key: 'performance' as const, label: '성과' },
  { key: 'plan' as const, label: '계획' },
  { key: 'issues' as const, label: '이슈/협조' },
]

/** 월요일 기준 주차를 deltaWeeks 만큼 이동 (UTC 안전) */
function shiftWeek(monday: string, deltaWeeks: number): string {
  const d = new Date(monday + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7)
  return d.toISOString().slice(0, 10)
}

interface Props {
  weekStart: string
  thisWeek: string
  nodes: SlimNode[]
  editableDeptIds: string[]
  readableDeptIds: string[]
  isExecutive: boolean
  scopeRootIds: string[]
  deptStats: Record<string, DeptStat>
  deptBodies: Record<string, AnyRow[]>
}

export default function OrgWeeklyView(props: Props) {
  const { weekStart, thisWeek, nodes, editableDeptIds, deptStats, deptBodies } = props
  const prevWeek = shiftWeek(weekStart, -1)
  const nextWeek = shiftWeek(weekStart, 1)
  const atCurrent = weekStart >= thisWeek
  const [stack, setStack] = useState<string[]>(() => props.scopeRootIds.slice(0, 1))

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const nearestChildDepts = useMemo(() => (rootId: string): SlimNode[] => {
    const out: SlimNode[] = []
    const walk = (id: string) => {
      for (const c of nodes.filter((n) => n.parent_id === id)) {
        if (c.type === 'department') out.push(c)
        else if (c.type === 'role' || c.type === 'company') walk(c.id)
      }
    }
    walk(rootId)
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [nodes])

  const currentId = stack[stack.length - 1]
  const currentNode = currentId ? nodeById.get(currentId) : undefined
  const childDepts = currentId ? nearestChildDepts(currentId) : []
  const isLeafDept = currentNode?.type === 'department' && childDepts.length === 0

  const drillInto = (id: string) => setStack((s) => [...s, id])
  const jumpTo = (idx: number) => setStack((s) => s.slice(0, idx + 1))

  const aggBadge = (agg: DeptStat['agg']) => {
    const m = {
      confirmed: { t: '확정', c: 'var(--success)', b: 'var(--success-bg)', br: 'var(--success-border)' },
      draft: { t: '초안', c: 'var(--text-muted)', b: 'var(--surface-muted)', br: 'var(--color-border)' },
      none: { t: '미취합', c: 'var(--warning)', b: 'var(--warning-bg)', br: 'var(--warning-border)' },
    }[agg]
    return <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: m.c, background: m.b, border: `var(--hairline) solid ${m.br}`, padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)' }}>{m.t}</span>
  }

  return (
    <div style={{ width: '100%' }}>
      {/* 주차 네비 — 이전/다음 화살표 (무한 과거 이동, 미래는 이번 주까지) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1rem' }}>
        <Link href={`/weekly-report?tab=org&orgWeek=${prevWeek}`} prefetch={false} aria-label="이전 주"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', textDecoration: 'none' }}>
          <ChevronLeft size={16} />
        </Link>
        <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text)', minWidth: 96, textAlign: 'center' }}>{weekStart} 주</span>
        {atCurrent ? (
          <span aria-label="다음 주" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 'var(--radius)', border: 'var(--hairline) solid var(--surface-muted)', background: 'var(--color-bg)', color: 'var(--border-subtle)' }}>
            <ChevronRight size={16} />
          </span>
        ) : (
          <Link href={`/weekly-report?tab=org&orgWeek=${nextWeek}`} prefetch={false} aria-label="다음 주"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', textDecoration: 'none' }}>
            <ChevronRight size={16} />
          </Link>
        )}
        {!atCurrent && (
          <Link href="/weekly-report?tab=org" prefetch={false}
            style={{ fontSize: 'var(--fs-xs)', padding: '0.25rem 0.6rem', borderRadius: 'var(--radius)', textDecoration: 'none', color: 'var(--brand)', background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)' }}>
            이번 주
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap', marginBottom: '1rem', fontSize: 'var(--fs-sm)' }}>
        {stack.map((id, idx) => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            {idx > 0 && <ChevronRight size={13} color="var(--border-subtle)" />}
            <button onClick={() => jumpTo(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: idx === stack.length - 1 ? 'var(--text)' : 'var(--brand)', fontWeight: idx === stack.length - 1 ? 700 : 500, padding: 0 }}>
              {nodeById.get(id)?.name ?? '조직'}
            </button>
          </span>
        ))}
      </div>

      {isLeafDept && currentNode ? (
        <DeptReport
          key={`${currentNode.id}-${weekStart}`}
          deptId={currentNode.id}
          deptName={currentNode.name}
          weekStart={weekStart}
          editable={editableDeptIds.includes(currentNode.id)}
          agg={(deptStats[currentNode.id]?.agg) ?? 'none'}
          initialBody={normalizeRows(deptBodies[currentNode.id] ?? [])}
          aggBadge={aggBadge}
        />
      ) : (
        <div className="responsive-grid-cols-3" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {childDepts.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-base)' }}>하위 부서가 없습니다.</p>}
          {childDepts.map((d) => {
            const st = deptStats[d.id] ?? { memberCount: 0, reportedCount: 0, agg: 'none' as const }
            const canEdit = editableDeptIds.includes(d.id)
            return (
              <button key={d.id} onClick={() => drillInto(d.id)} style={{ textAlign: 'left', background: '#fff', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-4)', cursor: 'pointer', minHeight: 44 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{d.name}</span>
                  {canEdit ? <Pencil size={13} color="var(--brand)" /> : <Lock size={12} color="var(--text-faint)" />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.5rem' }}>
                  {aggBadge(st.agg)}
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Users size={12} /> 제출 {st.reportedCount}/{st.memberCount}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>열기 <ChevronRight size={12} /></div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface DeptReportProps {
  deptId: string
  deptName: string
  weekStart: string
  editable: boolean
  agg: DeptStat['agg']
  initialBody: FlatRow[]
  aggBadge: (a: DeptStat['agg']) => React.ReactNode
}

function DeptReport({ deptId, deptName, weekStart, editable, agg, initialBody, aggBadge }: DeptReportProps) {
  const router = useRouter()
  const [rows, setRows] = useState<FlatRow[]>(initialBody)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<DeptStat['agg']>(agg)
  const [confirmReagg, setConfirmReagg] = useState(false)
  const [editingCell, setEditingCell] = useState<{ idx: number; field: 'performance' | 'plan' | 'issues' } | null>(null)

  useEffect(() => { setRows(initialBody); setDirty(false); setLocalStatus(agg) }, [initialBody, agg])

  // 확정본 재취합 가드: confirmed 상태면 확인 후 진행(AI 병합으로 편집이 바뀔 수 있음 고지).
  function onAggregate() {
    if (localStatus === 'confirmed') { setConfirmReagg(true); return }
    void runAggregate()
  }

  // 취합: admin/reports와 동일 경로(aggregateDept → mergeAndRefineByCategory). 서버가 기존 편집·status 보존 병합.
  async function runAggregate() {
    setConfirmReagg(false)
    setBusy(true); setMsg(null)
    try {
      const r = await aggregateDept(deptId, weekStart)
      if (!r.ok) { setMsg(`취합 실패: ${r.error ?? '알 수 없는 오류'}`); return }
      setRows((r.body as FlatRow[]) ?? []); setDirty(false)
      // 서버가 보존한 status를 그대로 반영(확정본은 confirmed 유지)
      setLocalStatus((r.status as DeptStat['agg']) ?? 'draft')
      setMsg('AI 취합 완료 — 기존 편집·확정은 보존되며 새 내용이 병합됩니다. 셀별 "수정"으로 다듬으세요')
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
        {editable && (
          <button onClick={onAggregate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1, flexShrink: 0 }}>
            <Sparkles size={14} /> {busy ? 'AI 취합 중…' : agg === 'none' ? 'AI 취합' : '재취합'}
          </button>
        )}
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

      {/* 확정본 재취합 가드 — confirmed 상태에서 재취합 시 편집 변경 가능성 고지 */}
      {confirmReagg && (
        <div
          onClick={() => setConfirmReagg(false)}
          style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--surface-bg)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', padding: 'var(--space-6)', maxWidth: 420, width: '100%' }}
          >
            <div className="tape-title" style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>확정본 재취합</div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 var(--space-5)' }}>
              이 주간보고는 <strong style={{ color: 'var(--success)' }}>확정</strong> 상태입니다. 재취합하면 기존 편집·확정은 보존되지만, AI 병합 과정에서 일부 표현이 바뀔 수 있습니다. 계속할까요?
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
