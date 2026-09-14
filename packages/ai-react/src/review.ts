/**
 * The rules for letting a person settle an AI value.
 *
 * Three shapes, one idea: a machine proposes, a person decides, and what the machine said
 * before the person decided does not disappear.
 */

import { canTransition, type AiValue, type AiValueStatus, type AiCorrection } from '@ax/ai-core'

export interface Candidate<T = unknown> {
  id: string
  value: T
  confidence: number | null
  /** Already picked by a person */
  chosen: boolean
}

/**
 * Whether a set of candidates may be treated as settled.
 *
 * Extraction results must not go straight to confirmed. Something extracted is a reading of
 * a document, and a reading nobody checked is a guess wearing a value's clothes.
 */
export function canConfirmCandidates(candidates: readonly Candidate[]): boolean {
  return candidates.some((c) => c.chosen)
}

/** Why confirming is blocked, so a screen can say it rather than just disabling a button */
export function confirmBlockedReason(candidates: readonly Candidate[]): 'none_chosen' | null {
  return canConfirmCandidates(candidates) ? null : 'none_chosen'
}

export type DiffSide = 'current' | 'suggested'

export interface DiffRow<T = unknown> {
  field: string
  current: T
  suggested: T
  /** The two agree, so there is nothing for a person to decide */
  same: boolean
}

/**
 * A suggestion laid beside what is there now.
 *
 * Showing only the suggestion asks a person to approve a change without seeing what it
 * replaces. Rows that agree are kept and marked rather than dropped, because "unchanged"
 * is information too.
 */
export function diffRows<T>(
  current: Record<string, T>,
  suggested: Record<string, T>,
): DiffRow<T>[] {
  // Array.from rather than spreading the Set: the consuming app sets no tsconfig target, so
  // it falls back to ES5 and spreading an iterable is rejected there (TS2802, hit once before)
  const fields = Array.from(new Set(Object.keys(current).concat(Object.keys(suggested)))).sort()
  return fields.map((field) => {
    const a = current[field]
    const b = suggested[field]
    return { field, current: a, suggested: b, same: JSON.stringify(a) === JSON.stringify(b) }
  })
}

/** Only the rows a person actually has to decide about */
export function decidableRows<T>(rows: readonly DiffRow<T>[]): DiffRow<T>[] {
  return rows.filter((r) => !r.same)
}

export interface TrailEntry {
  at: string
  by: string
  from: string
  to: string
  note?: string
}

/**
 * What a person changed, newest first.
 *
 * The previous value is kept as text rather than replaced. A correction with no record of
 * what it replaced cannot be walked back, and the first wrong correction is the one that
 * proves it.
 */
export function correctionTrail(corrections: readonly AiCorrection[]): TrailEntry[] {
  return [...corrections]
    .map((c) => ({ at: c.at, by: c.by, from: c.from, to: c.to, note: c.note }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/** Whether this value has been touched by a person at all */
export function wasCorrected(value: Pick<AiValue, 'corrections' | 'status'>): boolean {
  return value.corrections.length > 0 || value.status === 'corrected'
}

/**
 * Whether a screen may offer settling this value.
 *
 * It reuses the contract's own state machine rather than restating it. Two copies of the
 * same rule drift, and the copy on screen is the one people believe.
 */
export function canOfferSettle(from: AiValueStatus, to: AiValueStatus): boolean {
  return canTransition(from, to)
}
