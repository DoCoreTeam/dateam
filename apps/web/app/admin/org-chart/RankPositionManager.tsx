'use client'

import { useState, useTransition } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { createRank, deleteRank, createPosition, deletePosition } from './actions'
import { isEnterKey } from '@/lib/ui/ime'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import InlineError from '@/components/ui/InlineError'

interface RankItem {
  id: number
  name: string
  display_order: number
}

interface Props {
  ranks: RankItem[]
  positions: RankItem[]
}

// 직급/직책은 **같은 성격의 목록 관리**다. 예전엔 두 벌을 복붙해 두어
// 한쪽만 고치면 갈라졌다(CLAUDE.md §2-5). 한 부품으로 두 번 쓴다.
interface ListManagerProps {
  title: string
  items: RankItem[]
  placeholder: string
  emptyTitle: string
  onAdd: (name: string) => Promise<{ error?: string | null } | void>
  onDelete: (id: number) => Promise<unknown>
}

function ListManager({ title, items, placeholder, emptyTitle, onAdd, onDelete }: ListManagerProps) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd() {
    const name = input.trim()
    if (!name) return
    setError(null)
    startTransition(async () => {
      const res = await onAdd(name)
      if (res && 'error' in res && res.error) setError(res.error)
      else setInput('')
    })
  }

  // props 배열을 sort()로 **제자리 변형**하던 것을 복사본 정렬로 바꿨다(불변성).
  const sorted = [...items].sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="card">
      <h3 className="tape-title" style={{ margin: 0 }}>{title}</h3>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <input
          className="input-field"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => isEnterKey(e) && handleAdd()}
          placeholder={placeholder}
          disabled={isPending}
          style={{ flex: 1 }}
        />
        <NbButton onClick={handleAdd} disabled={isPending || !input.trim()} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
          <Plus size={14} /> 추가
        </NbButton>
      </div>
      <InlineError compact spaced>{error}</InlineError>
      {sorted.length === 0 ? (
        <EmptyState title={emptyTitle} description={`위 입력칸에 이름을 적고 “추가”를 누르면 여기에 쌓입니다`} />
      ) : (
        <ul style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {sorted.map(item => (
            <li key={item.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-bg)',
              borderRadius: 'var(--radius-lg)', fontSize: 'var(--fs-base)', color: 'var(--text)',
            }}>
              {item.name}
              <button
                onClick={() => startTransition(async () => { await onDelete(item.id) })}
                disabled={isPending}
                aria-label={`${item.name} 삭제`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: '2px' }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RankPositionManager({ ranks, positions }: Props) {
  return (
    <div className="responsive-grid-cols-2" style={{ marginTop: 'var(--space-8)' }}>
      <ListManager
        title="직급 관리"
        items={ranks}
        placeholder="직급명 입력"
        emptyTitle="등록된 직급이 없어요"
        onAdd={createRank}
        onDelete={deleteRank}
      />
      <ListManager
        title="직책 관리"
        items={positions}
        placeholder="직책명 입력"
        emptyTitle="등록된 직책이 없어요"
        onAdd={createPosition}
        onDelete={deletePosition}
      />
    </div>
  )
}
