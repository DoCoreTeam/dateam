'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState, useTransition } from 'react'
import { updateUserProfile } from '../org-chart/actions'
import InlineError from '@/components/ui/InlineError'
import NbModal from '@/components/ui/nb/NbModal'

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
    // 골격 자작 → NbModal. zIndex 9999 매직넘버·role 부재가 함께 사라진다.
    <NbModal title="사용자 정보 수정" onClose={onClose} maxWidth={360}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* 레퍼런스: contacts/ContactForm — label은 감싸지 않고 형제로 둔다.
              (.label이 display:block이라 감싸면 라벨 글자가 입력 옆에 붙는다) */}
          <div>
            <label className="label" htmlFor="edit-profile-name">이름 *</label>
            <input
              id="edit-profile-name"
              className="input-field"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div>
            <label className="label" htmlFor="edit-profile-rank">직급</label>
            <select
              id="edit-profile-rank"
              className="input-field"
              value={rank}
              onChange={e => setRank(e.target.value)}
              disabled={isPending}
            >
              <option value="">— 직급 없음 —</option>
              {ranks.sort((a, b) => a.display_order - b.display_order).map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="edit-profile-position">직책</label>
            <select
              id="edit-profile-position"
              className="input-field"
              value={position}
              onChange={e => setPosition(e.target.value)}
              disabled={isPending}
            >
              <option value="">— 직책 없음 —</option>
              {positions.sort((a, b) => a.display_order - b.display_order).map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <InlineError compact>{error}</InlineError>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-5)', borderTop: 'var(--border-w-2) solid var(--border-color)',
        }}>
          <button
            onClick={onClose}
            disabled={isPending}
            style={{
              padding: '0.45rem 1rem', background: 'var(--surface-muted)', color: 'var(--text-muted)',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            style={{
              padding: '0.45rem 1rem', background: 'var(--brand-dark)', color: 'var(--brand-fg)',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)',
              cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
    </NbModal>
  )
}
