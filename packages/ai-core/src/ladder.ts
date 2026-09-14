/**
 * Reading a stored AI value written under an older contract.
 *
 * ## Why a ladder rather than a migration
 *
 * Rewriting every stored row in one pass means the rewrite itself becomes the risk: it runs
 * once, against live data, and a mistake in it is discovered after the old bytes are gone.
 * A ladder instead upgrades a value on the way past, so only rows that are actually read and
 * written again get rewritten, and the rest keep waiting harmlessly.
 *
 * ## Why it climbs one rung at a time
 *
 * Jumping from 2 to 4 means writing a 2-to-4 step that nobody ever exercises with real data.
 * Climbing 2-3-4 reuses steps that already ran against every row that passed through before.
 *
 * ## What happens when it cannot climb
 *
 * The value is not dropped and not guessed at. It comes back marked as an older contract with
 * its original bytes intact, so a screen can still show it in the old shape. Losing a value
 * because its shape is unfamiliar is worse than showing it plainly.
 */

import { AI_CONTRACT_VERSION, versionOf } from './contract.ts'

/** One rung. Takes a value written under `from` and returns it shaped for `from + 1` */
export interface Rung {
  from: number
  up: (value: unknown) => unknown
}

export interface Climbed {
  /** Ready to read under the current contract */
  status: 'current'
  value: unknown
  /** Which contract it was stored under. Equal to the current one when nothing was needed */
  storedVersion: number
  /** Whether any rung actually ran */
  upgraded: boolean
}

export interface Held {
  /**
   * Could not be brought to the current contract.
   *
   * `legacy` is a value stored before versions existed, `gap` is a version with no rung to
   * climb from, and `ahead` was written by a newer deployment than this one.
   */
  status: 'legacy' | 'gap' | 'ahead'
  /** The original, untouched. Writing this back produces the same bytes it came with */
  original: unknown
  storedVersion: number | null
  reason: string
}

export type ClimbResult = Climbed | Held

/** Rungs sorted and checked for duplicates, so the climb is deterministic */
function ordered(rungs: readonly Rung[]): Rung[] {
  const seen = new Set<number>()
  for (const r of rungs) {
    if (seen.has(r.from)) throw new Error(`two rungs climb from version ${r.from}`)
    seen.add(r.from)
  }
  return [...rungs].sort((a, b) => a.from - b.from)
}

export function climb(
  raw: unknown,
  rungs: readonly Rung[] = [],
  target: number = AI_CONTRACT_VERSION,
): ClimbResult {
  const stored = versionOf(raw)
  if (stored === null) {
    return {
      status: 'legacy',
      original: raw,
      storedVersion: null,
      reason: 'stored before contract versions existed',
    }
  }
  if (stored > target) {
    return {
      status: 'ahead',
      original: raw,
      storedVersion: stored,
      reason: `written under contract ${stored}, this build reads up to ${target}`,
    }
  }
  if (stored === target) {
    return { status: 'current', value: raw, storedVersion: stored, upgraded: false }
  }

  const byFrom = new Map(ordered(rungs).map((r) => [r.from, r]))
  let value = raw
  for (let v = stored; v < target; v++) {
    const rung = byFrom.get(v)
    if (!rung) {
      return {
        status: 'gap',
        original: raw,
        storedVersion: stored,
        reason: `no rung climbs from contract ${v}`,
      }
    }
    value = rung.up(value)
  }
  return { status: 'current', value, storedVersion: stored, upgraded: true }
}

/** Whether a result can be read under the current contract */
export function isCurrent(r: ClimbResult): r is Climbed {
  return r.status === 'current'
}
