/**
 * Digging JSON out of a model's answer. Pure functions, no dependencies.
 *
 * Why this exists: the earlier parser stripped a markdown fence and called JSON.parse.
 * One line of explanation before or after the JSON and the whole call failed, and the
 * user was told only that it failed and to try again. Retrying failed the same way.
 *
 * So the premise is that a model may ignore instructions, and anything that *contains*
 * valid JSON is recoverable.
 *
 * Lossless rule: only actually-valid JSON counts as success. Nothing is repaired by
 * guessing, such as auto-closing quotes. Passing wrong data off as right is worse than
 * failing.
 *
 * The message here is deliberately English. Callers own the wording their users see.
 */

export class JsonRecoverError extends Error {
  /** The head of the answer, for diagnosis in logs. Truncated */
  readonly sample: string
  constructor(sample: string) {
    super('no JSON found in the model answer')
    this.name = 'JsonRecoverError'
    this.sample = sample
  }
}

/** Strips a markdown fence. Returns the input unchanged when there is none */
function stripFence(text: string): string {
  return text
    .replace(/^\s*```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/**
 * Index of the bracket closing the one at `start`, aware of string literals and escapes.
 * Returns -1 when there is no match.
 */
function findBalancedEnd(text: string, start: number): number {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Recovers and parses a JSON object or array embedded anywhere in the text.
 * Throws JsonRecoverError, carrying a sample so the caller can explain the cause.
 */
export function recoverJson(text: string): unknown {
  const raw = (text ?? '').trim()
  if (!raw) throw new JsonRecoverError('')

  // 1) The common case: strip the fence and it parses
  const stripped = stripFence(raw)
  try {
    return JSON.parse(stripped)
  } catch {
    /* fall through to the scan below */
  }

  // 2) Buried in prose: balanced scan from every opening bracket, first success wins.
  //    This covers the pattern where a model reasons out loud and appends JSON at the end.
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch !== '{' && ch !== '[') continue
    const end = findBalancedEnd(stripped, i)
    if (end === -1) continue
    const candidate = stripped.slice(i, end + 1)
    try {
      return JSON.parse(candidate)
    } catch {
      /* try the next candidate */
    }
  }

  throw new JsonRecoverError(raw.slice(0, 200))
}

/** Narrows a parse result to an object. Arrays and primitives become an empty object */
export function asJsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
