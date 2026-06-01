'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { StickyNote, Check, ArrowUpRight } from 'lucide-react'
import { STALENESS_STYLE, relativeTime, type MemoListItem } from './memoUtils'
import { setMemoStatus } from '@/app/(member)/daily/actions'
import MemoPromoteModal from './MemoPromoteModal'

interface Props {
  // compact: 홈 위젯(작게), full: 일일업무(조금 더)
  variant?: 'compact' | 'full'
}

export default function UnreviewedMemoWidget({ variant = 'compact' }: Props) {
  const [items, setItems] = useState<MemoListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [promoteTarget, setPromoteTarget] = useState<MemoListItem | null>(null)
  const [, startTransition] = useTransition()

  const limit = variant === 'compact' ? 3 : 6

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/daily/memos?status=unreviewed', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        setItems((json.items ?? []) as MemoListItem[])
      }
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleReview(id: string) {
    startTransition(async () => {
      await setMemoStatus(id, 'reviewed')
      setItems((prev) => prev.filter((m) => m.id !== id))
    })
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>메모 불러오는 중…</div>
      </div>
    )
  }

  const shown = items.slice(0, limit)

  return (
    <>
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: shown.length ? '0.75rem' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <StickyNote size={16} color="#d97706" />
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>확인 안 한 메모</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#d97706', background: '#fffbeb', borderRadius: '999px', padding: '1px 8px' }}>
              {items.length}
            </span>
          </div>
          <Link href="/daily?view=memo" style={{ fontSize: '0.78rem', color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
            전체 →
          </Link>
        </div>

        {shown.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: '#94a3b8', padding: '0.5rem 0' }}>
            확인 안 한 메모가 없습니다 ✨
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {shown.map((m) => {
              const st = STALENESS_STYLE[m.staleness]
              return (
                <li key={m.id} className={`memo-widget-item${m.staleness === 'stale' ? ' memo-pulse' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.6rem', borderRadius: '0.5rem', background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                  <span title={st.label} style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.content}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: st.text }}>{relativeTime(m.logged_at)}</div>
                  </div>
                  <button onClick={() => handleReview(m.id)} title="확인 완료"
                    style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.4rem', cursor: 'pointer', padding: '3px 5px', color: '#16a34a', display: 'flex', flexShrink: 0 }}>
                    <Check size={13} />
                  </button>
                  <button onClick={() => setPromoteTarget(m)} title="업무로 전환"
                    style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.4rem', cursor: 'pointer', padding: '3px 5px', color: '#4f46e5', display: 'flex', flexShrink: 0 }}>
                    <ArrowUpRight size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {promoteTarget && (
        <MemoPromoteModal
          memo={promoteTarget}
          onClose={() => setPromoteTarget(null)}
          onDone={() => { setPromoteTarget(null); load() }}
        />
      )}
    </>
  )
}
