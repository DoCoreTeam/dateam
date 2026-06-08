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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* 상태 필터 */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {(['unreviewed', 'all'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{
                padding: '0.35rem 0.85rem', borderRadius: '999px', fontSize: '0.8rem', cursor: 'pointer',
                border: statusFilter === s ? 'var(--hairline) solid var(--brand-dark)' : 'var(--border-w-2) solid var(--border-color)',
                background: statusFilter === s ? 'var(--brand-soft)' : '#fff',
                color: statusFilter === s ? 'var(--brand-dark)' : 'var(--text-muted)', fontWeight: statusFilter === s ? 600 : 400,
              }}>
              {s === 'unreviewed' ? '미확인' : '전체'}
            </button>
          ))}
          <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginLeft: 'auto' }}>{filtered.length}건 · 최신순</span>
        </div>

        {/* AI 클러스터 칩 */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Sparkles size={14} color="var(--brand)" />
          <button onClick={() => setActiveCluster(null)}
            style={chipStyle(activeCluster === null)}>전체</button>
          {clusterLoading && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand-soft-2)' }}>주제 분석 중…</span>}
          {clusters.map((c) => (
            <button key={c.label} onClick={() => setActiveCluster(c.label === activeCluster ? null : c.label)}
              style={chipStyle(activeCluster === c.label)}>
              {c.label} <span style={{ opacity: 0.6 }}>{c.count}</span>
            </button>
          ))}
        </div>

        {/* 메모 리스트 (타임스탬프 정렬) */}
        {loading ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-faint)', padding: 'var(--space-4)' }}>불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-faint)' }}>
            <StickyNote size={28} style={{ opacity: 0.4 }} />
            <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>해당하는 메모가 없습니다</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {filtered.map((m) => {
              const st = STALENESS_STYLE[m.staleness]
              return (
                <li key={m.id}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem 0.9rem', borderRadius: 'var(--radius-lg)', background: '#fff', border: 'var(--border-w-2) solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                  <span title={st.label} style={{ width: 9, height: 9, borderRadius: '50%', background: st.dot, flexShrink: 0, marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.5 }}>{m.content}</div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.3rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: st.text }}>{relativeTime(m.logged_at)}</span>
                      {m.memo_status === 'reviewed' && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--success)', background: 'var(--success-bg)', borderRadius: '999px', padding: '0 6px' }}>확인됨</span>
                      )}
                      {m.memo_status === 'actioned' && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', background: 'var(--surface-muted)', borderRadius: '999px', padding: '0 6px' }}>정리됨</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                    {m.memo_status === 'new' && (
                      <button onClick={() => handleReview(m.id)} title="확인 완료"
                        style={iconBtn('var(--success)')}><Check size={14} /></button>
                    )}
                    <button onClick={() => setPromoteTarget(m)} title="업무로 전환" style={iconBtn('var(--brand-dark)')}><ArrowUpRight size={14} /></button>
                    <button onClick={() => handleArchive(m.id)} title="보관" style={iconBtn('var(--text-faint)')}><Archive size={14} /></button>
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
    border: active ? 'var(--hairline) solid var(--brand)' : 'var(--border-w-2) solid var(--border-color)',
    background: active ? 'var(--brand-soft)' : '#fff',
    color: active ? 'var(--brand)' : 'var(--text-muted)', fontWeight: active ? 600 : 400,
  }
}
function iconBtn(color: string): React.CSSProperties {
  return { background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', padding: '4px 6px', color, display: 'flex' }
}
