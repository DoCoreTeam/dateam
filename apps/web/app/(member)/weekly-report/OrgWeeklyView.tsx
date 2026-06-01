'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Lock, Pencil, Users, Sparkles } from 'lucide-react'
import { aggregateDept, saveDeptReport } from './org-actions'

interface SlimNode { id: string; type: string; parent_id: string | null; name: string }
interface DeptStat { memberCount: number; reportedCount: number; agg: 'none' | 'draft' | 'confirmed' }
interface MergedRow { category: string; performance: string; plan: string; issues: string }

interface Props {
  weekStart: string
  weekOptions: string[]
  nodes: SlimNode[]
  editableDeptIds: string[]
  readableDeptIds: string[]
  isExecutive: boolean
  scopeRootIds: string[]
  deptStats: Record<string, DeptStat>
  deptBodies: Record<string, MergedRow[]>
}

export default function OrgWeeklyView(props: Props) {
  const { weekStart, weekOptions, nodes, editableDeptIds, deptStats, deptBodies } = props
  const router = useRouter()
  const [stack, setStack] = useState<string[]>(() => props.scopeRootIds.slice(0, 1))
  const [editing, setEditing] = useState<MergedRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  // 가장 가까운 하위 '부서' 노드들 (role/company 같은 구조 노드는 건너뜀)
  const nearestChildDepts = useMemo(() => {
    return (rootId: string): SlimNode[] => {
      const out: SlimNode[] = []
      const walk = (id: string) => {
        for (const c of nodes.filter((n) => n.parent_id === id)) {
          if (c.type === 'department') out.push(c)
          else if (c.type === 'role' || c.type === 'company') walk(c.id)
        }
      }
      walk(rootId)
      return out.sort((a, b) => a.name.localeCompare(b.name))
    }
  }, [nodes])

  const currentId = stack[stack.length - 1]
  const currentNode = currentId ? nodeById.get(currentId) : undefined
  const childDepts = currentId ? nearestChildDepts(currentId) : []
  const isLeafDept = currentNode?.type === 'department' && childDepts.length === 0

  const drillInto = (id: string) => { setStack((s) => [...s, id]); setEditing(null); setMsg(null) }
  const jumpTo = (idx: number) => { setStack((s) => s.slice(0, idx + 1)); setEditing(null); setMsg(null) }

  async function onAggregate(deptId: string) {
    setBusy(true); setMsg(null)
    const r = await aggregateDept(deptId, weekStart)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '취합 실패'); return }
    setEditing((r.body as MergedRow[]) ?? [])
    setMsg('AI 취합 완료 — 검토 후 확정하세요')
  }
  async function onSave(deptId: string, confirm: boolean) {
    if (!editing) return
    setBusy(true); setMsg(null)
    const r = await saveDeptReport(deptId, weekStart, editing, confirm)
    setBusy(false)
    if (!r.ok) { setMsg(r.error ?? '저장 실패'); return }
    setMsg(confirm ? '확정 저장 완료' : '임시 저장 완료')
    setEditing(null)
    router.refresh()
  }

  const aggBadge = (agg: DeptStat['agg']) => {
    const map = {
      confirmed: { t: '확정', c: '#059669', b: '#ecfdf5', br: '#a7f3d0' },
      draft: { t: '초안', c: '#64748b', b: '#f1f5f9', br: '#e2e8f0' },
      none: { t: '미취합', c: '#d97706', b: '#fffbeb', br: '#fde68a' },
    }[agg]
    return <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: map.c, background: map.b, border: `1px solid ${map.br}`, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{map.t}</span>
  }

  return (
    <div style={{ width: '100%' }}>
      {/* 주차 선택 */}
      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {weekOptions.slice(0, 6).map((w) => (
          <Link key={w} href={`/weekly-report?tab=org&orgWeek=${w}`} prefetch={false}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '0.375rem', textDecoration: 'none',
              fontWeight: w === weekStart ? 700 : 500,
              color: w === weekStart ? '#6366f1' : '#64748b',
              background: w === weekStart ? '#eef2ff' : '#f8fafc', border: '1px solid #e2e8f0' }}>
            {w}
          </Link>
        ))}
      </div>

      {/* 브레드크럼 */}
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

      {msg && <div role="status" style={{ padding: '0.625rem 0.875rem', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#4338ca' }}>{msg}</div>}

      {/* 리프 부서 = 취합본 / 그 외 = 부서 카드 그리드 */}
      {isLeafDept && currentNode ? (
        <DeptReport
          dept={currentNode}
          editable={editableDeptIds.includes(currentNode.id)}
          stat={deptStats[currentNode.id]}
          body={editing ?? deptBodies[currentNode.id] ?? []}
          editing={editing !== null}
          busy={busy}
          aggBadge={aggBadge}
          onAggregate={() => onAggregate(currentNode.id)}
          onChange={setEditing}
          onSaveDraft={() => onSave(currentNode.id, false)}
          onConfirm={() => onSave(currentNode.id, true)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="responsive-grid-cols-3" style={{ display: 'grid', gap: '0.75rem' }}>
          {childDepts.length === 0 && <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>하위 부서가 없습니다.</p>}
          {childDepts.map((d) => {
            const st = deptStats[d.id] ?? { memberCount: 0, reportedCount: 0, agg: 'none' as const }
            const canEdit = editableDeptIds.includes(d.id)
            return (
              <button key={d.id} onClick={() => drillInto(d.id)}
                style={{ textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.625rem', padding: '1rem', cursor: 'pointer', minHeight: 44 }}>
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
                <div style={{ fontSize: '0.75rem', color: '#6366f1', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  열기 <ChevronRight size={12} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface DeptReportProps {
  dept: SlimNode
  editable: boolean
  stat?: DeptStat
  body: MergedRow[]
  editing: boolean
  busy: boolean
  aggBadge: (a: DeptStat['agg']) => React.ReactNode
  onAggregate: () => void
  onChange: (rows: MergedRow[]) => void
  onSaveDraft: () => void
  onConfirm: () => void
  onCancel: () => void
}

function DeptReport({ dept, editable, stat, body, editing, busy, aggBadge, onAggregate, onChange, onSaveDraft, onConfirm, onCancel }: DeptReportProps) {
  const agg = stat?.agg ?? 'none'
  return (
    <div className="card" style={{ padding: '1.25rem', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>{dept.name} 취합 주간보고</h3>
          {aggBadge(agg)}
          {!editable && <span style={{ fontSize: '0.6875rem', color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><Lock size={11} /> 조회 전용</span>}
        </div>
        {editable && !editing && (
          <button onClick={onAggregate} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8125rem', fontWeight: 600, color: '#fff', background: '#6366f1', border: 'none', borderRadius: '0.5rem', padding: '0.5rem 0.875rem', cursor: busy ? 'wait' : 'pointer' }}>
            <Sparkles size={14} /> {agg === 'none' ? 'AI 취합' : '재취합'}
          </button>
        )}
      </div>

      {body.length === 0 && !editing && (
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>{editable ? '아직 취합본이 없습니다. "AI 취합"으로 부서원 보고를 모으세요.' : '아직 확정된 취합본이 없습니다.'}</p>
      )}

      {body.map((row, i) => (
        <div key={`${row.category}-${i}`} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9', padding: '0.875rem 0' }}>
          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#4338ca', marginBottom: '0.5rem' }}>{row.category}</div>
          {(['performance', 'plan', 'issues'] as const).map((f) => {
            const label = f === 'performance' ? '성과' : f === 'plan' ? '계획' : '이슈/협조'
            return (
              <div key={f} style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', marginBottom: '0.2rem' }}>{label}</div>
                {editing ? (
                  <textarea value={row[f]} disabled={busy}
                    onChange={(e) => onChange(body.map((r, j) => j === i ? { ...r, [f]: e.target.value } : r))}
                    rows={3} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '0.5rem', fontSize: '0.8125rem', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
                ) : (
                  <div className="report-rich" style={{ fontSize: '0.8125rem', lineHeight: 1.6, color: '#1e293b' }} dangerouslySetInnerHTML={{ __html: row[f] || '<span style="color:#cbd5e1">—</span>' }} />
                )}
              </div>
            )
          })}
        </div>
      ))}

      {editing && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button onClick={onConfirm} disabled={busy} style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff', background: '#059669', border: 'none', borderRadius: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>확정</button>
          <button onClick={onSaveDraft} disabled={busy} style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>임시저장</button>
          <button onClick={onCancel} disabled={busy} style={{ fontSize: '0.8125rem', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>취소</button>
        </div>
      )}
    </div>
  )
}
