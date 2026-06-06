'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState, useTransition } from 'react'
import { X, ArrowUpRight } from 'lucide-react'
import { promoteMemoToTask } from '@/app/(member)/daily/actions'
import type { MemoListItem } from './memoUtils'

interface Props {
  memo: MemoListItem
  onClose: () => void
  onDone: () => void
}

export default function MemoPromoteModal({ memo, onClose, onDone }: Props) {
  useEscClose(onClose)
  const [newType, setNewType] = useState<'planned' | 'doing'>('planned')
  const [targetDate, setTargetDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await promoteMemoToTask(memo.id, newType, targetDate || null)
      if (res.ok) onDone()
      else setError(res.error)
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 'var(--radius)', width: '380px', maxWidth: '92vw', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '2px solid var(--border-color)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>
            <ArrowUpRight size={16} color="var(--brand-dark)" /> 메모를 업무로
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ fontSize: '0.82rem', color: '#475569', background: 'var(--color-bg)', borderRadius: 'var(--radius)', padding: '0.6rem 0.75rem', lineHeight: 1.5 }}>
            {memo.content}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>업무 상태</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['planned', 'doing'] as const).map((t) => (
                <button key={t} onClick={() => setNewType(t)}
                  style={{
                    flex: 1, padding: '0.5rem', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.85rem',
                    border: newType === t ? '2px solid var(--brand-dark)' : '1px solid var(--border-color)',
                    background: newType === t ? '#f3effe' : '#fff',
                    color: newType === t ? 'var(--brand-dark)' : '#64748b', fontWeight: newType === t ? 600 : 400,
                  }}>
                  {t === 'planned' ? '예정' : '진행중'}
                </button>
              ))}
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>목표일 (선택)</span>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
              style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: '0.875rem' }} />
          </label>

          {error && <p style={{ margin: 0, color: '#ef4444', fontSize: '0.8rem' }}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.25rem' }}>
            <button onClick={onClose} disabled={isPending}
              style={{ padding: '0.45rem 1rem', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 'var(--radius)', fontSize: '0.875rem', cursor: 'pointer' }}>취소</button>
            <button onClick={handleSubmit} disabled={isPending}
              style={{ padding: '0.45rem 1rem', background: 'var(--brand-dark)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: '0.875rem', cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1 }}>
              {isPending ? '전환 중…' : '업무로 전환'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
