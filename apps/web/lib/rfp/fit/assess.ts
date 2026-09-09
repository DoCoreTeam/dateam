/**
 * 적합도 판정 (설계서 3.10.3)
 *
 * ## 점수를 코드로 계산하는 이유
 *
 * 모델에게 「몇 점이냐」고 물으면 **같은 입력에 다른 답이 나온다.**
 * 그 점수로 「참여할까 말까」를 정하는데, 어제 72점이던 것이 오늘 68점이면
 * 사용자는 시스템을 믿지 않게 된다. 산수는 코드가 한다.
 *
 * AI 가 하는 일은 «매핑되지 않는 자연어 요건을 해석하는 것» 과 «gaps 를 서술하는 것» 뿐이다.
 *
 * ## 「확인 불가」를 미충족으로 접지 않는다
 *
 * 못 읽은 요건을 미충족으로 두면 멀쩡한 사업이 부적합으로 뜬다.
 * 충족으로 두면 그 반대다. 셋째 값이 필요하다 — 그리고 그 값이 있으면
 * 판정에 **「조건부」 꼬리표**를 달아 사람이 보게 한다.
 */

import type { CompanyProfile, RequirementType } from './profile.ts'
import { classifyRequirement, parseAmount, parseCount } from './profile.ts'

export type HardResult = 'met' | 'unmet' | 'unknown'

export interface HardRequirement {
  /** 원문 그대로. 화면이 근거로 보여 준다 */
  text: string
  blockId: string | null
}

export interface HardCheck {
  requirement: HardRequirement
  type: RequirementType
  result: HardResult
  /** 무엇과 비교했나 — 사용자가 「왜 미충족이냐」를 물을 자리다 */
  profileBasis: string | null
  /** 파트너 역량으로 채울 수 있나 */
  coverableByPartner: boolean
}

/** 하드 제약 하나를 판정한다 */
export function checkHard(req: HardRequirement, profile: CompanyProfile): HardCheck {
  const type = classifyRequirement(req.text)
  const base = { requirement: req, type, coverableByPartner: false }

  switch (type) {
    case 'business_registration': {
      const has = profile.basic.registrations.length > 0
      return { ...base, result: has ? 'met' : 'unmet', profileBasis: has ? profile.basic.registrations.join(', ') : null }
    }
    case 'capital': {
      const need = parseAmount(req.text)
      const have = profile.basic.capitalKrw
      if (need === null || have === null) return { ...base, result: 'unknown', profileBasis: null }
      return { ...base, result: have >= need ? 'met' : 'unmet', profileBasis: `자본금 ${have.toLocaleString()}원` }
    }
    case 'revenue': {
      const need = parseAmount(req.text)
      const have = profile.basic.annualRevenueKrw
      if (need === null || have === null) return { ...base, result: 'unknown', profileBasis: null }
      return { ...base, result: have >= need ? 'met' : 'unmet', profileBasis: `매출 ${have.toLocaleString()}원` }
    }
    case 'record_count': {
      const need = parseCount(req.text)
      const have = profile.trackRecords.length
      if (need === null) return { ...base, result: 'unknown', profileBasis: null }
      return {
        ...base,
        result: have >= need ? 'met' : 'unmet',
        profileBasis: `실적 ${have}건`,
        // 실적은 컨소시엄 구성원 것으로 채우는 것이 일반적이다
        coverableByPartner: have < need && profile.partners.length > 0,
      }
    }
    case 'record_amount': {
      const need = parseAmount(req.text)
      const best = profile.trackRecords.reduce((n, r) => Math.max(n, r.amountKrw ?? 0), 0)
      if (need === null) return { ...base, result: 'unknown', profileBasis: null }
      return {
        ...base,
        result: best >= need ? 'met' : 'unmet',
        profileBasis: `최대 실적 ${best.toLocaleString()}원`,
        coverableByPartner: best < need && profile.partners.length > 0,
      }
    }
    case 'certification': {
      const wanted = profile.certifications.find((c) => req.text.replace(/\s/g, '').includes(c.name.replace(/\s/g, '')))
      if (wanted) return { ...base, result: 'met', profileBasis: `인증 ${wanted.name}` }
      // 인증은 파트너가 대신 갖고 있어도 자격이 되는 경우가 있다
      const partner = profile.partners.find((p) =>
        p.capabilities.some((c) => req.text.replace(/\s/g, '').includes(c.replace(/\s/g, ''))))
      return {
        ...base, result: 'unmet', profileBasis: null,
        coverableByPartner: Boolean(partner),
      }
    }
    case 'region': {
      const have = profile.basic.region
      if (!have) return { ...base, result: 'unknown', profileBasis: null }
      return { ...base, result: req.text.includes(have) ? 'met' : 'unmet', profileBasis: `소재지 ${have}` }
    }
    case 'personnel': {
      const need = parseCount(req.text)
      const have = profile.basic.headcount
      if (need === null || have === null) return { ...base, result: 'unknown', profileBasis: null }
      return {
        ...base, result: have >= need ? 'met' : 'unmet', profileBasis: `인원 ${have}명`,
        coverableByPartner: have < need && profile.partners.length > 0,
      }
    }
    default:
      // 매핑되지 않는 요건은 AI 가 해석하되 여기서는 「확인 불가」로 남긴다
      return { ...base, result: 'unknown', profileBasis: null }
  }
}

