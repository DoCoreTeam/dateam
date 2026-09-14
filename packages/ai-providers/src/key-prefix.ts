/**
 * Which vendor a key belongs to.
 *
 * A plain startsWith is not enough. One vendor's `sk-` fully contains another's `sk-ant-`,
 * so a Claude key pasted into the OpenAI field would pass. The question is therefore not
 * "does my prefix match" but "among the prefixes that match, is mine the longest".
 */

export interface PrefixedSpec<Id extends string = string> {
  id: Id
  keyPrefixes: readonly string[]
}

function longestMatchingPrefix(spec: PrefixedSpec, key: string): string | null {
  let best: string | null = null
  for (const p of spec.keyPrefixes) {
    if (key.startsWith(p) && (best === null || p.length > best.length)) best = p
  }
  return best
}

/** Whether this key belongs to this vendor rather than to a vendor with a longer prefix */
export function matchesKeyPrefix<Id extends string>(
  specs: readonly PrefixedSpec<Id>[],
  id: Id,
  key: string,
): boolean {
  const trimmed = key.trim()
  const self = specs.find((s) => s.id === id)
  if (!self) throw new Error(`unregistered provider: ${id}`)
  const mine = longestMatchingPrefix(self, trimmed)
  if (mine === null) return false
  for (const other of specs) {
    if (other.id === id) continue
    const theirs = longestMatchingPrefix(other, trimmed)
    if (theirs !== null && theirs.length > mine.length) return false
  }
  return true
}

/** Which vendor a pasted key belongs to, so a screen can point at the right field */
export function detectProviderByKey<Id extends string>(
  specs: readonly PrefixedSpec<Id>[],
  key: string,
): Id | null {
  for (const spec of specs) {
    if (matchesKeyPrefix(specs, spec.id, key)) return spec.id
  }
  return null
}
