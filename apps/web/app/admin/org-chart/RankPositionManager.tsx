'use client'

import { useState, useTransition } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { createRank, deleteRank, createPosition, deletePosition } from './actions'

interface RankItem {
  id: number
  name: string
  display_order: number
}

interface Props {
  ranks: RankItem[]
  positions: RankItem[]
}

export default function RankPositionManager({ ranks, positions }: Props) {
  const [rankInput, setRankInput] = useState('')
  const [posInput, setPosInput] = useState('')
  const [rankError, setRankError] = useState<string | null>(null)
  const [posError, setPosError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAddRank() {
    const name = rankInput.trim()
    if (!name) return
    setRankError(null)
    startTransition(async () => {
      const res = await createRank(name)
      if (res.error) setRankError(res.error)
      else setRankInput('')
    })
  }

  function handleDeleteRank(id: number) {
    startTransition(async () => {
      await deleteRank(id)
    })
  }

  function handleAddPosition() {
    const name = posInput.trim()
    if (!name) return
    setPosError(null)
    startTransition(async () => {
      const res = await createPosition(name)
      if (res.error) setPosError(res.error)
      else setPosInput('')
    })
  }

  function handleDeletePosition(id: number) {
    startTransition(async () => {
      await deletePosition(id)
    })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '2rem' }}>
      {/* 직급 관리 */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '1.25rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>직급 관리</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <input
            value={rankInput}
            onChange={e => setRankInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddRank()}
            placeholder="직급명 입력"
            disabled={isPending}
            style={{
              flex: 1, padding: '0.4rem 0.75rem', border: '1px solid #cbd5e1',
              borderRadius: '0.5rem', fontSize: '0.875rem', outline: 'none',
            }}
          />
          <button
            onClick={handleAddRank}
            disabled={isPending || !rankInput.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.25rem',
              padding: '0.4rem 0.75rem', background: 'var(--brand-dark)', color: '#fff',
              border: 'none', borderRadius: '0.5rem', fontSize: '0.8rem',
              cursor: 'pointer', opacity: isPending || !rankInput.trim() ? 0.5 : 1,
            }}
          >
            <Plus size={14} /> 추가
          </button>
        </div>
        {rankError && <p style={{ margin: '0 0 0.5rem', color: '#ef4444', fontSize: '0.8rem' }}>{rankError}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {ranks.sort((a, b) => a.display_order - b.display_order).map(r => (
            <li key={r.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.35rem 0.6rem', background: '#f8fafc', borderRadius: '0.4rem',
              fontSize: '0.875rem', color: '#334155',
            }}>
              {r.name}
              <button
                onClick={() => handleDeleteRank(r.id)}
                disabled={isPending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {ranks.length === 0 && (
            <li style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '0.5rem 0' }}>등록된 직급이 없습니다</li>
          )}
        </ul>
      </div>

      {/* 직책 관리 */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '1.25rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>직책 관리</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <input
            value={posInput}
            onChange={e => setPosInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddPosition()}
            placeholder="직책명 입력"
            disabled={isPending}
            style={{
              flex: 1, padding: '0.4rem 0.75rem', border: '1px solid #cbd5e1',
              borderRadius: '0.5rem', fontSize: '0.875rem', outline: 'none',
            }}
          />
          <button
            onClick={handleAddPosition}
            disabled={isPending || !posInput.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.25rem',
              padding: '0.4rem 0.75rem', background: 'var(--brand-dark)', color: '#fff',
              border: 'none', borderRadius: '0.5rem', fontSize: '0.8rem',
              cursor: 'pointer', opacity: isPending || !posInput.trim() ? 0.5 : 1,
            }}
          >
            <Plus size={14} /> 추가
          </button>
        </div>
        {posError && <p style={{ margin: '0 0 0.5rem', color: '#ef4444', fontSize: '0.8rem' }}>{posError}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {positions.sort((a, b) => a.display_order - b.display_order).map(p => (
            <li key={p.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.35rem 0.6rem', background: '#f8fafc', borderRadius: '0.4rem',
              fontSize: '0.875rem', color: '#334155',
            }}>
              {p.name}
              <button
                onClick={() => handleDeletePosition(p.id)}
                disabled={isPending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {positions.length === 0 && (
            <li style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '0.5rem 0' }}>등록된 직책이 없습니다</li>
          )}
        </ul>
      </div>
    </div>
  )
}
