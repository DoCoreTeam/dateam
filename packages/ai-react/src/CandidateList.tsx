/**
 * What was extracted, before anyone agreed to it.
 *
 * Confirming is unavailable until a person picks, and the reason is said rather than only
 * shown as a dimmed button. A disabled control with no explanation teaches people that the
 * screen is broken.
 */

import type { ReactNode } from 'react'
import type { AiLabels } from './labels.ts'
import { canConfirmCandidates, confirmBlockedReason, type Candidate } from './review.ts'

export interface CandidateListProps<T> {
  candidates: readonly Candidate<T>[]
  labels: Pick<AiLabels, 'candidate' | 'confirmed' | 'accept'>
  /** Why confirming is unavailable, in the caller's words */
  blockedText: string
  render: (value: T) => ReactNode
  onToggle: (id: string) => void
  onConfirm: () => void
  className?: string
}

export function CandidateList<T>({
  candidates, labels, blockedText, render, onToggle, onConfirm, className,
}: CandidateListProps<T>) {
  const ready = canConfirmCandidates(candidates)
  const blocked = confirmBlockedReason(candidates)
  return (
    <div className={className} data-ai-candidates="true" data-ai-ready={ready ? 'true' : 'false'}>
      <ul>
        {candidates.map((c) => (
          <li key={c.id} data-ai-part="candidate" data-chosen={c.chosen ? 'true' : 'false'}>
            <label>
              <input type="checkbox" checked={c.chosen} onChange={() => onToggle(c.id)} />
              {render(c.value)}
            </label>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onConfirm} disabled={!ready}>{labels.accept}</button>
      {blocked ? <span data-ai-part="blocked">{blockedText}</span> : null}
    </div>
  )
}
