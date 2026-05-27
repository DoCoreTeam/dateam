'use client'

import type { DailyLog, DailyLogEntryType } from '@/types/database'

const ENTRY_TYPES: { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[] = [
  { value: 'done',    label: '완료',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'doing',   label: '진행중', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'planned', label: '예정',   color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { value: 'blocker', label: '블로커', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { value: 'note',    label: '메모',   color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
]
const ENTRY_MAP = Object.fromEntries(ENTRY_TYPES.map((t) => [t.value, t])) as Record<DailyLogEntryType, typeof ENTRY_TYPES[number]>

interface TreeNode {
  log: DailyLog
  children: TreeNode[]
}

function buildTree(rootId: string, logMap: Map<string, DailyLog>): TreeNode | null {
  const log = logMap.get(rootId)
  if (!log) return null
  const allLogs = Array.from(logMap.values())
  const children = allLogs
    .filter(l => l.parent_log_id === rootId)
    .map(c => buildTree(c.id, logMap))
    .filter((c): c is TreeNode => c !== null)
  return { log, children }
}

function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0)
}

function findRoot(log: DailyLog, logMap: Map<string, DailyLog>): string {
  let id = log.id
  const visited = new Set<string>()
  while (true) {
    visited.add(id)
    const current = logMap.get(id)
    if (!current?.parent_log_id || visited.has(current.parent_log_id)) break
    if (!logMap.has(current.parent_log_id)) break
    id = current.parent_log_id
  }
  return id
}

function FlowNodeCard({ node, highlightId, isVertical }: { node: TreeNode; highlightId: string; isVertical: boolean }) {
  const t = ENTRY_MAP[node.log.entry_type]
  const isHighlight = node.log.id === highlightId
  const hasChildren = node.children.length > 0

  return (
    <div style={{
      display: 'flex',
      flexDirection: isVertical ? 'column' : 'row',
      alignItems: isVertical ? 'center' : 'flex-start',
      gap: isVertical ? '0.25rem' : '0.5rem',
    }}>
      <div style={{
        border: `2px solid ${isHighlight ? t.color : '#e2e8f0'}`,
        borderRadius: '0.5rem',
        padding: '0.5rem 0.75rem',
        background: isHighlight ? t.bg : '#fff',
        minWidth: isVertical ? 160 : 140,
        maxWidth: 220,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '0.625rem', fontWeight: 700, color: t.color,
          background: t.bg, border: `1px solid ${t.border}`,
          padding: '0.05rem 0.35rem', borderRadius: '0.2rem',
          display: 'inline-block', marginBottom: '0.25rem',
        }}>
          {t.label}
        </span>
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#1e293b', wordBreak: 'break-word', lineHeight: 1.4 }}>
          {node.log.content.slice(0, 60)}{node.log.content.length > 60 ? '…' : ''}
        </p>
        {node.log.target_date && (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.7rem', color: '#64748b' }}>
            📅 {node.log.target_date}
          </p>
        )}
      </div>

      {hasChildren && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            ...(isVertical
              ? { height: 20, width: 32 }
              : { width: 20, alignSelf: 'center' }
            ),
          }}>
            <span style={{ color: '#f97316', fontSize: '0.9rem' }}>
              {isVertical ? '↓' : '→'}
            </span>
          </div>
          <div style={{
            display: 'flex',
            flexDirection: isVertical ? 'column' : 'row',
            gap: isVertical ? '0.5rem' : '0.75rem',
            alignItems: isVertical ? 'center' : 'flex-start',
          }}>
            {node.children.map(child => (
              <FlowNodeCard key={child.log.id} node={child} highlightId={highlightId} isVertical={isVertical} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function LogFlowView({ log, allLogs, onClose }: {
  log: DailyLog
  allLogs: DailyLog[]
  onClose: () => void
}) {
  const logMap = new Map(allLogs.map(l => [l.id, l]))
  const rootId = findRoot(log, logMap)
  const tree = buildTree(rootId, logMap)
  if (!tree) return null

  const totalNodes = countNodes(tree)
  const isVertical = totalNodes <= 5

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: '0.75rem',
          boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
          maxWidth: isVertical ? 320 : '90vw',
          width: isVertical ? 'auto' : '90vw',
          maxHeight: '80vh',
          overflow: 'auto',
          padding: '1.25rem',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#1e293b' }}>🌊 업무 플로우</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.25rem', lineHeight: 1, padding: '0 4px' }}
          >
            ×
          </button>
        </div>

        <div style={{ overflow: 'auto' }}>
          <FlowNodeCard node={tree} highlightId={log.id} isVertical={isVertical} />
        </div>

        {totalNodes === 1 && (
          <p style={{ margin: '1rem 0 0', fontSize: '0.8125rem', color: '#94a3b8', textAlign: 'center' }}>
            연결된 파생 업무가 없습니다
          </p>
        )}
      </div>
    </div>
  )
}
