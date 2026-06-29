'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Lock, Pencil, Users, Clock } from 'lucide-react'
import { exportTimelinessCsv } from './org-actions'
import TimelinessPanel from './TimelinessPanel'
import DeptReportPanel, { aggBadge, type AnyRow, type AggState } from './DeptReportPanel'
import { TIMELINESS_COLORS } from '@/lib/tokens/status-colors'
import type { MemberTimeliness } from '@/lib/weekly-report/timeliness'

interface SlimNode { id: string; type: string; parent_id: string | null; name: string }
interface DeptStat { memberCount: number; reportedCount: number; agg: AggState }

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
  deptTimeliness?: Record<string, MemberTimeliness[]>
  isAdmin?: boolean
}

export default function OrgWeeklyView(props: Props) {
  const { weekStart, thisWeek, nodes, editableDeptIds, deptStats, deptBodies } = props
  const deptTimeliness = props.deptTimeliness ?? {}
  const isAdmin = props.isAdmin ?? false
  const prevWeek = shiftWeek(weekStart, -1)
  const nextWeek = shiftWeek(weekStart, 1)
  const atCurrent = weekStart >= thisWeek
  const [stack, setStack] = useState<string[]>(() => props.scopeRootIds.slice(0, 1))
  const [exporting, setExporting] = useState(false)

  // admin 증빙 내보내기: 서버에서 전 부서 적시성 CSV 생성 → 브라우저 다운로드.
  async function onExportCsv() {
    setExporting(true)
    try {
      const r = await exportTimelinessCsv(weekStart)
      if (!r.ok) { alert(r.error); return }
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `weekly-timeliness-${weekStart}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

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
        {isAdmin && (
          <button onClick={onExportCsv} disabled={exporting}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: 'var(--fs-xs)', fontWeight: 600, padding: '0.3rem 0.7rem', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', cursor: exporting ? 'wait' : 'pointer' }}>
            <Clock size={13} /> {exporting ? '내보내는 중…' : '적시성 CSV'}
          </button>
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
        <>
          <TimelinessPanel members={deptTimeliness[currentNode.id] ?? []} />
          <DeptReportPanel
            key={`${currentNode.id}-${weekStart}`}
            deptId={currentNode.id}
            deptName={currentNode.name}
            weekStart={weekStart}
            editable={editableDeptIds.includes(currentNode.id)}
            agg={(deptStats[currentNode.id]?.agg) ?? 'none'}
            initialBody={deptBodies[currentNode.id] ?? []}
          />
        </>
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
                {(() => {
                  const tl = deptTimeliness[d.id] ?? []
                  const late = tl.filter((m) => m.status === 'late' || m.status === 'final_late').length
                  const missing = tl.filter((m) => m.status === 'missing').length
                  if (late === 0 && missing === 0) return null
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      {late > 0 && <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: TIMELINESS_COLORS.late.color, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}><Clock size={11} /> 지연 {late}</span>}
                      {missing > 0 && <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: TIMELINESS_COLORS.missing.color }}>미제출 {missing}</span>}
                    </div>
                  )
                })()}
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>열기 <ChevronRight size={12} /></div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