// 소프트 점수

/**
 * 설계서 3.10.3 의 가중치.
 *
 * 합이 100 이 아닌 이유: 리스크는 **빼는 항목**이다.
 * 40 + 25 + 15 + 10 = 90 이 양의 최대이고 리스크가 최대 20 을 깎는다.
 */
export const SOFT_WEIGHTS = {
  capability: 40,
  trackRecord: 25,
  scale: 15,
  risk: -20,
  competition: 10,
} as const

export interface SoftInputs {
  /** 0~1. 요구사항과 역량 태그가 얼마나 맞나 */
  capability: number
  /** 0~1. 지난 실적이 이 사업과 얼마나 닮았나 */
  trackRecord: number
  /** 0~1. 예산과 기간이 우리가 해 본 범위 안인가 */
  scale: number
  /** 0~1. 이상 조항 심각도 합을 정규화한 값. 클수록 위험 */
  risk: number
  /** 0~1. 경쟁 환경. 데이터가 없으면 0.5 */
  competition: number
}

export interface SoftScore {
  total: number
  parts: Record<keyof SoftInputs, number>
}

/**
 * 점수를 낸다 — 같은 입력에 언제나 같은 값.
 *
 * 0~100 으로 자른다. 리스크가 크면 음수가 될 수 있는데, 음수 점수는
 * 화면에서 뜻을 잃는다(「-12점」이 무슨 뜻인가).
 */
export function softScore(inputs: SoftInputs): SoftScore {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))
  const parts = {
    capability: clamp01(inputs.capability) * SOFT_WEIGHTS.capability,
    trackRecord: clamp01(inputs.trackRecord) * SOFT_WEIGHTS.trackRecord,
    scale: clamp01(inputs.scale) * SOFT_WEIGHTS.scale,
    risk: clamp01(inputs.risk) * SOFT_WEIGHTS.risk,
    competition: clamp01(inputs.competition) * SOFT_WEIGHTS.competition,
  }
  const raw = Object.values(parts).reduce((a, b) => a + b, 0)
  return { total: Math.round(Math.min(100, Math.max(0, raw))), parts }
}

// 판정

export type Verdict = 'full' | 'partial' | 'unfit'

/** 전체 수행에 필요한 점수 */
export const FULL_SCORE_MIN = 70
/** 부분 참여에 필요한 점수 */
export const PARTIAL_SCORE_MIN = 50

export interface Assessment {
  verdict: Verdict
  /** 확인 불가 요건이 있으면 참 — 화면이 「조건부」 꼬리표를 단다 */
  conditional: boolean
  score: number
  parts: Record<keyof SoftInputs, number>
  hardChecks: HardCheck[]
  summary: { met: number; unmet: number; unknown: number }
  /** 무엇을 채우면 판정이 바뀌나 */
  gaps: string[]
  /** 어느 프로필로 어느 리포트를 보고 판정했나 */
  profileVersion: number
  reportVersion: number
}

export interface AssessInput {
  hardRequirements: readonly HardRequirement[]
  profile: CompanyProfile
  soft: SoftInputs
  reportVersion: number
}

/**
 * 판정한다.
 *
 * 하드 제약이 먼저다 — 점수가 아무리 높아도 자격이 안 되면 못 낸다.
 */
export function assess(input: AssessInput): Assessment {
  const hardChecks = input.hardRequirements.map((r) => checkHard(r, input.profile))
  const met = hardChecks.filter((c) => c.result === 'met').length
  const unmet = hardChecks.filter((c) => c.result === 'unmet')
  const unknown = hardChecks.filter((c) => c.result === 'unknown').length

  const score = softScore(input.soft)
  const verdict = decideVerdict(unmet, score.total)

  return {
    verdict,
    // 못 읽은 요건이 있으면 사람이 봐야 한다
    conditional: unknown > 0,
    score: score.total,
    parts: score.parts,
    hardChecks,
    summary: { met, unmet: unmet.length, unknown },
    gaps: buildGaps(unmet, score.total, verdict),
    profileVersion: input.profile.version,
    reportVersion: input.reportVersion,
  }
}

function decideVerdict(unmet: readonly HardCheck[], score: number): Verdict {
  if (unmet.length === 0) return score >= FULL_SCORE_MIN ? 'full' : 'partial'
  // 미충족을 파트너가 다 채울 수 있으면 부분 참여가 가능하다
  const allCoverable = unmet.every((c) => c.coverableByPartner)
  if (allCoverable && score >= PARTIAL_SCORE_MIN) return 'partial'
  return 'unfit'
}

/** 무엇을 채우면 판정이 바뀌나 — 「부적합」만 보여 주면 사용자가 할 일이 없다 */
function buildGaps(unmet: readonly HardCheck[], score: number, verdict: Verdict): string[] {
  const gaps: string[] = []
  for (const c of unmet) {
    gaps.push(c.coverableByPartner
      ? `${c.requirement.text} — 파트너 역량으로 채울 수 있다`
      : `${c.requirement.text} — 직접 갖춰야 한다`)
  }
  if (verdict === 'partial' && unmet.length === 0 && score < FULL_SCORE_MIN) {
    gaps.push(`점수 ${score} 점으로 전체 수행 기준 ${FULL_SCORE_MIN} 점에 ${FULL_SCORE_MIN - score} 점 모자란다`)
  }
  return gaps
}
