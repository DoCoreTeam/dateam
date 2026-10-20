'use client'

// 자동으로 채운 값과 자동으로 고친 값 — 한 목록에 선다. 견적서에는 안 실린다.
// 채운 값은 사람이 말하지 않아 엔진이 채운 칸이고, 고친 값은 규칙이나 AI 검토가 고쳐 둔 칸이다.
// 고친 값마다 되돌리기가 붙는다. 되돌린 칸은 「사람이 고침」으로 잠겨 다음 정리가 다시 고치지 않는다.

import { PRICEBOOK, PROVENANCE_LABEL } from '@/lib/terms'
import type { QuoteDraft } from '../quote-draft-shape'
import { undoTextFix, type FilledEntry } from './text-fill-apply'
import styles from './quote-fill.module.css'

interface Props {
  draft: QuoteDraft
  onDraftChange?: (fn: (prev: QuoteDraft) => QuoteDraft) => void
  disabled?: boolean
}

export default function AutoFilledList({ draft, onDraftChange, disabled }: Props) {
  const items = (draft.autoFilled ?? []) as FilledEntry[]
  if (items.length === 0) return null
  const fixed = items.filter((a) => a.undo).length
  const filled = items.length - fixed
  return (
    <details open={fixed > 0}>
      <summary className="label">
        {[filled > 0 ? `${PRICEBOOK.autoFilled} ${filled}개` : null, fixed > 0 ? `${PRICEBOOK.autoFixed} ${fixed}개` : null].filter(Boolean).join(' · ')}
      </summary>
      <ul className={styles.filled}>
        {items.map((a, k) => (
          <li key={k} className={a.undo ? styles.fixedRow : undefined}>
            <span>
              <b>{a.field} {a.value}</b>: {a.provenance.note ?? PROVENANCE_LABEL[a.provenance.source as keyof typeof PROVENANCE_LABEL] ?? a.provenance.source}
            </span>
            {a.undo && onDraftChange && (
              <button
                type="button"
                className={styles.undo}
                disabled={disabled}
                aria-label={`${a.field} ${PRICEBOOK.revert}`}
                onClick={() => onDraftChange((d) => undoTextFix(d, k))}
              >
                {PRICEBOOK.revert}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
