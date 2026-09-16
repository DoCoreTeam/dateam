/**
 * Masking personal data before it leaves.
 *
 * Why it has to be reversible: deleting outright puts "[removed]" in the report. The user
 * must still see that information on screen while it must never reach an outside model.
 * So it becomes a placeholder on the way out and is restored on the way back.
 *
 * Why the placeholder looks like this: a model must not rewrite it. Anything that looks
 * like natural language gets translated or quietly reworded during summarisation.
 * Uncommon brackets such as the ones used here come back untouched.
 *
 * The rules below are a locale pack, not a company fact, which is why they live here.
 */

export type PiiKind = 'rrn' | 'phone' | 'email' | 'account' | 'bizno' | 'card' | 'name'

export interface PiiHit {
  kind: PiiKind
  /** The original value. This table never leaves the process */
  value: string
  token: string
}

export interface MaskResult {
  text: string
  hits: PiiHit[]
}

/**
 * Names we already know.
 *
 * A name is personal data, and the rules above never catch one. The tempting fix is a
 * pattern that guesses at names, but a guess that is wrong either leaks a name it missed or
 * destroys a sentence it wrongly replaced, and both failures are invisible until someone reads
 * the output.
 *
 * There is no need to guess. The names are already ours: people in the address book, meeting
 * attendees, account holders. Matching a list we own is exact, so there are no false positives
 * and nothing outside the list is touched.
 *
 * Names shorter than this are skipped. Two Korean syllables collide with ordinary words often
 * enough that masking them damages the text more than it protects anyone.
 */
export const MIN_MASKABLE_NAME = 3

export interface MaskOptions {
  /** Names the caller already knows. Nothing outside this list is treated as a name */
  knownNames?: readonly string[]
}

/** Escapes a literal so it can be matched exactly rather than read as a pattern */
function literal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Names worth masking, longest first.
 *
 * Longest first matters: when one known name is a prefix of another, matching the short one
 * first leaves the remaining syllables dangling and the round trip no longer restores the
 * original text.
 */
function maskableNames(names: readonly string[] | undefined): string[] {
  if (!names || names.length === 0) return []
  const seen = new Set<string>()
  for (const raw of names) {
    const n = raw.trim()
    if (n.length >= MIN_MASKABLE_NAME) seen.add(n)
  }
  // Array.from rather than spreading: the consuming app sets no tsconfig target, so it falls
  // back to ES5 where spreading an iterable is rejected (TS2802). Hit four times now
  return Array.from(seen).sort((a, b) => b.length - a.length)
}

interface Rule {
  kind: PiiKind
  re: RegExp
}

/**
 * First match from the top wins.
 *
 * The resident number comes before the phone number because the leading digits of a
 * resident number can satisfy the phone rule. A broad rule placed first swallows a narrow one.
 */
const KO_KR_RULES: readonly Rule[] = [
  { kind: 'rrn', re: /\b\d{6}\s?-\s?[1-4]\d{6}\b/g },
  { kind: 'card', re: /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g },
  { kind: 'bizno', re: /\b\d{3}-\d{2}-\d{5}\b/g },
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'phone', re: /\b0\d{1,2}\s?-\s?\d{3,4}\s?-\s?\d{4}\b/g },
  { kind: 'account', re: /\b\d{2,3}-\d{2,6}-\d{2,6}\b/g },
]

/** The placeholder shape, uncommon enough that a model leaves it alone */
export function tokenFor(index: number): string {
  return `⟦PII_${index}⟧`
}

const TOKEN_RE = /⟦PII_(\d+)⟧/g

/**
 * Replaces personal data with placeholders before sending.
 *
 * The same value always gets the same placeholder. Handing out different ones makes the
 * model read one person as two.
 */
export function maskPii(text: string, options: MaskOptions = {}): MaskResult {
  const hits: PiiHit[] = []
  const byValue = new Map<string, string>()
  let masked = text

  // Known names first. They are exact matches, so doing them before the patterns keeps a name
  // that happens to sit inside another match from being split across two placeholders
  for (const name of maskableNames(options.knownNames)) {
    masked = masked.replace(new RegExp(literal(name), 'g'), (m) => {
      const seen = byValue.get(m)
      if (seen) return seen
      const token = tokenFor(hits.length + 1)
      byValue.set(m, token)
      hits.push({ kind: 'name', value: m, token })
      return token
    })
  }

  for (const rule of KO_KR_RULES) {
    masked = masked.replace(new RegExp(rule.re.source, 'g'), (m) => {
      const seen = byValue.get(m)
      if (seen) return seen
      const token = tokenFor(hits.length + 1)
      byValue.set(m, token)
      hits.push({ kind: rule.kind, value: m, token })
      return token
    })
  }

  return { text: masked, hits }
}

/**
 * Puts the original values back into the answer.
 *
 * Unknown placeholders are left alone. Removing them would make a placeholder the model
 * invented disappear silently, leaving a sentence that reads naturally but says something
 * the source never said.
 */
export function unmaskPii(text: string, hits: readonly PiiHit[]): string {
  if (hits.length === 0) return text
  const byToken = new Map(hits.map((h) => [h.token, h.value]))
  return text.replace(TOKEN_RE, (m) => byToken.get(m) ?? m)
}

/** Whether the round trip loses nothing. Checked before storing */
export function roundTrips(text: string, options: MaskOptions = {}): boolean {
  const m = maskPii(text, options)
  return unmaskPii(m.text, m.hits) === text
}

/** Anything still unmasked. Called after masking, and nothing is sent when it is true */
export function hasUnmaskedPii(text: string, options: MaskOptions = {}): boolean {
  if (KO_KR_RULES.some((r) => new RegExp(r.re.source).test(text))) return true
  return maskableNames(options.knownNames).some((n) => text.includes(n))
}

/** Counts per kind, for the audit log. The values themselves are never recorded */
export function countByKind(hits: readonly PiiHit[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const h of hits) out[h.kind] = (out[h.kind] ?? 0) + 1
  return out
}
