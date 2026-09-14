/**
 * Work still arriving.
 *
 * When the remaining amount is unknown it is drawn as unknown rather than as a bar parked
 * near the end. A bar that lies about progress is worse than no bar.
 */

import type { AiValueStatus } from '@ax/ai-core'
import type { AiLabels } from './labels.ts'
import { progressView } from './notice.ts'

export interface ProgressProps {
  status: AiValueStatus
  labels: Pick<AiLabels, 'inProgress'>
  done?: number | null
  total?: number | null
  className?: string
}

export function Progress({ status, labels, done, total, className }: ProgressProps) {
  const view = progressView(status, done ?? null, total ?? null, labels.inProgress)
  if (!view.running) return null
  return (
    <span
      className={className}
      data-ai-progress={view.ratio === null ? 'unknown' : 'known'}
      role="status"
      aria-live="polite"
    >
      {view.ratio === null
        ? view.text
        : <progress value={view.ratio} max={1}>{view.text}</progress>}
    </span>
  )
}
