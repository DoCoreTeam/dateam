// 스키마 구조화(conformance) — 순수 카탈로그 소프트바인딩 SSOT.
//  doc 05(구조화 갭): 현재 resolve-product는 키 불일치 시 held로 "차단"한다(H200 141GB.→h200.→no_model).
//  여기선 차단 대신 "후보 Top-N + 결정"을 반환한다(soft resolve) → AI/사람이 바인딩(구조적 held 해소).
//  순수·결정론(라이브 AI·DB 없음) → 헤드리스 단위검증. 호출부가 카탈로그를 주입.
//
//  설계: 정확 키일치(coreModelKey)=auto, 다중 정확=후보(모호), 부분유사=후보, 무유사=none.
//   결정론 점수 — 동률 시 카탈로그 입력순 유지(안정 정렬).

import { coreModelKey } from './canonical-model.ts'

export interface CatalogEntry {
  productId: string
  model: string
  memory?: string | null
  gpuCount?: number | null
}

export interface BindCandidate {
  productId: string
  model: string
  score: number      // 0~100
  reason: string
}

export type BindDecision = 'auto' | 'candidates' | 'none'

export interface BindResult {
  decision: BindDecision
  /** decision==='auto'일 때 확정 productId. */
  productId?: string
  candidates: BindCandidate[]
}

/** 모델명 → 정규화 토큰 집합(소문자 영숫자, 메모리 제거는 coreModelKey가 처리). */
function tokensOf(key: string): string[] {
  // coreModelKey는 공백/부호 제거된 연속 문자열 → 영문/숫자 경계로 토큰화(h100sxm → h100, sxm).
  return key.match(/[a-z]+|[0-9]+/g) ?? []
}

/** 두 모델명 유사도 0~100 — 정확 키일치 100, 포함 70, 토큰 Jaccard*60. 결정론. */
export function scoreModel(a: string, b: string): number {
  const ka = coreModelKey(a)
  const kb = coreModelKey(b)
  if (!ka || !kb) return 0
  if (ka === kb) return 100
  if (ka.includes(kb) || kb.includes(ka)) return 70
  const ta = new Set(tokensOf(ka))
  const tb = new Set(tokensOf(kb))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  Array.from(ta).forEach((t) => { if (tb.has(t)) inter++ })
  const union = ta.size + tb.size - inter
  return union === 0 ? 0 : Math.round((inter / union) * 60)
}

/** 후보 Top-N — 점수>0만, 내림차순(동률은 입력순 유지=안정). */
export function rankCandidates(model: string, catalog: CatalogEntry[], topN = 3): BindCandidate[] {
  const scored = catalog.map((c, i) => ({
    productId: c.productId,
    model: c.model,
    score: scoreModel(model, c.model),
    reason: '',
    _i: i,
  }))
  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => (b.score - a.score) || (a._i - b._i))
    .slice(0, topN)
    .map(({ productId, model, score }) => ({
      productId, model, score,
      reason: score === 100 ? '정확 일치' : score >= 70 ? '부분 포함' : '토큰 유사',
    }))
}

/** 바인딩 결정 — 정확 1개=auto, 정확 다수=후보(모호), 부분유사=후보, 무유사=none.
 *  threshold: 후보로 제시할 최소 점수(기본 40). held(차단) 대신 항상 후보/결정을 돌려줘 구조적 막힘 해소. */
export function decideBinding(model: string, catalog: CatalogEntry[], opts?: { threshold?: number; topN?: number }): BindResult {
  const threshold = opts?.threshold ?? 40
  const ranked = rankCandidates(model, catalog, opts?.topN ?? 3)
  const exacts = ranked.filter((c) => c.score === 100)
  if (exacts.length === 1) {
    return { decision: 'auto', productId: exacts[0].productId, candidates: exacts }
  }
  if (exacts.length > 1) {
    return { decision: 'candidates', candidates: exacts } // 동일 키 다수(메모리/장수로 구분 필요) → 사람/AI 선택
  }
  const usable = ranked.filter((c) => c.score >= threshold)
  if (usable.length > 0) return { decision: 'candidates', candidates: usable }
  return { decision: 'none', candidates: [] }
}
