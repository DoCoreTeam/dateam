/**
 * Where a value came from.
 *
 * An empty list is said out loud rather than left blank. A blank area reads as "no evidence
 * needed", which is a different claim from "no evidence was recorded".
 */

import type { AiEvidence } from '@ax/ai-core'
import type { AiLabels } from './labels.ts'
import { evidenceView, evidenceSpan } from './value.ts'

export interface EvidenceProps {
  items: readonly AiEvidence[] | null | undefined
  labels: Pick<AiLabels, 'showEvidence' | 'noEvidence'>
  /** Jumping to the source. Without it the evidence is readable but not reachable */
  onOpen?: (item: AiEvidence) => void
  className?: string
}

export function Evidence({ items, labels, onOpen, className }: EvidenceProps) {
  const view = evidenceView(items, labels)
  if (view.empty) {
    return <span className={className} data-ai-evidence="none">{view.text}</span>
  }
  return (
    <ul className={className} data-ai-evidence="some">
      {view.items.map((e, i) => (
        <li key={`${e.blockId}-${e.start}-${i}`} data-ai-part="evidence">
          <button type="button" onClick={onOpen ? () => onOpen(e) : undefined} disabled={!onOpen}>
            {e.quote ?? evidenceSpan(e)}
          </button>
        </li>
      ))}
    </ul>
  )
}
