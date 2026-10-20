/**
 * 받아들인 AI 읽기는 품목의 별칭으로 남는다 (서비스)
 *
 * AI 가 「에이치백」을 H100 서버로 읽었고 사람이 그대로 저장하면, 「에이치백」이 그 품목의 별칭이 된다.
 * 다음부터는 규칙이 읽는다(`read-rules.ts` 가 별칭으로 품목을 맞춘다). 쓸수록 AI 를 덜 부른다.
 *
 * 품목 이름과 같은 말, 이미 있는 별칭은 안 더한다. 별칭은 품목마다 상한이 있다 —
 * 끝없이 쌓이면 엉뚱한 낱말이 엉뚱한 품목을 부르기 시작한다.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

export const MAX_ALIASES_PER_ITEM = 20
export const MAX_ALIAS_LENGTH = 40
const MAX_CANDIDATES = 30
const MIN_ALIAS_LENGTH = 2

export interface AliasCandidateInput {
  itemId: string
  word: string
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/** 받은 값을 거른다 — 모양이 틀리면 버린다(저장 전체를 막지 않는다) */
export function cleanCandidates(raw: unknown): AliasCandidateInput[] {
  if (!Array.isArray(raw)) return []
  const out: AliasCandidateInput[] = []
  for (const x of raw.slice(0, MAX_CANDIDATES)) {
    if (!x || typeof x !== 'object') continue
    const itemId = String((x as Record<string, unknown>).itemId ?? '').slice(0, 60)
    const word = String((x as Record<string, unknown>).word ?? '').trim().replace(/\s+/g, ' ')
    if (!itemId || word.length < MIN_ALIAS_LENGTH || word.length > MAX_ALIAS_LENGTH) continue
    out.push({ itemId, word })
  }
  return out
}

/** 품목 하나에 더할 별칭 — 순수 함수 */
export function nextAliases(name: string, current: readonly string[], words: readonly string[]): string[] | null {
  const seen = new Set([norm(name), ...current.map(norm)])
  const add: string[] = []
  for (const w of words) {
    const k = norm(w)
    if (seen.has(k)) continue
    seen.add(k)
    add.push(w)
  }
  if (add.length === 0) return null
  return [...current, ...add].slice(0, MAX_ALIASES_PER_ITEM)
}

/** 견적 저장과 같은 트랜잭션 안에서 부른다. 같은 워크스페이스 품목만 보인다(tx 가 범위를 진다) */
export async function learnAliases(tx: Tx, raw: unknown): Promise<number> {
  const candidates = cleanCandidates(raw)
  if (candidates.length === 0) return 0
  const ids = [...new Set(candidates.map((c) => c.itemId))]
  const items: { id: string; name: string; aliases: string[] | null }[] = await tx.crmProduct.findMany({
    where: { id: { in: ids } }, select: { id: true, name: true, aliases: true },
  })
  let learned = 0
  for (const item of items) {
    const words = candidates.filter((c) => c.itemId === item.id).map((c) => c.word)
    const had = item.aliases ?? []
    const next = nextAliases(item.name, had, words)
    if (!next) continue
    await tx.crmProduct.update({ where: { id: item.id }, data: { aliases: next } })
    learned += next.length - had.length
  }
  return learned
}
