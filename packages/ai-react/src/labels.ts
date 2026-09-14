/**
 * Every word these components put on screen comes from the caller.
 *
 * A component that ships its own wording decides the wording of every screen that uses it,
 * and the first screen that needs different words forks the component instead. That fork is
 * how twenty-eight separate ways of drawing the same value happened here in the first place.
 *
 * There is no default. Filling a missing label with English text would ship English into a
 * Korean product quietly, and the first person to notice would be a user.
 */

export interface AiLabels {
  /** What to call a value the model produced */
  generated: string
  /** Opening the source a value came from */
  showEvidence: string
  /** No source was recorded */
  noEvidence: string
  /** How sure the model was */
  confidence: string
  /** The model said nothing about how sure it was */
  confidenceUnknown: string
  /** Not settled yet, a person still has to choose */
  candidate: string
  /** A person accepted it */
  confirmed: string
  /** A person changed it */
  corrected: string
  /** Take the suggestion */
  accept: string
  /** Leave the current value alone */
  reject: string
  /** Ask the model again */
  askAgain: string
  /** Still arriving */
  inProgress: string
  /** Written under an older contract */
  olderContract: string
}

/** Every key, so a caller can be checked for completeness at runtime as well as in types */
export const AI_LABEL_KEYS: readonly (keyof AiLabels)[] = [
  'generated', 'showEvidence', 'noEvidence', 'confidence', 'confidenceUnknown',
  'candidate', 'confirmed', 'corrected', 'accept', 'reject', 'askAgain',
  'inProgress', 'olderContract',
]

/** Which labels are missing. Empty means the caller supplied all of them */
export function missingLabels(labels: Partial<AiLabels> | null | undefined): string[] {
  if (!labels) return [...AI_LABEL_KEYS]
  return AI_LABEL_KEYS.filter((k) => typeof labels[k] !== 'string' || labels[k] === '')
}
