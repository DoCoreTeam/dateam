/**
 * 근거 대조 (설계서 3.6.4)
 *
 * ## 모델이 인용을 지어낸다
 *
 * 「원문에 이렇게 쓰여 있다」며 붙여 온 문장이 **원문에 없는** 일이 실제로 일어난다.
 * 문장은 그럴듯하고 숫자도 그럴듯해서 사람 눈으로는 안 걸린다.
 * 그래서 인용을 원문 블록과 **글자 단위로 대조**한다.
 *
 * ## 못 찾으면 지우지 않고 강등한다
 *
 * 지우면 화면이 「해당 내용 없음」이 되고, 사용자는 원문에 정말 없는 줄 안다.
 * 값은 남기되 **신뢰도를 떨어뜨리고 미확인 배지를 붙인다** — 사람이 보고 판단할 자리다.
 */

import { normalizeForHash } from '../ir/build.ts'
import type { Evidence, ValueNode } from './schema.ts'

/** 이 유사도 아래면 원문에서 못 찾은 것으로 본다 */
export const GROUNDING_SIMILARITY = 0.9
/** 못 찾은 값의 신뢰도 상한 */
export const UNGROUNDED_CONFIDENCE_CAP = 0.5

/**
 * 두 글의 닮은 정도 0~1.
 *
 * 편집 거리를 쓰지 않는 이유: 인용은 대개 **원문 그대로 복사**되고, 틀릴 때는
 * 통째로 다르다. 그래서 «원문에 들어 있나» 를 먼저 보고, 아니면 조각 겹침을 센다.
 * 편집 거리는 긴 문장에서 느리고, 이 판단에는 그만한 정밀도가 필요 없다.
 */
export function similarity(quote: string, source: string): number {
  const q = flatten(quote)
  const s = flatten(source)
  if (!q) return 0
  if (s.includes(q)) return 1

  // 3글자 조각이 원문에 얼마나 들어 있나
  const grams = shingles(q, 3)
  if (grams.length === 0) return 0
  let hit = 0
  for (const g of grams) if (s.includes(g)) hit++
  return hit / grams.length
}

/**
 * 대조용 정규화 — 줄바꿈까지 공백으로 접는다.
 *
 * 블록 식별용 `normalizeForHash` 와 다른 이유: 인용은 **줄바꿈을 넘나들며 복사**된다.
 * PDF 는 한 문장이 두 줄에 걸쳐 있는 것이 보통이라, 줄바꿈을 남겨 두면
 * 멀쩡한 인용이 「원문에 없음」으로 잡힌다.
 */
function flatten(text: string): string {
  return normalizeForHash(text).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function shingles(text: string, n: number): string[] {
  if (text.length < n) return [text]
  const out: string[] = []
  for (let i = 0; i + n <= text.length; i++) out.push(text.slice(i, i + n))
  return out
}

export interface BlockText {
  blockId: string
  text: string
}

export interface EvidenceCheck {
  evidence: Evidence
  /** 가리킨 블록이 실제로 있나 */
  blockFound: boolean
  similarity: number
  ok: boolean
}

/**
 * 근거 하나를 대조한다.
 *
 * 블록 ID 가 틀렸어도 **다른 블록에서 찾아본다** — 모델이 인용은 맞게 가져오고
 * ID 만 헷갈리는 일이 흔하다. 찾으면 ID 를 고쳐 준다.
 */
export function checkEvidence(evidence: Evidence, blocks: readonly BlockText[]): EvidenceCheck {
  const byId = new Map(blocks.map((b) => [b.blockId, b.text]))
  const declared = byId.get(evidence.blockId)

  if (declared !== undefined) {
    const sim = similarity(evidence.quote, declared)
    if (sim >= GROUNDING_SIMILARITY) {
      return { evidence, blockFound: true, similarity: sim, ok: true }
    }
  }

  // 가리킨 블록에 없으면 다른 블록을 훑는다
  let best = { blockId: evidence.blockId, sim: declared === undefined ? 0 : similarity(evidence.quote, declared) }
  for (const b of blocks) {
    if (b.blockId === evidence.blockId) continue
    const sim = similarity(evidence.quote, b.text)
    if (sim > best.sim) best = { blockId: b.blockId, sim }
  }

  return {
    // 찾았으면 ID 를 고쳐 준다. 안 고치면 화면에서 근거를 눌러도 엉뚱한 데로 간다
    evidence: best.sim >= GROUNDING_SIMILARITY ? { ...evidence, blockId: best.blockId } : evidence,
    blockFound: declared !== undefined,
    similarity: best.sim,
    ok: best.sim >= GROUNDING_SIMILARITY,
  }
}

export interface GroundingResult<T> {
  node: ValueNode<T>
  checks: EvidenceCheck[]
  /** 강등됐나 — 화면이 「미확인」 배지를 그리는 근거 */
  demoted: boolean
}

/**
 * 값 노드의 근거를 전부 대조하고 필요하면 강등한다.
 *
 * 근거가 하나라도 확인되면 확인으로 본다 — 여러 근거 중 하나만 어긋난 것은
 * 모델이 근거를 더 붙이려다 헛디딘 것이지 값이 틀렸다는 뜻이 아니다.
 */
export function groundValue<T>(node: ValueNode<T>, blocks: readonly BlockText[]): GroundingResult<T> {
  if (node.value === null) {
    return { node: { ...node, grounding: 'unconfirmed' }, checks: [], demoted: false }
  }

  const checks = node.evidence.map((e) => checkEvidence(e, blocks))
  const anyOk = checks.some((c) => c.ok)

  if (anyOk) {
    return {
      node: {
        ...node,
        grounding: 'confirmed',
        // 확인된 근거만 남긴다. 어긋난 것을 남기면 화면에서 눌렀을 때 아무 데도 안 간다
        evidence: checks.filter((c) => c.ok).map((c) => c.evidence),
      },
      checks,
      demoted: false,
    }
  }

  return {
    node: {
      ...node,
      grounding: 'unconfirmed',
      // 지우지 않는다 — 지우면 화면이 「원문에 없음」이 되고 사용자가 그걸 믿는다
      confidence: node.confidence === null
        ? UNGROUNDED_CONFIDENCE_CAP
        : Math.min(node.confidence, UNGROUNDED_CONFIDENCE_CAP),
    },
    checks,
    demoted: true,
  }
}

/** 리포트 전체의 근거 확인 비율 — 낮으면 화면이 「근거 확인 낮음」을 띄운다 */
export function groundingRate(nodes: readonly ValueNode<unknown>[]): number {
  const filled = nodes.filter((n) => n.value !== null)
  if (filled.length === 0) return 0
  return filled.filter((n) => n.grounding === 'confirmed').length / filled.length
}
