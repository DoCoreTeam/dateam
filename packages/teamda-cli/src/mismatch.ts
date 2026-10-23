/**
 * Read-back check after a write: did the server store what was sent?
 *
 * Rules, chosen so a server that normalizes values is not reported (a false alarm is worse
 * than a missed one):
 * - only top-level keys present in the sent body AND in the saved record are compared;
 *   a key the server does not echo is skipped, not a mismatch
 * - control keys are never compared (SKIPPED_KEYS): dry-run switch, version preconditions
 *   (the server bumps the version, so the sent number never equals the stored one), action
 *   args, and timestamps the server owns
 * - strings are trimmed; null, undefined and "" are the same empty value
 * - a numeric string equals the number ("100" and 100); "true"/"false" equal the booleans
 * - dates: two datetimes compare as instants; a date-only value equals a datetime that writes
 *   the same day, falls on that UTC day, or lies within a time zone offset of that midnight
 *   ("2026-10-23" and "2026-10-23T00:00:00.000Z" and "2026-10-22T15:00:00Z" are equal)
 * - arrays compare element by element, objects key by key, with the same rules
 */

export interface Mismatch {
  field: string
  sent: unknown
  saved: unknown
}

export const SKIPPED_KEYS: ReadonlySet<string> = new Set([
  'dryRun', 'dry_run',
  'expectVersion', 'expectedVersion', 'expect_version', 'expected_version', 'version',
  'args',
  'createdAt', 'created_at', 'updatedAt', 'updated_at',
])

/** Largest time zone offset, so a date-only value matches its midnight anywhere. */
const MAX_TZ_OFFSET_MS = 14 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/
const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Scalars to a comparable form; objects and arrays are returned as they are. */
function scalar(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (t === '') return null
  if (NUMERIC.test(t)) return Number(t)
  if (t === 'true') return true
  if (t === 'false') return false
  return t
}

function dateOnlyMatches(day: string, dateTime: string): boolean {
  const written = DATE_TIME.exec(dateTime)
  if (!written) return false
  if (written[1] === day) return true
  const at = Date.parse(dateTime)
  const midnight = Date.parse(`${day}T00:00:00Z`)
  if (!Number.isFinite(at) || !Number.isFinite(midnight)) return false
  return at >= midnight - MAX_TZ_OFFSET_MS && at < midnight + DAY_MS + MAX_TZ_OFFSET_MS
}

function datesEqual(a: string, b: string): boolean | null {
  const aDay = DATE_ONLY.test(a)
  const bDay = DATE_ONLY.test(b)
  const aTime = DATE_TIME.test(a)
  const bTime = DATE_TIME.test(b)
  if (aDay && bTime) return dateOnlyMatches(a, b)
  if (bDay && aTime) return dateOnlyMatches(b, a)
  if (aTime && bTime) {
    const x = Date.parse(a)
    const y = Date.parse(b)
    if (Number.isFinite(x) && Number.isFinite(y)) return x === y
  }
  return null
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) return false
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) => sameValue(a[k], b[k]))
  }
  const x = scalar(a)
  const y = scalar(b)
  if (x === y) return true
  if (typeof x === 'string' && typeof y === 'string') return datesEqual(x, y) === true
  return false
}

/** Fields whose saved value differs from the sent one. Empty when nothing can be compared. */
export function compareSaved(sent: object, saved: unknown): Mismatch[] {
  if (!isObj(sent) || !isObj(saved)) return []
  const out: Mismatch[] = []
  for (const [field, value] of Object.entries(sent)) {
    if (SKIPPED_KEYS.has(field) || !Object.hasOwn(saved, field)) continue
    if (!sameValue(value, saved[field])) out.push({ field, sent: value, saved: saved[field] })
  }
  return out
}

/**
 * The stored record inside a success envelope, or null when it cannot be identified.
 * `{ success, data: record }` is the usual shape; `{ data: { item: record } }` style wrappers
 * (one key holding one object) are unwrapped only when the outer object shares no sent key.
 */
export function savedRecord(body: unknown, sent: object): Json | null {
  if (!isObj(body)) return null
  const data = Object.hasOwn(body, 'data') ? body.data : body
  if (!isObj(data)) return null
  const sentKeys = Object.keys(sent)
  if (sentKeys.some((k) => Object.hasOwn(data, k))) return data
  const keys = Object.keys(data)
  if (keys.length === 1 && isObj(data[keys[0]])) return data[keys[0]] as Json
  return null
}
