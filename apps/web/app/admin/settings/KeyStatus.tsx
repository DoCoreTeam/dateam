'use client'

// 키 설정 상태 표시 — 같은 블록이 Gemini·Claude·OpenAI·환율에 인라인으로 4번 복붙돼 있었고
// YouTube만 또 다른 모양이라 카드마다 질감이 갈렸다. 여기가 유일한 구현이다(§2).

import { CheckCircle, XCircle, Trash2 } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'

interface Props {
  /** 마스킹된 키. 없으면 "설정되지 않음"으로 그린다 */
  maskedKey: string | null
  /** 미설정일 때 무엇이 제한되는지 한 줄로. 정직하게 알린다 */
  emptyHint?: string
  onChangeClick: () => void
  /** 삭제를 지원하는 카드만 넘긴다. 없는 기능을 버튼으로 만들어내지 않는다. */
  onDelete?: () => void
  deletePending?: boolean
}

export default function KeyStatus({ maskedKey, emptyHint, onChangeClick, onDelete, deletePending }: Props) {
  if (!maskedKey) {
    return (
      <p className="key-status key-status-empty">
        <XCircle size={14} />
        <span>설정되지 않음{emptyHint ? ` — ${emptyHint}` : ''}</span>
      </p>
    )
  }

  return (
    <div className="key-status key-status-set">
      <div className="key-status-head">
        <span className="key-status-label">
          <CheckCircle size={14} />
          API 키 설정됨
        </span>
        <span className="key-status-actions">
          <button type="button" className="key-status-btn" onClick={onChangeClick}>변경</button>
          {onDelete && (
            <button
              type="button"
              className="key-status-btn is-danger"
              onClick={onDelete}
              disabled={deletePending}
            >
              {deletePending ? <AXDotLoader size={4} color="var(--danger)" /> : <Trash2 size={12} />}
              삭제
            </button>
          )}
        </span>
      </div>
      <code className="key-status-value">{maskedKey}</code>
    </div>
  )
}
