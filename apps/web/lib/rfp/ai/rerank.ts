/**
 * 리랭커와 임베딩 — 상용과 자체를 바꿔 끼운다 (설계서 3.6.3)
 *
 * ## 왜 인터페이스를 따로 두나
 *
 * 검색 품질을 올리는 조각(리랭커·임베딩)은 **모델보다 자주 바뀐다.**
 * 상용 API 로 시작해 사내 서버로 옮기거나, 등급 때문에 문서마다 다른 길을 타야 한다.
 * 호출부가 벤더 이름을 알면 그 전환이 코드 수정이 된다.
 *
 * ## 실패를 삼키지 않는 이유
 *
 * 리랭커가 죽으면 **원래 순서를 그대로 쓰면 된다** — 검색은 여전히 된다.
 * 그런데 조용히 원래 순서를 쓰면 「리랭커를 켰는데 왜 순서가 그대로냐」를 아무도 못 푼다.
 * 그래서 폴백은 하되 **폴백했다는 사실을 결과에 남긴다.**
 */

import type { DocClass } from '../domain/doc-class.ts'
import { decideTransfer } from '../domain/doc-class.ts'
import type { VendorRetention } from '../domain/doc-class.ts'

export type ProviderKind = 'commercial' | 'self_hosted'

/** 리랭커·임베딩 공통 등록 정보 */
export interface AiProvider {
  id: string
  kind: ProviderKind
  displayName: string
  /** OpenAI 호환·자체 프로토콜 주소 */
  baseUrl: string | null
  modelName: string
  allowedDocClasses: DocClass[]
  retention: VendorRetention
  enabled: boolean
  sortOrder: number
}

/** 사내 제공자는 등급 셋 다를 기본으로 갖는다 */
export function internalProvider(over: Partial<AiProvider> & { id: string; modelName: string }): AiProvider {
  return {
    kind: 'self_hosted',
    displayName: over.displayName ?? `사내 ${over.modelName}`,
    baseUrl: over.baseUrl ?? null,
    allowedDocClasses: over.allowedDocClasses ?? ['public', 'restricted', 'nda'],
    retention: over.retention ?? { noTraining: true, retentionDays: 0, zeroRetention: true },
    enabled: over.enabled ?? true,
    sortOrder: over.sortOrder ?? 1,
    ...over,
  }
}

/**
 * 이 등급으로 쓸 수 있는 제공자를 고른다.
 *
 * 모델과 **같은 관문**을 쓴다 — 리랭커에도 문서 본문이 통째로 들어간다.
 * 모델만 막고 리랭커를 열어 두면 그 길로 원문이 나간다.
 */
export function pickProvider(
  providers: readonly AiProvider[],
  docClass: DocClass,
  adminApproved = false,
): AiProvider | null {
  for (const p of Array.from(providers).sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!p.enabled) continue
    if (p.kind === 'self_hosted' && !p.baseUrl) continue   // 등록 전에는 후보가 아니다
    const d = decideTransfer({
      docClass,
      allowedDocClasses: p.allowedDocClasses,
      retention: p.retention,
      adminApproved,
      internal: p.kind === 'self_hosted',
    })
    if (d.allowed) return p
  }
  return null
}

// 리랭커

export interface RerankCandidate {
  key: string
  text: string
}

export interface RerankedItem {
  key: string
  score: number
}

export type RerankFn = (query: string, candidates: readonly RerankCandidate[]) => Promise<RerankedItem[]>

export interface RerankResult {
  order: string[]
  /** 리랭커를 실제로 썼나. false 면 원래 순서 그대로다 */
  reranked: boolean
  /** 폴백했으면 그 사유 — 안 남기면 「왜 순서가 그대로냐」를 못 푼다 */
  fallbackReason: string | null
  providerId: string | null
}

/**
 * 후보 순서를 다시 매긴다.
 *
 * 제공자가 없거나 죽으면 원래 순서를 쓰되 **그 사실을 남긴다.**
 */
export async function rerank(
  query: string,
  candidates: readonly RerankCandidate[],
  provider: AiProvider | null,
  fn: RerankFn | null,
): Promise<RerankResult> {
  const original = candidates.map((c) => c.key)
  if (!provider || !fn) {
    return { order: original, reranked: false, fallbackReason: 'no_provider', providerId: null }
  }
  if (candidates.length === 0) {
    return { order: [], reranked: false, fallbackReason: 'no_candidates', providerId: provider.id }
  }

  try {
    const scored = await fn(query, candidates)
    const known = new Set(original)
    const ordered = scored
      .filter((s) => known.has(s.key))
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
      .map((s) => s.key)

    // 리랭커가 빠뜨린 후보는 버리지 않고 뒤에 붙인다 — 버리면 검색 결과가 조용히 줄어든다
    const missing = original.filter((k) => !ordered.includes(k))
    return {
      order: [...ordered, ...missing],
      reranked: true,
      fallbackReason: null,
      providerId: provider.id,
    }
  } catch (e) {
    return {
      order: original,
      reranked: false,
      fallbackReason: e instanceof Error ? e.message : String(e),
      providerId: provider.id,
    }
  }
}

// 임베딩

export type EmbedProviderFn = (texts: readonly string[]) => Promise<(number[] | null)[]>

export interface EmbedProviderResult {
  vectors: (number[] | null)[]
  providerId: string | null
  fallbackReason: string | null
}

/**
 * 임베딩도 같은 방식으로 바꿔 끼운다.
 *
 * 실패하면 전부 null 을 돌려준다 — **던지지 않는다.**
 * 던지면 청크 저장이 통째로 막히고 키워드 검색까지 죽는다.
 */
export async function embedWith(
  texts: readonly string[],
  provider: AiProvider | null,
  fn: EmbedProviderFn | null,
): Promise<EmbedProviderResult> {
  if (!provider || !fn) {
    return { vectors: texts.map(() => null), providerId: null, fallbackReason: 'no_provider' }
  }
  try {
    const vectors = await fn(texts)
    return { vectors, providerId: provider.id, fallbackReason: null }
  } catch (e) {
    return {
      vectors: texts.map(() => null),
      providerId: provider.id,
      fallbackReason: e instanceof Error ? e.message : String(e),
    }
  }
}
