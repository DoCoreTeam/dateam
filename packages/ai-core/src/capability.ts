/**
 * The eight things a model is asked to do.
 *
 * These are capabilities, not features. A feature is rebuilt for every service that
 * wants it, which is why nothing ever became shared. A capability is defined once,
 * and whatever uses it inherits the same guarantees.
 *
 * Adding a ninth means the components and the catalog grow with it. If they do not,
 * the layer splits again, which is what this list exists to prevent.
 */
export const AI_CAPABILITIES = [
  /** Pull stated facts out of a document. Answers "what does it say" */
  'extract',
  /** Shorten without adding. Answers "what is the gist" */
  'summarize',
  /** Decide against a rule or another document. Answers "does this hold" */
  'judge',
  /** Offer an option a person accepts or rejects. Answers "what could we do" */
  'suggest',
  /** Produce new prose or structure. Answers "write this for me" */
  'generate',
  /** Reply from named sources. Answers "what is the answer, and from where" */
  'answer',
  /** Turn speech into text. Answers "what was said" */
  'transcribe',
  /** Rank by meaning rather than by words. Answers "what is close to this" */
  'search',
] as const

export type AiCapability = (typeof AI_CAPABILITIES)[number]

/**
 * What a capability's result must be shown with.
 *
 * Pairing lives here, next to the capability list, so a new capability cannot be added
 * without stating how its result is allowed to reach a screen. The static guard reads
 * this table; it is not documentation that drifts from the code.
 */
export const REQUIRED_PRESENTATION: Record<AiCapability, readonly string[]> = {
  extract: ['candidate-list'],
  summarize: ['generated-notice'],
  judge: ['evidence'],
  suggest: ['candidate-list'],
  generate: ['preview', 'generated-notice'],
  answer: ['source'],
  transcribe: ['generated-notice'],
  search: ['source'],
} as const

export function isAiCapability(x: unknown): x is AiCapability {
  return typeof x === 'string' && (AI_CAPABILITIES as readonly string[]).includes(x)
}
