/**
 * The one shape every AI result has.
 *
 * Today there are 131 different result types across this codebase, so nothing can be
 * rendered by a shared component and nothing can be checked by a shared rule. One shape
 * is what makes both possible.
 */

import type { AiCapability } from './capability.ts'

/**
 * The shape number a result was written under.
 *
 * Stamped when the value is produced, never when it is read. A stored value without one
 * can never be upgraded, because nothing records which rules it was written under.
 */
export const AI_CONTRACT_VERSION = 1 as const
export type AiContractVersion = typeof AI_CONTRACT_VERSION

/** Where in the source a value came from. Block number plus character span */
export interface AiEvidence {
  blockId: string
  /** Character offset into that block, inclusive */
  start: number
  /** Character offset into that block, exclusive */
  end: number
  /** The quoted span, kept so a screen can show it without refetching the source */
  quote?: string
}

/** Who produced it and when. Cost and latency belong to the call log, not to the value */
export interface AiSource {
  providerId: string
  modelId: string
  /** ISO 8601, always UTC. Screens convert on display */
  at: string
}

/**
 * How settled the value is.
 *
 * `streaming` is here in the first version on purpose. A contract written for finished
 * values only forces every streaming screen to invent a second shape, and then the
 * components are rebuilt rather than shared.
 */
export type AiValueStatus = 'streaming' | 'candidate' | 'confirmed' | 'corrected'

/** Allowed moves. Anything absent is rejected, including moves backwards */
const TRANSITIONS: Record<AiValueStatus, readonly AiValueStatus[]> = {
  streaming: ['streaming', 'candidate'],
  candidate: ['confirmed', 'corrected'],
  confirmed: ['corrected'],
  corrected: ['corrected'],
}

export function canTransition(from: AiValueStatus, to: AiValueStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** A person changed the value. Kept in full, because "who said what" is the audit */
export interface AiCorrection {
  /** ISO 8601, UTC */
  at: string
  /** Opaque actor id. This package never learns what an actor is */
  by: string
  /** Serialized previous value, so a wrong correction can be walked back */
  from: string
  to: string
  note?: string
}

/** The seven parts. Every capability answers in this shape */
export interface AiValue<T = unknown> {
  contractVersion: number
  capability: AiCapability
  value: T
  evidence: readonly AiEvidence[]
  /** 0 to 1. Absent means the model gave none, which is not the same as zero */
  confidence: number | null
  source: AiSource
  status: AiValueStatus
  corrections: readonly AiCorrection[]
}

export interface NewAiValueInput<T> {
  capability: AiCapability
  value: T
  source: AiSource
  status: AiValueStatus
  evidence?: readonly AiEvidence[]
  confidence?: number | null
}

/** Stamps the current contract version. This is the only place a version is assigned */
export function newAiValue<T>(input: NewAiValueInput<T>): AiValue<T> {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    capability: input.capability,
    value: input.value,
    evidence: input.evidence ?? [],
    confidence: input.confidence ?? null,
    source: input.source,
    status: input.status,
    corrections: [],
  }
}

/**
 * The version a stored record was written under, or null when it carries none.
 *
 * Never guesses. Filling a missing version with 1 would quietly relabel records written
 * before versioning existed, and the upgrade ladder would then run the wrong rungs on them.
 */
export function versionOf(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = (raw as { contractVersion?: unknown }).contractVersion
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

/**
 * Re-asserts the shape at a boundary.
 *
 * Types are erased when a value crosses from server to screen. Without a runtime check
 * the screen believes whatever it was handed, and the contract stops meaning anything
 * exactly where it matters most.
 */
export function isAiValue(x: unknown): x is AiValue {
  if (typeof x !== 'object' || x === null) return false
  const v = x as Record<string, unknown>
  if (versionOf(v) === null) return false
  if (typeof v.capability !== 'string') return false
  if (!Array.isArray(v.evidence)) return false
  if (!Array.isArray(v.corrections)) return false
  if (v.confidence !== null && typeof v.confidence !== 'number') return false
  if (typeof v.status !== 'string') return false
  const s = v.source
  if (typeof s !== 'object' || s === null) return false
  const src = s as Record<string, unknown>
  return typeof src.providerId === 'string' && typeof src.modelId === 'string' && typeof src.at === 'string'
}

/** Records a correction and moves the status. Throws when the move is not allowed */
export function applyCorrection<T>(value: AiValue<T>, next: T, by: string, at: string, note?: string): AiValue<T> {
  if (!canTransition(value.status, 'corrected')) {
    throw new Error(`cannot correct a value in status "${value.status}"`)
  }
  return {
    ...value,
    value: next,
    status: 'corrected',
    corrections: [
      ...value.corrections,
      { at, by, from: JSON.stringify(value.value), to: JSON.stringify(next), note },
    ],
  }
}
