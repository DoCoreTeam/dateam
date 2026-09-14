/**
 * What to show for one AI value, decided here rather than in the drawing layer.
 *
 * The test runner cannot read .tsx at all, so a rule living inside a component is a rule no
 * test can see, and a rule no test can see is one nobody keeps. Everything that decides
 * *what* appears lives in this file; the .tsx next to it only draws the answer.
 */

import type { AiValueStatus, AiEvidence, AiSource } from '@ax/ai-core'
import type { AiLabels } from './labels.ts'

/** How sure, in a form a screen can render without deciding anything itself */
export type ConfidenceView =
  | { kind: 'unknown'; text: string }
  | { kind: 'known'; percent: number; text: string; low: boolean }

/**
 * Below this, a value is worth double-checking against the source.
 *
 * It is a presentation threshold, not a correctness one. Nothing is hidden or dropped here.
 */
export const LOW_CONFIDENCE_BELOW = 0.7

/**
 * No confidence and zero confidence are different facts.
 *
 * `null` means the model said nothing about how sure it was. Rendering that as 0% tells the
 * reader the model was certain it was wrong, which is a claim nobody made.
 */
export function confidenceView(
  confidence: number | null,
  labels: Pick<AiLabels, 'confidenceUnknown'>,
): ConfidenceView {
  if (confidence === null) return { kind: 'unknown', text: labels.confidenceUnknown }
  const clamped = Math.min(1, Math.max(0, confidence))
  const percent = Math.round(clamped * 100)
  return { kind: 'known', percent, text: `${percent}%`, low: clamped < LOW_CONFIDENCE_BELOW }
}

/** The word for where a value stands, chosen by the caller, picked by us */
export function statusText(
  status: AiValueStatus,
  labels: Pick<AiLabels, 'candidate' | 'confirmed' | 'corrected' | 'inProgress'>,
): string {
  switch (status) {
    case 'streaming': return labels.inProgress
    case 'candidate': return labels.candidate
    case 'confirmed': return labels.confirmed
    case 'corrected': return labels.corrected
  }
}

/**
 * A value that is still arriving must not read as settled.
 *
 * Screens that show a half-arrived value the same way as a confirmed one teach people to
 * trust the half-arrived one.
 */
export function isSettled(status: AiValueStatus): boolean {
  return status === 'confirmed' || status === 'corrected'
}

export interface SourceView {
  text: string
  modelId: string
  at: string
}

/** Who produced it and when, as one line */
export function sourceView(source: AiSource): SourceView {
  return { text: `${source.providerId} / ${source.modelId}`, modelId: source.modelId, at: source.at }
}

export interface EvidenceView {
  /** Nothing was recorded. The screen says so rather than showing an empty area */
  empty: boolean
  text: string
  items: readonly AiEvidence[]
}

/**
 * Evidence the screen can draw.
 *
 * An empty list is stated, not left blank. A blank area reads as "no evidence needed",
 * and that is a different claim from "no evidence was recorded".
 */
export function evidenceView(
  items: readonly AiEvidence[] | null | undefined,
  labels: Pick<AiLabels, 'showEvidence' | 'noEvidence'>,
): EvidenceView {
  const list = items ?? []
  return list.length === 0
    ? { empty: true, text: labels.noEvidence, items: [] }
    : { empty: false, text: labels.showEvidence, items: list }
}

/** Where one piece of evidence points, as a reader can say it out loud */
export function evidenceSpan(e: AiEvidence): string {
  return `${e.blockId} ${e.start}-${e.end}`
}
