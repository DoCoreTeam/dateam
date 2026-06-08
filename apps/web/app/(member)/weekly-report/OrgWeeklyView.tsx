'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, Lock, Pencil, Users, Sparkles } from 'lucide-react'
import { saveDeptReport } from './org-actions'

const EditorModal = dynamic(() => import('@/components/ui/EditorModal'), { ssr: false })

interface SlimNode { id: string; type: string; parent_id: string | null; name: string }
interface DeptStat { memberCount: number; reportedCount: number; agg: 'none' | 'draft' | 'confirmed' }
interface AuthorBlock { name: string; rank?: string; performance: string; plan: string; issues: string }
interface MergedRow { category: string; authors: AuthorBlock[] }

// 기존 취합(AdminReportsPreview)과 동일한 sanitize/표시 규칙
const ALLOWED_TAGS = /^(p|ul|ol|li|strong|em|br|span|b|i)$/i
function sanitizeHtml(html: string): string {
  return html
    .replace(/<([a-z][a-z0-9]*)[^>]*>/gi, (_m, tag: string) => (ALLOWED_TAGS.test(tag) ? `<${tag.toLowerCase()}>` : ''))
    .replace(/<\/([a-z][a-z0-9]*)[^>]*>/gi, (_m, tag: string) => (ALLOWED_TAGS.test(tag) ? `</${tag.toLowerCase()}>` : ''))
}
function RichCell({ html }: { html: string }) {
  if (!html || html === '<p></p>') return <span style={{ color: 'var(--border-subtle)' }}>-</span>
  if (html.startsWith('<')) return <div className="report-rich" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
  return <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text)', lineHeight: 1.6 }}>{html}</p>
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
      confirmed: { t: '확정', c: 'var(--success)', b: 'var(--success-bg)', br: 'var(--success-border)' },
      draft: { t: '초안', c: 'var(--text-muted)', b: 'var(--surface-muted)', br: 'var(--color-border)' },
      none: { t: '미취합', c: 'var(--warning)', b: 'var(--warning-bg)', br: 'var(--warning-border)' },
    }[agg]
    return <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: m.c, background: m.b, border: `1px solid ${m.br}`, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>{m.t}</span>
  }

  return (
    <div style={{ width: '100%' }}>
      {/* 주차 네비 — 이전/다음 화살표 (무한 과거 이동, 미래는 이번 주까지) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <Link href={`/weekly-report?tab=org&orgWeek=${prevWeek}`} prefetch={false} aria-label="이전 주"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 'var(--radius)', border: '2px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', textDecoration: 'none' }}>
          <ChevronLeft size={16} />
        </Link>
        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)', minWidth: 96, textAlign: 'center' }}>{weekStart} 주</span>
        {atCurrent ? (
          <span aria-label="다음 주" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 'var(--radius)', border: '1px solid var(--surface-muted)', background: 'var(--color-bg)', color: 'var(--border-subtle)' }}>
            <ChevronRight size={16} />
          </span>
        ) : (
          <Link href={`/weekly-report?tab=org&orgWeek=${nextWeek}`} prefetch={false} aria-label="다음 주"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 'var(--radius)', border: '2px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', textDecoration: 'none' }}>
            <ChevronRight size={16} />
          </Link>
        )}
        {!atCurrent && (
          <Link href="/weekly-report?tab=org" prefetch={false}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '0.375rem', textDecoration: 'none', color: 'var(--brand)', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-2)' }}>
            이번 주
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '1rem', fontSize: '0.8125rem' }}>
        {stack.map((id, idx) => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
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
          initialBody={deptBodies[currentNode.id] ?? []}
          aggBadge={aggBadge}
        />
      ) : (
        <div className="responsive-grid-cols-3" style={{ display: 'grid', gap: '0.75rem' }}>
          {childDepts.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: '0.875rem' }}>하위 부서가 없습니다.</p>}
          {childDepts.map((d) => {
            const st = deptStats[d.id] ?? { memberCount: 0, reportedCount: 0, agg: 'none' as const }
            const canEdit = editableDeptIds.includes(d.id)
            return (
              <button key={d.id} onClick={() => drillInto(d.id)} style={{ textAlign: 'left', background: '#fff', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', padding: '1rem', cursor: 'pointer', minHeight: 44 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text)' }}>{d.name}</span>
                  {canEdit ? <Pencil size={13} color="var(--brand)" /> : <Lock size={12} color="var(--text-faint)" />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {aggBadge(st.agg)}
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Users size={12} /> 제출 {st.reportedCount}/{st.memberCount}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>열기 <ChevronRight size={12} /></div>
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
  const [members, setMembers] = useState<{ name: string; rank?: string; category: string }[]>([])
  const [streamRows, setStreamRows] = useState<MergedRow[]>([])
  const [localStatus, setLocalStatus] = useState<DeptStat['agg']>(agg)
  const [editingCell, setEditingCell] = useState<{ idx: number; authorIdx: number; field: 'performance' | 'plan' | 'issues' } | null>(null)

  useEffect(() => { setRows(initialBody); setDirty(false); setLocalStatus(agg) }, [initialBody, agg])

  // 스트리밍 취합: 카테고리가 통합되는 대로 실시간 표시
  async function onAggregate() {
    setBusy(true); setMsg(null); setMembers([]); setStreamRows([])
    try {
      const res = await fetch('/api/reports/aggregate-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deptId, weekStart }),
      })
      if (!res.ok || !res.body) { setMsg(`취합 실패: ${await res.text().catch(() => res.status)}`); setBusy(false); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const collected: MergedRow[] = []
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          try {
            const ev = JSON.parse(t.slice(5).trim())
            if (ev.type === 'members') setMembers(ev.members ?? [])
            else if (ev.type === 'category' && ev.item?.category) { collected.push(ev.item); setStreamRows([...collected]) }
            else if (ev.type === 'error') setMsg(ev.message ?? '취합 실패')
          } catch { /* skip */ }
        }
      }
      setBusy(false)
      if (collected.length > 0) {
        setRows(collected); setDirty(true)
        setMsg('AI 취합 완료 — 셀별 "수정"으로 다듬고 [확정]하세요')
      }
    } catch (e) {
      setBusy(false); setMsg(e instanceof Error ? e.message : '취합 실패')
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
  const updateCell = (idx: number, authorIdx: number, field: 'performance' | 'plan' | 'issues', html: string) => {
    setRows((prev) => prev.map((r, i) => i === idx
      ? { ...r, authors: r.authors.map((a, ai) => ai === authorIdx ? { ...a, [field]: html } : a) }
      : r)); setDirty(true)
    setLocalStatus('draft')
  }

  const activeValue = editingCell ? rows[editingCell.idx]?.authors?.[editingCell.authorIdx]?.[editingCell.field] ?? '' : ''

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)' }}>
      {/* 헤더 — 기존 취합과 동일 톤 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '1rem 1.25rem', background: 'linear-gradient(to right, var(--surface-bg), var(--brand-soft))', borderBottom: '1px solid var(--brand-soft-2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <Sparkles size={16} color="var(--brand)" />
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text)' }}>{deptName} 취합 주간보고</span>
          {aggBadge(localStatus)}
          {!editable && <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><Lock size={11} /> 조회 전용</span>}
        </div>
        {editable && (
          <button onClick={onAggregate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1, flexShrink: 0 }}>
            <Sparkles size={14} /> {busy ? 'AI 취합 중…' : agg === 'none' ? 'AI 취합' : '재취합'}
          </button>
        )}
      </div>

      {msg && <div role="status" style={{ padding: '0.625rem 1.25rem', background: 'var(--brand-soft)', borderBottom: '1px solid var(--brand-soft-2)', fontSize: '0.8125rem', color: 'var(--brand-dark)' }}>{msg}</div>}

      {busy ? (
        <div style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--brand)', marginBottom: '0.75rem' }}>
            <Sparkles size={15} /> 취합 중…
          </div>
          {/* 취합 대상 부서원 보고 + 상태 */}
          {members.length > 0 && (
            <div style={{ marginBottom: '0.875rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-faint)', marginBottom: '0.35rem' }}>취합 대상 부서원 보고 {members.length}건</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {members.map((m, i) => (
                  <span key={i} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--surface-muted)', border: '2px solid var(--border-color)', borderRadius: '0.375rem', padding: '0.15rem 0.45rem' }}>
                    {m.name}{m.rank ? ` ${m.rank}` : ''} · {m.category}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* 실시간 통합 카테고리 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {streamRows.length === 0 ? (
              <span style={{ fontSize: '0.8rem', color: 'var(--brand-soft-2)' }}>부서원 보고를 종합하는 중…</span>
            ) : streamRows.map((r, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: 'var(--text)' }}>
                <span style={{ color: 'var(--success)', fontWeight: 700, marginRight: '0.35rem' }}>✓</span>
                <span style={{ fontWeight: 600 }}>{r.category}</span> 카테고리 통합됨
              </div>
            ))}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ padding: '1.25rem', color: 'var(--text-faint)', fontSize: '0.875rem', margin: 0 }}>
          {editable ? '아직 취합본이 없습니다. 상단 "AI 취합"으로 부서원 보고를 모으세요.' : '아직 확정된 취합본이 없습니다.'}
        </p>
      ) : (
        <div>
          {rows.map((row, idx) => (
            <div key={`${row.category}-${idx}`} style={{ borderBottom: '1px solid var(--surface-muted)' }}>
              {/* 카테고리 섹션 헤더 */}
              <div style={{ padding: '0.625rem 1.25rem', background: 'var(--color-bg)', fontWeight: 700, fontSize: '0.8125rem', color: 'var(--brand-dark)' }}>{row.category}</div>
              {/* 작성자 소블록 (직급→이름 순 보존) */}
              {(row.authors ?? []).map((au, ai) => (
                <div key={ai} style={{ padding: '0.75rem 1.25rem', borderTop: ai > 0 ? '1px dashed var(--color-border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)' }}>{au.name}</span>
                    {au.rank && <span style={{ fontSize: '0.66rem', color: 'var(--brand)', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-2)', borderRadius: '0.25rem', padding: '0.05rem 0.35rem' }}>{au.rank}</span>}
                  </div>
                  <div className="responsive-grid-cols-3" style={{ display: 'grid', gap: '0.75rem' }}>
                    {FIELDS.map((f) => (
                      <div key={f.key}>
                        <div style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-faint)', marginBottom: '0.2rem' }}>{f.label}</div>
                        <RichCell html={au[f.key]} />
                        {editable && (
                          <button onClick={() => setEditingCell({ idx, authorIdx: ai, field: f.key })} style={{ marginTop: '0.3rem', padding: '0.1rem 0.35rem', fontSize: '0.68rem', color: 'var(--text-faint)', background: 'none', border: '2px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer' }}>수정</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {editable && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.875rem 1.25rem', borderTop: '1px solid var(--surface-muted)' }}>
          {localStatus === 'confirmed' && !dirty ? (
            <button disabled style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius)', padding: '0.5rem 1rem', cursor: 'default' }}>✓ 확정됨</button>
          ) : (
            <button onClick={() => save(true)} disabled={busy} style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff', background: 'var(--success)', border: 'none', borderRadius: 'var(--radius)', padding: '0.5rem 1rem', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>{dirty && localStatus === 'confirmed' ? '재확정' : '확정'}</button>
          )}
          <button onClick={() => save(false)} disabled={busy} style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', background: 'var(--surface-muted)', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.5rem 1rem', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>임시저장</button>
          {dirty && <span style={{ alignSelf: 'center', fontSize: '0.75rem', color: 'var(--warning)' }}>저장되지 않은 변경</span>}
        </div>
      )}

      {editingCell && (
        <EditorModal
          title={`${FIELDS.find((f) => f.key === editingCell.field)?.label} 수정`}
          value={activeValue}
          onChange={(html: string) => updateCell(editingCell.idx, editingCell.authorIdx, editingCell.field, html)}
          onClose={() => setEditingCell(null)}
        />
      )}
    </div>
  )
}
