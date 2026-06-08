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
      <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: '1.5rem', border: 'var(--hairline) solid var(--warning-border)', background: 'var(--surface-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <StickyNote size={16} color="var(--warning)" />
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>
              이번 주 미처리 메모 {items.length}건
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--warning)' }}>— 보고 전에 정리해 보세요</span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button onClick={handleArchiveAll}
              style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', background: '#fff', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <Archive size={12} /> 전체 보관
            </button>
            <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
        </div>

        {open && (
          <ul style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {items.map((m) => {
              const st = STALENESS_STYLE[m.staleness]
              return (
                <li key={m.id} className={m.staleness === 'stale' ? 'memo-pulse' : ''}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0.5rem 0.65rem', borderRadius: 'var(--radius)', background: '#fff', border: 'var(--hairline) solid var(--surface-muted)' }}>
                  <span title={st.label} style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.83rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content}</div>
                    <div style={{ fontSize: '0.68rem', color: st.text }}>{relativeTime(m.logged_at)}</div>
                  </div>
                  <button onClick={() => handleReview(m.id)} title="확인 완료" style={iconBtn('var(--success)')}><Check size={13} /></button>
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
  return { background: 'none', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', padding: '3px 5px', color, display: 'flex', flexShrink: 0 }
}
