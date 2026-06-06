'use client'

import { useEffect, useState, useTransition } from 'react'
import { StickyNote, Check, ArrowUpRight, Archive, ChevronDown, ChevronUp } from 'lucide-react'
import { STALENESS_STYLE, relativeTime, type MemoListItem } from './memoUtils'
import { setMemoStatus, bulkArchiveMemos } from '@/app/(member)/daily/actions'
import MemoPromoteModal from './MemoPromoteModal'

// 주간보고 작성 시 미처리 메모 리뷰 nudge
export default function WeeklyMemoReview() {
  const [items, setItems] = useState<MemoListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)
  const [promoteTarget, setPromoteTarget] = useState<MemoListItem | null>(null)
  const [, startTransition] = useTransition()

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/daily/memos?status=unreviewed', { cache: 'no-store' })
      if (res.ok) { const j = await res.json(); setItems((j.items ?? []) as MemoListItem[]) }
    } catch { /* noop */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function handleReview(id: string) {
    startTransition(async () => { await setMemoStatus(id, 'reviewed'); setItems((p) => p.filter((m) => m.id !== id)) })
  }
  function handleArchiveAll() {
    const ids = items.map((m) => m.id)
    startTransition(async () => { await bulkArchiveMemos(ids); setItems([]) })
  }

  if (loading || items.length === 0) return null  // 미처리 메모 없으면 표시 안 함

  return (
    <>
      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', border: '1px solid #fde68a', background: '#fffdf5' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <StickyNote size={16} color="#d97706" />
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
              이번 주 미처리 메모 {items.length}건
            </span>
            <span style={{ fontSize: '0.78rem', color: '#a16207' }}>— 보고 전에 정리해 보세요</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={handleArchiveAll}
              style={{ fontSize: '0.75rem', color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.4rem', padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Archive size={12} /> 전체 보관
            </button>
            <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex' }}>
              {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
        </div>

        {open && (
          <ul style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {items.map((m) => {
              const st = STALENESS_STYLE[m.staleness]
              return (
                <li key={m.id} className={m.staleness === 'stale' ? 'memo-pulse' : ''}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.65rem', borderRadius: '0.5rem', background: '#fff', border: '1px solid #f1f5f9' }}>
                  <span title={st.label} style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.83rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content}</div>
                    <div style={{ fontSize: '0.68rem', color: st.text }}>{relativeTime(m.logged_at)}</div>
                  </div>
                  <button onClick={() => handleReview(m.id)} title="확인 완료" style={iconBtn('#16a34a')}><Check size={13} /></button>
                  <button onClick={() => setPromoteTarget(m)} title="업무로 전환" style={iconBtn('var(--brand-dark)')}><ArrowUpRight size={13} /></button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {promoteTarget && (
        <MemoPromoteModal memo={promoteTarget} onClose={() => setPromoteTarget(null)}
          onDone={() => { setPromoteTarget(null); load() }} />
      )}
    </>
  )
}

function iconBtn(color: string): React.CSSProperties {
  return { background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.4rem', cursor: 'pointer', padding: '3px 5px', color, display: 'flex', flexShrink: 0 }
}
