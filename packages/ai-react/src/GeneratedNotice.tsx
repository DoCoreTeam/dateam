/**
 * "A model wrote this."
 *
 * There is no way to render this component and have it say nothing. A notice that can be
 * switched off is a notice nobody has to honour, and the obligation here is legal as much
 * as it is honest.
 *
 * This file only draws. What to say and when lives in the .ts next to it, because the test
 * runner cannot read .tsx at all, and a rule a test cannot read is a rule nobody keeps.
 */

import type { AiLabels } from './labels.ts'

export interface GeneratedNoticeProps {
  labels: Pick<AiLabels, 'generated'>
  /** Which model, when the caller wants to name it */
  modelName?: string | null
  className?: string
}

export function GeneratedNotice({ labels, modelName, className }: GeneratedNoticeProps) {
  return (
    <span className={className} data-ai-generated="true">
      {labels.generated}
      {modelName ? ` (${modelName})` : null}
    </span>
  )
}
