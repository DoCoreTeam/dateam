'use client'

import { useState, useEffect, useRef } from 'react'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

const ENTRY_TYPES: { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[] = [
  { value: 'done',    label: '완료',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'doing',   label: '진행중', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'planned', label: '예정',   color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { value: 'blocker', label: '블로커', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { value: 'note',    label: '메모',   color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
]
const ENTRY_MAP = Object.fromEntries(ENTRY_TYPES.map((t) => [t.value, t])) as Record<DailyLogEntryType, typeof ENTRY_TYPES[number]>
const GROUP_PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']

const W = 560
const H = 400
const R = 18

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ddayLabel(targetDate: string, today: string): string | null {
  const diff = Math.round(
    (new Date(targetDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000
  )
  if (diff === 0) return 'D-day'
  if (diff > 0) return `D-${diff}`
  return `D+${Math.abs(diff)}`
}

interface SimNode {
  id: string
  label: string
  type: DailyLogEntryType
  originGroupId: string | null
  parentLogId: string | null
  x: number
  y: number
  vx: number
  vy: number
}

export function KnowledgeGraphView({ logs }: { logs: DailyLog[] }) {
  const today = toDateStr(new Date())
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const frameRef = useRef<number | null>(null)
  const nodesRef = useRef<SimNode[]>([])

  const groupColors: Record<string, string> = {}
  let gci = 0
  for (const log of logs) {
    if (log.origin_group_id && !(log.origin_group_id in groupColors)) {
      groupColors[log.origin_group_id] = GROUP_PALETTE[gci % GROUP_PALETTE.length]
      gci++
    }
  }

  useEffect(() => {
    const cx = W / 2
    const cy = H / 2
    const radius = Math.min(W, H) / 2 - R - 32
    const init: SimNode[] = logs.map((log, i) => {
      const angle = (2 * Math.PI * i) / (logs.length || 1) - Math.PI / 2
      return {
        id: log.id,
        label: log.content.slice(0, 18) + (log.content.length > 18 ? '…' : ''),
        type: log.entry_type,
        originGroupId: log.origin_group_id ?? null,
        parentLogId: log.parent_log_id ?? null,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        vx: 0, vy: 0,
      }
    })
    nodesRef.current = init
    setNodes([...init])
    if (frameRef.current) cancelAnimationFrame(frameRef.current)

    const edges: [string, string][] = logs
      .filter(l => l.parent_log_id)
      .map(l => [l.parent_log_id!, l.id])

    let tick = 0
    const MAX_TICKS = 150

    const simulate = () => {
      if (tick++ >= MAX_TICKS) { setNodes([...nodesRef.current]); return }
      const ns = nodesRef.current
      const alpha = 1 - tick / MAX_TICKS

      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[j].x - ns[i].x
          const dy = ns[j].y - ns[i].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const f = (2200 / (dist * dist)) * alpha
          const fx = (dx / dist) * f; const fy = (dy / dist) * f
          ns[i].vx -= fx; ns[i].vy -= fy
          ns[j].vx += fx; ns[j].vy += fy
        }
      }

      const byId = new Map(ns.map(n => [n.id, n]))
      for (const [sid, tid] of edges) {
        const s = byId.get(sid); const t = byId.get(tid)
        if (!s || !t) continue
        const dx = t.x - s.x; const dy = t.y - s.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (dist - 110) * 0.05 * alpha
        const fx = (dx / dist) * f; const fy = (dy / dist) * f
        s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy
      }

      for (const n of ns) {
        n.vx += (W / 2 - n.x) * 0.008 * alpha
        n.vy += (H / 2 - n.y) * 0.008 * alpha
      }

      for (const n of ns) {
        n.x = Math.max(R + 2, Math.min(W - R - 2, n.x + n.vx))
        n.y = Math.max(R + 16, Math.min(H - R - 16, n.y + n.vy))
        n.vx *= 0.72; n.vy *= 0.72
      }

      nodesRef.current = [...ns]
      if (tick % 6 === 0) setNodes([...ns])
      frameRef.current = requestAnimationFrame(simulate)
    }

    frameRef.current = requestAnimationFrame(simulate)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [logs])

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const groupEdges: { x1: number; y1: number; x2: number; y2: number; color: string }[] = []
  const groupMap = new Map<string, SimNode[]>()
  for (const n of nodes) {
    if (n.originGroupId) {
      if (!groupMap.has(n.originGroupId)) groupMap.set(n.originGroupId, [])
      groupMap.get(n.originGroupId)!.push(n)
    }
  }
  groupMap.forEach((members, gid) => {
    const color = groupColors[gid] ?? '#94a3b8'
    for (let i = 0; i < members.length - 1; i++) {
      groupEdges.push({ x1: members[i].x, y1: members[i].y, x2: members[i + 1].x, y2: members[i + 1].y, color })
    }
  })

  const parentEdges: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const n of nodes) {
    if (n.parentLogId) {
      const parent = nodeMap.get(n.parentLogId)
      if (parent) parentEdges.push({ x1: parent.x, y1: parent.y, x2: n.x, y2: n.y })
    }
  }

  const selectedLog = selectedId ? (logs.find(l => l.id === selectedId) ?? null) : null
  const parentLog = selectedLog?.parent_log_id ? (logs.find(l => l.id === selectedLog.parent_log_id) ?? null) : null
  const childLogs = selectedId ? logs.filter(l => l.parent_log_id === selectedId) : []

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', background: '#fafafa', overflow: 'hidden', position: 'relative' }}>
      <div style={{
        padding: '0.625rem 1rem', borderBottom: '1px solid #e2e8f0',
        fontSize: '0.8125rem', fontWeight: 600, color: '#475569',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      }}>
        <span>🔗 당일 업무 관계도</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>
          <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          AI 묶음
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>
          <svg width="20" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#f97316" strokeWidth="1.5" /><polygon points="16,1 20,4 16,7" fill="#f97316" /></svg>
          스레드 파생
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>노드 클릭 → 상세</span>
      </div>

      <svg
        width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', maxHeight: `${H}px`, cursor: 'default' }}
        onClick={() => setSelectedId(null)}
      >
        <defs>
          <marker id="arrowOrange" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0,0 6,3 0,6" fill="#f97316" />
          </marker>
        </defs>

        {groupEdges.map((e, i) => (
          <line key={`g${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke={e.color} strokeWidth={1.5} strokeOpacity={0.4} strokeDasharray="4 3" />
        ))}

        {parentEdges.map((e, i) => {
          const dx = e.x2 - e.x1; const dy = e.y2 - e.y1
          const len = Math.sqrt(dx * dx + dy * dy); if (len === 0) return null
          const ux = dx / len; const uy = dy / len
          return (
            <line key={`p${i}`}
              x1={e.x1 + ux * R} y1={e.y1 + uy * R}
              x2={e.x2 - ux * (R + 6)} y2={e.y2 - uy * (R + 6)}
              stroke="#f97316" strokeWidth={2} strokeOpacity={0.8} markerEnd="url(#arrowOrange)" />
          )
        })}

        {nodes.map((n) => {
          const t = ENTRY_MAP[n.type]
          const gColor = n.originGroupId ? (groupColors[n.originGroupId] ?? '#e2e8f0') : '#e2e8f0'
          const isSel = n.id === selectedId
          return (
            <g key={n.id} style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); setSelectedId(isSel ? null : n.id) }}>
              {n.originGroupId && (
                <circle cx={n.x} cy={n.y} r={R + 4} fill="none" stroke={gColor} strokeWidth={2} strokeOpacity={0.4} />
              )}
              <circle cx={n.x} cy={n.y} r={R}
                fill={isSel ? t.color : t.bg} stroke={t.color} strokeWidth={isSel ? 3 : 2} />
              <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize="9" fontWeight="700" fill={isSel ? '#fff' : t.color} style={{ pointerEvents: 'none' }}>
                {t.label.slice(0, 2)}
              </text>
              <text x={n.x} y={n.y + R + 12} textAnchor="middle"
                fontSize="9" fill="#475569" style={{ pointerEvents: 'none' }}>
                {n.label}
              </text>
            </g>
          )
        })}
      </svg>

      {selectedLog && (
        <div style={{
          position: 'absolute', top: 44, right: 8,
          width: 'min(240px, calc(100% - 16px))',
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.625rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: '0.875rem', zIndex: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
              {(() => {
                const t = ENTRY_MAP[selectedLog.entry_type]
                return (
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: t.color, background: t.bg, border: `1px solid ${t.border}`, padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>
                    {t.label}
                  </span>
                )
              })()}
              {selectedLog.target_date && (() => {
                const lbl = ddayLabel(selectedLog.target_date, today)
                return lbl ? (
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>
                    {lbl}
                  </span>
                ) : null
              })()}
            </div>
            <button onClick={() => setSelectedId(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', lineHeight: 1, padding: '0 2px' }}>
              ×
            </button>
          </div>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#1e293b', lineHeight: 1.55, wordBreak: 'break-word' }}>
            {selectedLog.content}
          </p>
          {selectedLog.target_date && (
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#64748b' }}>
              📅 예정일: {selectedLog.target_date}
            </p>
          )}
          {parentLog && (
            <div style={{ background: '#f8fafc', borderRadius: '0.375rem', padding: '0.375rem 0.5rem', marginBottom: '0.5rem' }}>
              <p style={{ margin: '0 0 0.2rem', fontSize: '0.7rem', color: '#94a3b8' }}>↑ 상위 업무</p>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', wordBreak: 'break-word' }}>
                {parentLog.content.slice(0, 60)}{parentLog.content.length > 60 ? '…' : ''}
              </p>
            </div>
          )}
          {childLogs.length > 0 && (
            <div>
              <p style={{ margin: '0 0 0.25rem', fontSize: '0.7rem', color: '#94a3b8' }}>↓ 파생 업무 ({childLogs.length})</p>
              {childLogs.slice(0, 3).map(c => (
                <p key={c.id} style={{ margin: '0 0 0.2rem', fontSize: '0.75rem', color: '#475569', paddingLeft: '0.5rem', borderLeft: '2px solid #e2e8f0', wordBreak: 'break-word' }}>
                  {c.content.slice(0, 50)}{c.content.length > 50 ? '…' : ''}
                </p>
              ))}
              {childLogs.length > 3 && (
                <p style={{ margin: 0, fontSize: '0.7rem', color: '#94a3b8' }}>외 {childLogs.length - 3}개...</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
