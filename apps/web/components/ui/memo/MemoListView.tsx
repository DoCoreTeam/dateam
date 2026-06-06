'use client'

import { useEffect, useState, useTransition, useCallback } from 'react'
import { StickyNote, Check, ArrowUpRight, Archive, Sparkles } from 'lucide-react'
import { STALENESS_STYLE, relativeTime, type MemoListItem } from './memoUtils'
import { setMemoStatus } from '@/app/(member)/daily/actions'
import MemoPromoteModal from './MemoPromoteModal'

interface Cluster { label: string; memoIds: string[]; count: number }

export default function MemoListView() {
  const [items, setItems] = useState<MemoListItem[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [activeCluster, setActiveCluster] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'unreviewed' | 'all'>('unreviewed')
  const [loading, setLoading] = useState(true)
  const [clusterLoading, setClusterLoading] = useState(false)
  const [promoteTarget, setPromoteTarget] = useState<MemoListItem | null>(null)
  const [, startTransition] = useTransition()

  const loadMemos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/daily/memos?status=${statusFilter}`, { cache: 'no-store' })
      if (res.ok) { const j = await res.json(); setItems((j.items ?? []) as MemoListItem[]) }
    } catch { /* noop */ } finally { setLoading(false) }
  }, [statusFilter])

  const loadClusters = useCallback(async () => {
    setClusterLoading(true)
    try {
      const res = await fetch('/api/daily/memos/clusters', { cache: 'no-store' })
      if (res.ok) { const j = await res.json(); setClusters((j.clusters ?? []) as Cluster[]) }
    } catch { /* noop */ } finally { setClusterLoading(false) }
  }, [])

  useEffect(() => { loadMemos() }, [loadMemos])
  useEffect(() => { loadClusters() }, [loadClusters])

  function handleReview(id: string) {
    startTransition(async () => {
      await setMemoStatus(id, 'reviewed')
      loadMemos()
    })
  }
  function handleArchive(id: string) {
    startTransition(async () => {
      await setMemoStatus(id, 'actioned')
      loadMemos(); loadClusters()
    })
  }

  // 클러스터 필터 적용
  const activeIds = activeCluster ? clusters.find((c) => c.label === activeCluster)?.memoIds ?? [] : null
  const filtered = activeIds ? items.filter((m) => activeIds.includes(m.id)) : items

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* 상태 필터 */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {(['unreviewed', 'all'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{
                padding: '0.35rem 0.85rem', borderRadius: '999px', fontSize: '0.8rem', cursor: 'pointer',
                border: statusFilter === s ? '1px solid var(--brand-dark)' : '1px solid #e2e8f0',
                background: statusFilter === s ? '#eef2ff' : '#fff',
                color: statusFilter === s ? 'var(--brand-dark)' : '#64748b', fontWeight: statusFilter === s ? 600 : 400,
              }}>
              {s === 'unreviewed' ? '미확인' : '전체'}
            </button>
          ))}
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginLeft: 'auto' }}>{filtered.length}건 · 최신순</span>
        </div>

        {/* AI 클러스터 칩 */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Sparkles size={14} color="var(--brand)" />
          <button onClick={() => setActiveCluster(null)}
            style={chipStyle(activeCluster === null)}>전체</button>
          {clusterLoading && <span style={{ fontSize: '0.75rem', color: '#a78bfa' }}>주제 분석 중…</span>}
          {clusters.map((c) => (
            <button key={c.label} onClick={() => setActiveCluster(c.label === activeCluster ? null : c.label)}
              style={chipStyle(activeCluster === c.label)}>
              {c.label} <span style={{ opacity: 0.6 }}>{c.count}</span>
            </button>
          ))}
        </div>

        {/* 메모 리스트 (타임스탬프 정렬) */}
        {loading ? (
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', padding: '1rem' }}>불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
            <StickyNote size={28} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>해당하는 메모가 없습니다</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {filtered.map((m) => {
              const st = STALENESS_STYLE[m.staleness]
              return (
                <li key={m.id}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem 0.9rem', borderRadius: '0.6rem', background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                  <span title={st.label} style={{ width: 9, height: 9, borderRadius: '50%', background: st.dot, flexShrink: 0, marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', color: '#1e293b', lineHeight: 1.5 }}>{m.content}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: st.text }}>{relativeTime(m.logged_at)}</span>
                      {m.memo_status === 'reviewed' && (
                        <span style={{ fontSize: '0.65rem', color: '#16a34a', background: '#f0fdf4', borderRadius: '999px', padding: '0 6px' }}>확인됨</span>
                      )}
                      {m.memo_status === 'actioned' && (
                        <span style={{ fontSize: '0.65rem', color: '#64748b', background: '#f1f5f9', borderRadius: '999px', padding: '0 6px' }}>정리됨</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                    {m.memo_status === 'new' && (
                      <button onClick={() => handleReview(m.id)} title="확인 완료"
                        style={iconBtn('#16a34a')}><Check size={14} /></button>
                    )}
                    <button onClick={() => setPromoteTarget(m)} title="업무로 전환" style={iconBtn('var(--brand-dark)')}><ArrowUpRight size={14} /></button>
                    <button onClick={() => handleArchive(m.id)} title="보관" style={iconBtn('#94a3b8')}><Archive size={14} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {promoteTarget && (
        <MemoPromoteModal memo={promoteTarget} onClose={() => setPromoteTarget(null)}
          onDone={() => { setPromoteTarget(null); loadMemos(); loadClusters() }} />
      )}
    </>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.78rem', cursor: 'pointer',
    border: active ? '1px solid var(--brand)' : '1px solid #e2e8f0',
    background: active ? '#f5f3ff' : '#fff',
    color: active ? '#7c3aed' : '#64748b', fontWeight: active ? 600 : 400,
  }
}
function iconBtn(color: string): React.CSSProperties {
  return { background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.4rem', cursor: 'pointer', padding: '4px 6px', color, display: 'flex' }
}
