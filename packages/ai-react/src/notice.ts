/**
 * The rules for telling a reader a machine was involved, and for showing work in flight.
 *
 * These two belong together: both are about not letting a screen imply more certainty than
 * it has. One says who wrote it, the other says it is not finished yet.
 */

import type { AiCapability, AiValueStatus } from '@ax/ai-core'
import { REQUIRED_PRESENTATION } from '@ax/ai-core'

/**
 * Whether a result of this capability must carry a generated notice.
 *
 * Read from the capability table rather than restated here. A second copy of the list is a
 * copy that falls behind the day a ninth capability is added.
 */
export function needsGeneratedNotice(capability: AiCapability): boolean {
  return REQUIRED_PRESENTATION[capability].includes('generated-notice')
}

/**
 * The notice cannot be switched off.
 *
 * A flag that hides it turns an obligation into a preference, and the first screen under
 * deadline turns the preference off. So this always returns true; it exists to make the
 * absence of an off-switch something a test can assert.
 */
export function noticeIsMandatory(): true {
  return true
}

export interface ProgressView {
  /** Still arriving */
  running: boolean
  /** 0 to 1 when the caller knows, null when it does not */
  ratio: number | null
  text: string
}

/**
 * Work in flight.
 *
 * An unknown amount of remaining work is shown as unknown, not as a bar stuck near the end.
 * A fake bar is a promise the screen cannot keep.
 */
export function progressView(
  status: AiValueStatus,
  done: number | null,
  total: number | null,
  runningText: string,
): ProgressView {
  const running = status === 'streaming'
  if (!running) return { running: false, ratio: 1, text: '' }
  if (done === null || total === null || total <= 0) {
    return { running: true, ratio: null, text: runningText }
  }
  return { running: true, ratio: Math.min(1, Math.max(0, done / total)), text: runningText }
}

/**
 * Whether asking again is worth offering.
 *
 * Asking the same model the same question again gets the same answer. It is worth offering
 * when a person can change something first: the value is not settled, or another model exists.
 */
export function canAskAgain(status: AiValueStatus, otherModelAvailable: boolean): boolean {
  if (status === 'streaming') return false
  return status !== 'confirmed' || otherModelAvailable
}
