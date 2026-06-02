'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, Lock, Pencil, Users, Sparkles } from 'lucide-react'
import { aggregateDept, saveDeptReport } from './org-actions'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })

interface SlimNode { id: string; type: string; parent_id: string | null; name: string }
interface DeptStat { memberCount: number; reportedCount: number; agg: 'none' | 'draft' | 'confirmed' }
interface MergedRow { category: string; performance: string; plan: string; issues: string }

// 기존 취합(AdminReportsPreview)과 동일한 sanitize/표시 규칙
const ALLOWED_TAGS = /^(p|ul|ol|li|strong|em|br|span|b|i)$/i
function sanitizeHtml(html: string): string {
  return html
    .replace(/<([a-z][a-z0-9]*)[^>]*>/gi, (_m, tag: string) => (ALLOWED_TAGS.test(tag) ? `<${tag.toLowerCase()}>` : ''))
    .replace(/<\/([a-z][a-z0-9]*)[^>]*>/gi, (_m, tag: string) => (ALLOWED_TAGS.test(tag) ? `</${tag.toLowerCase()}>` : ''))
}
function RichCell({ html }: { html: string }) {
  if (!html || html === '<p></p>') return <span style={{ color: '#cbd5e1' }}>-</span>
  if (html.startsWith('<')) return <div className="report-rich" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
  return <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151', lineHeight: 1.6 }}>{html}</p>
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
  deptBodies: Record<string, MergedRow[]>
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
      confirmed: { t: '확정', c: '#059669', b: '#ecfdf5', br: '#a7f3d0' },
      draft: { t: '초안', c: '#64748b', b: '#f1f5f9', br: '#e2e8f0' },
      none: { t: '미취합', c: '#d97706', b: '#fffbeb', br: '#fde68a' },
    }[agg]
    return <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: m.c, background: m.b, border: `1px solid ${m.br}`, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{m.t}</span>
  }

  return (
    <div style={{ width: '100%' }}>
      {/* 주차 네비 — 이전/다음 화살표 (무한 과거 이동, 미래는 이번 주까지) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <Link href={`/weekly-report?tab=org&orgWeek=${prevWeek}`} prefetch={false} aria-label="이전 주"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '0.5rem', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', textDecoration: 'none' }}>
          <ChevronLeft size={16} />
        </Link>
        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', minWidth: 96, textAlign: 'center' }}>{weekStart} 주</span>
        {atCurrent ? (
          <span aria-label="다음 주" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '0.5rem', border: '1px solid #f1f5f9', background: '#f8fafc', color: '#cbd5e1' }}>
            <ChevronRight size={16} />
          </span>
        ) : (
          <Link href={`/weekly-report?tab=org&orgWeek=${nextWeek}`} prefetch={false} aria-label="다음 주"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '0.5rem', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', textDecoration: 'none' }}>
            <ChevronRight size={16} />
          </Link>
        )}
        {!atCurrent && (
          <Link href="/weekly-report?tab=org" prefetch={false}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '0.375rem', textDecoration: 'none', color: '#6366f1', background: '#eef2ff', border: '1px solid #c7d2fe' }}>
            이번 주
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '1rem', fontSize: '0.8125rem' }}>
        {stack.map((id, idx) => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            {idx > 0 && <ChevronRight size={13} color="#cbd5e1" />}
            <button onClick={() => jumpTo(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: idx === stack.length - 1 ? '#0f172a' : '#6366f1', fontWeight: idx === stack.length - 1 ? 700 : 500, padding: 0 }}>
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
          initialBody={deptBodies[currentNode.id] ?? []}
          aggBadge={aggBadge}
        />
      ) : (
        <div className="responsive-grid-cols-3" style={{ display: 'grid', gap: '0.75rem' }}>
          {childDepts.length === 0 && <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>하위 부서가 없습니다.</p>}
          {childDepts.map((d) => {
            const st = deptStats[d.id] ?? { memberCount: 0, reportedCount: 0, agg: 'none' as const }
            const canEdit = editableDeptIds.includes(d.id)
            return (
              <button key={d.id} onClick={() => drillInto(d.id)} style={{ textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.625rem', padding: '1rem', cursor: 'pointer', minHeight: 44 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#0f172a' }}>{d.name}</span>
                  {canEdit ? <Pencil size={13} color="#6366f1" /> : <Lock size={12} color="#94a3b8" />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {aggBadge(st.agg)}
                  <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Users size={12} /> 제출 {st.reportedCount}/{st.memberCount}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6366f1', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>열기 <ChevronRight size={12} /></div>
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
  initialBody: MergedRow[]
  aggBadge: (a: DeptStat['agg']) => React.ReactNode
}

function DeptReport({ deptId, deptName, weekStart, editable, agg, initialBody, aggBadge }: DeptReportProps) {
  const router = useRouter()
  const [rows, setRows] = useState<MergedRow[]>(initialBody)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ idx: number; field: 'performance' | 'plan' | 'issues' } | null>(null)

  useEffect(() => { setRows(initialBody); setDirty(false) }, [initialBody])

  async function onAggregate() {
    setBusy(true); setMsg(null)
    const r = await aggregateDept(deptId, weekStart)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '취합 실패'); return }
    setRows((r.body as MergedRow[]) ?? []); setDirty(true)
    setMsg('AI 취합 완료 — 셀별 "수정"으로 다듬고 [확정]하세요')
  }
  async function save(confirm: boolean) {
    setBusy(true); setMsg(null)
    const r = await saveDeptReport(deptId, weekStart, rows, confirm)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '저장 실패'); return }
    setMsg(confirm ? '확정 저장 완료' : '임시 저장 완료'); setDirty(false)
    router.refresh()
  }
  const updateCell = (idx: number, field: 'performance' | 'plan' | 'issues', html: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: html } : r))); setDirty(true)
  }

  const activeValue = editingCell ? rows[editingCell.idx]?.[editingCell.field] ?? '' : ''

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '0.75rem' }}>
      {/* 헤더 — 기존 취합과 동일 톤 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '1rem 1.25rem', background: 'linear-gradient(to right, #f8f7ff, #fdf4ff)', borderBottom: '1px solid #e9d5ff', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <Sparkles size={16} color="#7c3aed" />
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1e1b4b' }}>{deptName} 취합 주간보고</span>
          {aggBadge(agg)}
          {!editable && <span style={{ fontSize: '0.6875rem', color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><Lock size={11} /> 조회 전용</span>}
        </div>
        {editable && (
          <button onClick={onAggregate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1, flexShrink: 0 }}>
            <Sparkles size={14} /> {busy ? 'AI 취합 중…' : agg === 'none' ? 'AI 취합' : '재취합'}
          </button>
        )}
      </div>

      {msg && <div role="status" style={{ padding: '0.625rem 1.25rem', background: '#eef2ff', borderBottom: '1px solid #c7d2fe', fontSize: '0.8125rem', color: '#4338ca' }}>{msg}</div>}

      {rows.length === 0 ? (
        <p style={{ padding: '1.25rem', color: '#94a3b8', fontSize: '0.875rem', margin: 0 }}>
          {editable ? '아직 취합본이 없습니다. 상단 "AI 취합"으로 부서원 보고를 모으세요.' : '아직 확정된 취합본이 없습니다.'}
        </p>
      ) : (
        <div className="table-responsive">
          <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: '0.625rem 0.875rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0', width: '120px', whiteSpace: 'nowrap' }}>구분</th>
                {FIELDS.map((f) => (
                  <th key={f.key} style={{ padding: '0.625rem 0.875rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={`${row.category}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                  <td className="mobile-only card-header"><span style={{ fontWeight: 700, color: '#4338ca' }}>{row.category}</span></td>
                  <td data-label="구분" style={{ padding: '0.75rem 0.875rem', fontSize: '0.8125rem', color: '#4338ca', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.category}</td>
                  {FIELDS.map((f) => (
                    <td key={f.key} data-label={f.label} style={{ padding: '0.75rem 0.875rem', verticalAlign: 'top' }}>
                      <RichCell html={row[f.key]} />
                      {editable && (
                        <button onClick={() => setEditingCell({ idx, field: f.key })} style={{ marginTop: '0.375rem', padding: '0.125rem 0.375rem', fontSize: '0.7rem', color: '#9ca3af', background: 'none', border: '1px solid #e5e7eb', borderRadius: '0.25rem', cursor: 'pointer' }}>수정</button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && rows.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0.875rem 1.25rem', borderTop: '1px solid #f1f5f9' }}>
          <button onClick={() => save(true)} disabled={busy} style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff', background: '#059669', border: 'none', borderRadius: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>확정</button>
          <button onClick={() => save(false)} disabled={busy} style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>임시저장</button>
          {dirty && <span style={{ alignSelf: 'center', fontSize: '0.75rem', color: '#d97706' }}>저장되지 않은 변경</span>}
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
    </div>
  )
}
