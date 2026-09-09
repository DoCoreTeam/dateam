/**
 * 유사 사업 찾기 (설계서 3.12)
 *
 * ## 왜 두 단계인가
 *
 * 임베딩만으로 고르면 「AI 플랫폼 구축」끼리 잘 묶이지만, **예산 3억과 300억이 나란히 온다.**
 * 그 둘은 같은 사업이 아니다 — 참여 방식도 경쟁 상대도 다르다.
 *
 * 그래서 임베딩으로 스무 건까지 넓게 건지고, **구조화 필터**(예산 범위·기간·업종·기관 유형)로
 * 다섯 건으로 좁힌다. 순서가 반대면 안 된다 — 필터를 먼저 걸면 비슷한 뜻의 사업을
 * 필터 밖에서 놓친다.
 */

/** 임베딩으로 건지는 수 */
export const VECTOR_TOP_K = 20
/** 필터를 거쳐 남기는 수 */
export const FINAL_TOP_K = 5

export interface CaseSummary {
  caseId: string
  title: string
  agency: string | null
  sector: string | null
  projectType: string | null
  budgetAmount: number | null
  durationMonths: number | null
  /** 이 사업에 참여했나 — 참여한 사업이 더 쓸모 있다 */
  participated: boolean
  noticeDate: string | null
}

export interface VectorHit {
  caseId: string
  /** 0~1. 클수록 닮았다 */
  similarity: number
}

export interface SimilarFilters {
  /** 예산이 이 배수 안이면 비슷한 규모로 본다 */
  budgetRatio: number
  /** 기간이 이만큼 차이 안이면 비슷하다 */
  durationToleranceMonths: number
  /** 같은 업종만 볼까 */
  sameSectorOnly: boolean
  /** 몇 년 안의 사업만 볼까 */
  withinYears: number
}

export const DEFAULT_FILTERS: SimilarFilters = {
  budgetRatio: 3,
  durationToleranceMonths: 12,
  sameSectorOnly: false,
  withinYears: 5,
}

export interface SimilarResult {
  caseId: string
  similarity: number
  /** 왜 골랐나 — 화면이 그대로 보여 준다 */
  reasons: string[]
}

export interface FindSimilarInput {
  target: CaseSummary
  /** 임베딩이 건져 온 후보. 스무 건까지 */
  hits: readonly VectorHit[]
  /** 후보들의 구조화 정보 */
  summaries: readonly CaseSummary[]
  filters?: Partial<SimilarFilters>
  now?: () => number
}

/**
 * 임베딩 후보를 구조화 필터로 좁힌다.
 *
 * 걸러진 이유를 남긴다 — 「비슷한 사업이 없습니다」만 뜨면 필터가 빡빡한 건지
 * 정말 없는 건지 알 수 없다.
 */
export function findSimilar(input: FindSimilarInput): {
  results: SimilarResult[]
  excluded: { caseId: string; reason: string }[]
} {
  const f = { ...DEFAULT_FILTERS, ...input.filters }
  const now = input.now ?? (() => Date.now())
  const byId = new Map(input.summaries.map((s) => [s.caseId, s]))

  // 임베딩 순으로 스무 건까지만 본다
  const candidates = Array.from(input.hits)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, VECTOR_TOP_K)

  const results: SimilarResult[] = []
  const excluded: { caseId: string; reason: string }[] = []

  for (const hit of candidates) {
    if (hit.caseId === input.target.caseId) continue
    const s = byId.get(hit.caseId)
    if (!s) { excluded.push({ caseId: hit.caseId, reason: 'no_summary' }); continue }

    const reasons: string[] = []

    // 예산 3억과 300억은 같은 사업이 아니다
    if (input.target.budgetAmount !== null && s.budgetAmount !== null) {
      const ratio = Math.max(s.budgetAmount, input.target.budgetAmount)
        / Math.max(1, Math.min(s.budgetAmount, input.target.budgetAmount))
      if (ratio > f.budgetRatio) {
        excluded.push({ caseId: s.caseId, reason: 'budget_out_of_range' })
        continue
      }
      reasons.push(`예산 규모가 ${ratio.toFixed(1)}배 안`)
    }

    if (input.target.durationMonths !== null && s.durationMonths !== null) {
      const gap = Math.abs(s.durationMonths - input.target.durationMonths)
      if (gap > f.durationToleranceMonths) {
        excluded.push({ caseId: s.caseId, reason: 'duration_out_of_range' })
        continue
      }
      reasons.push(`사업기간 차이 ${gap}개월`)
    }

    if (f.sameSectorOnly && input.target.sector && s.sector !== input.target.sector) {
      excluded.push({ caseId: s.caseId, reason: 'sector_mismatch' })
      continue
    }
    if (s.sector && s.sector === input.target.sector) reasons.push(`같은 업종 ${s.sector}`)

    if (s.noticeDate) {
      const years = (now() - Date.parse(s.noticeDate)) / (365.25 * 24 * 3600 * 1000)
      if (Number.isFinite(years) && years > f.withinYears) {
        excluded.push({ caseId: s.caseId, reason: 'too_old' })
        continue
      }
    }

    if (s.participated) reasons.push('우리가 참여한 사업')
    reasons.push(`본문 유사도 ${(hit.similarity * 100).toFixed(0)}%`)

    results.push({ caseId: s.caseId, similarity: hit.similarity, reasons })
  }

  // 참여한 사업을 먼저 — 그 사업의 결과를 우리가 안다
  results.sort((a, b) => {
    const pa = byId.get(a.caseId)?.participated ? 1 : 0
    const pb = byId.get(b.caseId)?.participated ? 1 : 0
    return pb - pa || b.similarity - a.similarity
  })

  return { results: results.slice(0, FINAL_TOP_K), excluded }
}
