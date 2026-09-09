/**
 * 하이브리드 검색 — 키워드와 벡터를 합친다 (설계서 3.3.5)
 *
 * ## 왜 둘 다 쓰나
 *
 * 벡터 검색은 「사업기간이 얼마인가」 같은 **뜻**을 잘 찾고,
 * 키워드 검색은 「SFR-003」 같은 **글자 그대로**를 잘 찾는다.
 * RFP 는 둘이 섞여 있다 — 코드로 찾는 질문과 뜻으로 찾는 질문이 반반이다.
 *
 * ## RRF 를 쓰는 이유
 *
 * 점수를 더하려면 두 점수가 같은 자로 재야 하는데, BM25 점수와 코사인 유사도는
 * **애초에 단위가 다르다.** 정규화해서 더하면 문서 묶음이 바뀔 때마다 비율이 흔들린다.
 * RRF 는 점수 대신 **순위**만 쓴다 — 단위 문제가 아예 없다.
 */

/** RRF 상수. 작을수록 1등에 힘이 몰린다. 60 은 널리 쓰이는 기본값이다 */
export const RRF_K = 60

export interface Ranked {
  chunkKey: string
  /** 원래 점수. 화면이 「왜 걸렸나」를 보여 줄 때만 쓴다 */
  score: number
}

export interface FusedHit {
  chunkKey: string
  /** 합친 점수 — 크면 위 */
  rrf: number
  /** 키워드 검색에서 몇 등이었나. 안 걸렸으면 null */
  keywordRank: number | null
  vectorRank: number | null
}

/**
 * 두 순위를 합친다 — 순수 함수.
 *
 * 한쪽에만 걸린 것도 버리지 않는다. 「SFR-003」은 벡터로는 안 걸리지만
 * 사용자가 찾는 것이 정확히 그것이다.
 */
export function fuseRrf(
  keyword: readonly Ranked[],
  vector: readonly Ranked[],
  k = RRF_K,
): FusedHit[] {
  const rankOf = (list: readonly Ranked[]) => {
    const m = new Map<string, number>()
    list.forEach((r, i) => { if (!m.has(r.chunkKey)) m.set(r.chunkKey, i + 1) })
    return m
  }
  const kw = rankOf(keyword)
  const vec = rankOf(vector)

  const keys = new Set([...Array.from(kw.keys()), ...Array.from(vec.keys())])
  const out: FusedHit[] = []
  for (const key of Array.from(keys)) {
    const kr = kw.get(key) ?? null
    const vr = vec.get(key) ?? null
    const rrf = (kr ? 1 / (k + kr) : 0) + (vr ? 1 / (k + vr) : 0)
    out.push({ chunkKey: key, rrf, keywordRank: kr, vectorRank: vr })
  }

  // 점수가 같으면 키워드 순위가 앞선 쪽을 위로 — 순서가 흔들리면 화면이 매번 달라진다
  return out.sort((a, b) =>
    b.rrf - a.rrf
    || (a.keywordRank ?? Infinity) - (b.keywordRank ?? Infinity)
    || a.chunkKey.localeCompare(b.chunkKey))
}

/**
 * 검색어에서 코드처럼 생긴 조각을 뽑는다.
 *
 * 「SFR-003 관련 요구사항」에서 SFR-003 은 **글자 그대로 찾아야 하는 것**이다.
 * 이런 조각이 있으면 키워드 쪽에 힘을 더 준다.
 */
export function extractExactTerms(query: string): string[] {
  const terms = new Set<string>()
  for (const m of Array.from(query.toUpperCase().matchAll(/\b[A-Z]{2,4}[\s_-]?\d{2,4}\b/g))) {
    terms.add(m[0].replace(/[\s_]/g, '-'))
  }
  // 따옴표로 묶은 것도 글자 그대로 찾는다
  for (const m of Array.from(query.matchAll(/[「"']([^」"']{2,40})[」"']/g))) terms.add(m[1])
  return Array.from(terms)
}

/** 코드가 섞인 질문이면 키워드 쪽에 힘을 더 준다 */
export function weightFor(query: string): { keyword: number; vector: number } {
  return extractExactTerms(query).length > 0
    ? { keyword: 2, vector: 1 }
    : { keyword: 1, vector: 1 }
}

/** 가중치를 반영한 합치기 */
export function fuseWeighted(
  keyword: readonly Ranked[],
  vector: readonly Ranked[],
  weight: { keyword: number; vector: number },
  k = RRF_K,
): FusedHit[] {
  const base = fuseRrf(keyword, vector, k)
  return base
    .map((h) => ({
      ...h,
      rrf: (h.keywordRank ? weight.keyword / (k + h.keywordRank) : 0)
         + (h.vectorRank ? weight.vector / (k + h.vectorRank) : 0),
    }))
    .sort((a, b) =>
      b.rrf - a.rrf
      || (a.keywordRank ?? Infinity) - (b.keywordRank ?? Infinity)
      || a.chunkKey.localeCompare(b.chunkKey))
}
