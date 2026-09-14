/**
 * Asking the model again.
 *
 * Only offered when something can actually change: the value is not settled yet, or another
 * model is available. Offering it otherwise invites a person to spend money and time on the
 * same answer.
 */

import type { AiValueStatus } from '@ax/ai-core'
import type { AiLabels } from './labels.ts'
import { canAskAgain } from './notice.ts'

export interface AskAgainProps {
  status: AiValueStatus
  labels: Pick<AiLabels, 'askAgain'>
  /** Another model exists, so the same question can get a different answer */
  otherModelAvailable?: boolean
  onAsk: () => void
  className?: string
}

export function AskAgain({ status, labels, otherModelAvailable, onAsk, className }: AskAgainProps) {
  if (!canAskAgain(status, Boolean(otherModelAvailable))) return null
  return (
    <button type="button" className={className} data-ai-ask="true" onClick={onAsk}>
      {labels.askAgain}
    </button>
  )
}
