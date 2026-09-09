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

export type PiiKind = 'rrn' | 'phone' | 'email' | 'account' | 'bizno' | 'card'

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
export function maskPii(text: string): MaskResult {
  const hits: PiiHit[] = []
  const byValue = new Map<string, string>()
  let masked = text

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
export function roundTrips(text: string): boolean {
  const m = maskPii(text)
  return unmaskPii(m.text, m.hits) === text
}

/** Anything still unmasked. Called after masking, and nothing is sent when it is true */
export function hasUnmaskedPii(text: string): boolean {
  return KO_KR_RULES.some((r) => new RegExp(r.re.source).test(text))
}

/** Counts per kind, for the audit log. The values themselves are never recorded */
export function countByKind(hits: readonly PiiHit[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const h of hits) out[h.kind] = (out[h.kind] ?? 0) + 1
  return out
}
