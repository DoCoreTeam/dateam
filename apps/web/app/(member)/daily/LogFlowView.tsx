'use client'

import { useState, useEffect } from 'react'
import type { DailyLog, DailyLogEntryType } from '@/types/database'
import { DdayBadge, todayLocal } from '@/lib/dday'

const ENTRY_TYPES: { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[] = [
  { value: 'done',    label: '완료',   color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
  { value: 'doing',   label: '진행중', color: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
  { value: 'planned', label: '예정',   color: 'var(--brand)', bg: 'var(--brand-soft)', border: 'var(--brand-soft-2)' },
  { value: 'blocker', label: '블로커', color: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
  { value: 'note',    label: '메모',   color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
]
const ENTRY_MAP = Object.fromEntries(ENTRY_TYPES.map((t) => [t.value, t])) as Record<DailyLogEntryType, typeof ENTRY_TYPES[number]>

interface TreeNode {
  log: DailyLog
  children: TreeNode[]
}

interface FlatNode {
  log: DailyLog
  depth: number
  hasChildren: boolean
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

function buildTree(rootId: string, logMap: Map<string, DailyLog>): TreeNode | null {
  const log = logMap.get(rootId)
  if (!log) return null
  const children = Array.from(logMap.values())
    .filter(l => l.parent_log_id === rootId)
    .map(c => buildTree(c.id, logMap))
    .filter((c): c is TreeNode => c !== null)
  return { log, children }
}

function flattenDFS(node: TreeNode, depth: number, result: FlatNode[]) {
  result.push({ log: node.log, depth, hasChildren: node.children.length > 0 })
  for (const child of node.children) {
    flattenDFS(child, depth + 1, result)
  }
}

export function LogFlowView({ log, allLogs, onClose }: {
  log: DailyLog
  allLogs: DailyLog[]
  onClose: () => void
}) {
  const [flowReasons, setFlowReasons] = useState<Map<string, string | null>>(new Map())
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())

  const logMap = new Map(allLogs.map(l => [l.id, l]))
  const rootId = findRoot(log, logMap)
  const tree = buildTree(rootId, logMap)
  const flat: FlatNode[] = []
  if (tree) flattenDFS(tree, 0, flat)

  // Lazy-load flow_reason for nodes that have a parent but no reason yet
  useEffect(() => {
    const needsLoad = flat.filter(n => n.log.parent_log_id && !n.log.flow_reason)
    if (needsLoad.length === 0) return

    const ids = needsLoad.map(n => n.log.id)
    setLoadingIds(new Set(ids))

    Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch('/api/daily/flow-reason', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logId: id }),
          })
          const data = await res.json() as { flow_reason?: string | null }
          return [id, data.flow_reason ?? null] as const
        } catch {
          return [id, null] as const
        }
      })
    ).then((results) => {
      setFlowReasons(new Map(results))
      setLoadingIds(new Set())
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.id])

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="day-panel-backdrop" onClick={onClose} />
      <div className="day-panel">
        <div className="day-panel-drag-handle" />

        <div className="day-panel-header">
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text)' }}>
            🌊 업무 플로우
          </span>
          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, border: '2px solid var(--border-color)',
              borderRadius: '0.375rem', background: 'var(--color-bg)',
              cursor: 'pointer', fontSize: '1.125rem', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="닫기"
          >×</button>
        </div>

        <div className="day-panel-body">
          {flat.length <= 1 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '2rem 0', fontSize: '0.875rem' }}>
              연결된 파생 업무가 없습니다
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {flat.map((n, idx) => {
                const t = ENTRY_MAP[n.log.entry_type]
                const isHighlight = n.log.id === log.id
                const flowReason = n.log.flow_reason ?? flowReasons.get(n.log.id)
                const isLoading = loadingIds.has(n.log.id)
                const isFirst = idx === 0

                return (
                  <div key={n.log.id}>
                    {/* 연결 표시 (루트 제외) */}
                    {!isFirst && (
                      <div style={{
                        marginLeft: `calc(${n.depth * 1.25}rem + 0.75rem)`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '0.125rem',
                        padding: '0.25rem 0',
                      }}>
                        {/* flow_reason 배지 */}
                        {(flowReason || isLoading) && (
                          <div style={{
                            fontSize: '0.7rem', color: 'var(--brand)',
                            background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-2)',
                            borderRadius: '0.25rem', padding: '0.15rem 0.5rem',
                            maxWidth: '100%', wordBreak: 'keep-all',
                          }}>
                            {isLoading ? '✦ AI 분석 중...' : `✦ ${flowReason}`}
                          </div>
                        )}
                        {/* 화살표 */}
                        <span style={{ color: 'var(--warning)', fontSize: '1rem', lineHeight: 1 }}>↓</span>
                      </div>
                    )}

                    {/* 노드 카드 */}
                    <div style={{
                      marginLeft: `${n.depth * 1.25}rem`,
                      border: `2px solid ${isHighlight ? t.color : 'var(--color-border)'}`,
                      borderLeft: `4px solid ${t.color}`,
                      borderRadius: 'var(--radius)',
                      padding: '0.625rem 0.875rem',
                      background: isHighlight ? t.bg : '#fff',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.25rem' }}>
                        <span style={{
                          fontSize: '0.6875rem', fontWeight: 700, color: t.color,
                          background: t.bg, border: `1px solid ${t.border}`,
                          padding: '0.1rem 0.35rem', borderRadius: '0.25rem', flexShrink: 0,
                        }}>
                          {t.label}
                        </span>
                        {isHighlight && (
                          <span style={{
                            fontSize: '0.6rem', fontWeight: 700, color: 'var(--info)',
                            background: 'var(--info-bg)', padding: '0.1rem 0.35rem', borderRadius: '0.25rem',
                          }}>
                            현재
                          </span>
                        )}
                        {n.log.target_date && (
                          <DdayBadge
                            targetDate={n.log.target_date}
                            today={todayLocal()}
                            style={{ marginLeft: 'auto' }}
                          />
                        )}
                      </div>
                      <p style={{
                        margin: 0, fontSize: '0.875rem', color: 'var(--text)',
                        lineHeight: 1.5, wordBreak: 'break-word',
                      }}>
                        {n.log.content}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
