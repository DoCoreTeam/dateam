/**
 * What a person changed, and what it used to say.
 *
 * The previous value stays. A correction with no record of what it replaced cannot be
 * walked back, and the first wrong correction is what proves that.
 */

import type { AiCorrection } from '@ax/ai-core'
import type { AiLabels } from './labels.ts'
import { correctionTrail } from './review.ts'

export interface CorrectionTrailProps {
  corrections: readonly AiCorrection[]
  labels: Pick<AiLabels, 'corrected'>
  /** Turning an actor id into a name. The package never knows what an actor is */
  actorName?: (by: string) => string
  className?: string
}

export function CorrectionTrail({ corrections, labels, actorName, className }: CorrectionTrailProps) {
  const trail = correctionTrail(corrections)
  if (trail.length === 0) return null
  return (
    <ol className={className} data-ai-trail="true">
      {trail.map((t, i) => (
        <li key={`${t.at}-${i}`} data-ai-part="correction">
          <span data-part="who">{actorName ? actorName(t.by) : t.by}</span>
          <time dateTime={t.at}>{t.at}</time>
          <span data-part="what">{labels.corrected}</span>
          <del data-part="from">{t.from}</del>
          <ins data-part="to">{t.to}</ins>
          {t.note ? <span data-part="note">{t.note}</span> : null}
        </li>
      ))}
    </ol>
  )
}
