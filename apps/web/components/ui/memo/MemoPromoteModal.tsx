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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>
            <ArrowUpRight size={16} color="var(--brand-dark)" /> 메모를 업무로
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', background: 'var(--color-bg)', borderRadius: 'var(--radius)', padding: '0.6rem 0.75rem', lineHeight: 1.5 }}>
            {memo.content}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>업무 상태</span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {(['planned', 'doing'] as const).map((t) => (
                <button key={t} onClick={() => setNewType(t)}
                  style={{
                    flex: 1, padding: 'var(--space-2)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.85rem',
                    border: newType === t ? 'var(--border-w-2) solid var(--brand-dark)' : 'var(--hairline) solid var(--border-color)',
                    background: newType === t ? 'var(--brand-soft)' : '#fff',
                    color: newType === t ? 'var(--brand-dark)' : 'var(--text-muted)', fontWeight: newType === t ? 600 : 400,
                  }}>
                  {t === 'planned' ? '예정' : '진행중'}
                </button>
              ))}
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>목표일 (선택)</span>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
              style={{ padding: 'var(--space-2) var(--space-3)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)' }} />
          </label>

          {error && <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.8rem' }}>{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', paddingTop: 'var(--space-1)' }}>
            <button onClick={onClose} disabled={isPending}
              style={{ padding: '0.45rem 1rem', background: 'var(--surface-muted)', color: 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', cursor: 'pointer' }}>취소</button>
            <button onClick={handleSubmit} disabled={isPending}
              style={{ padding: '0.45rem 1rem', background: 'var(--brand-dark)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1 }}>
              {isPending ? '전환 중…' : '업무로 전환'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
