'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { updateUserProfile } from '../org-chart/actions'

interface RankItem {
  id: number
  name: string
  display_order: number
}

interface Props {
  userId: string
  defaultName: string
  defaultRank: string | null
  defaultPosition: string | null
  ranks: RankItem[]
  positions: RankItem[]
  onClose: () => void
}

export default function EditProfileModal({
  userId,
  defaultName,
  defaultRank,
  defaultPosition,
  ranks,
  positions,
  onClose,
}: Props) {
  useEscClose(onClose)
  const [name, setName] = useState(defaultName)
  const [rank, setRank] = useState(defaultRank ?? '')
  const [position, setPosition] = useState(defaultPosition ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!name.trim()) { setError('이름을 입력하세요'); return }
    setError(null)
    startTransition(async () => {
      const res = await updateUserProfile(userId, {
        name: name.trim(),
        rank: rank || null,
        position: position || null,
      })
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        background: '#fff', borderRadius: 'var(--radius)', width: '360px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.15)', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem', borderBottom: '2px solid var(--border-color)',
        }}>
          <h3 className="tape-title" style={{ margin: 0 }}>
            사용자 정보 수정
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>이름 *</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isPending}
              style={{
                padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius)', fontSize: '0.875rem', outline: 'none',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>직급</span>
            <select
              value={rank}
              onChange={e => setRank(e.target.value)}
              disabled={isPending}
              style={{
                padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius)', fontSize: '0.875rem', background: '#fff', outline: 'none',
              }}
            >
              <option value="">— 직급 없음 —</option>
              {ranks.sort((a, b) => a.display_order - b.display_order).map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>직책</span>
            <select
              value={position}
              onChange={e => setPosition(e.target.value)}
              disabled={isPending}
              style={{
                padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius)', fontSize: '0.875rem', background: '#fff', outline: 'none',
              }}
            >
              <option value="">— 직책 없음 —</option>
              {positions.sort((a, b) => a.display_order - b.display_order).map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>

          {error && <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.8rem' }}>{error}</p>}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '0.5rem',
          padding: '0.75rem 1.25rem', borderTop: '2px solid var(--border-color)',
        }}>
          <button
            onClick={onClose}
            disabled={isPending}
            style={{
              padding: '0.45rem 1rem', background: 'var(--surface-muted)', color: 'var(--text-muted)',
              border: 'none', borderRadius: 'var(--radius)', fontSize: '0.875rem', cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            style={{
              padding: '0.45rem 1rem', background: 'var(--brand-dark)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius)', fontSize: '0.875rem',
              cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
