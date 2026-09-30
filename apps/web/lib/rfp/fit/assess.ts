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

/**
 * 리포트를 판정 입력으로 옮기고 판정한다 — 분석 경로가 부르는 자리.
 *
 * ## 왜 판정을 안 할 때가 있나
 *
 * 적합도는 **우리 회사 정보와 공고를 대조한 결과**다. 회사 정보가 없으면 대조할 것이 없고,
 * 그때 점수를 내면 그 점수는 공고만 보고 지어낸 숫자가 된다. 사용자는 그것을 판정으로 읽는다.
 * 그래서 안 낸다. 대신 **무엇이 없어서 못 냈는지**와 넣으러 갈 곳을 돌려준다.
 *
 * 초안 프로필도 안 쓴다(`isUsableForAssessment`). 자동으로 뽑은 값이 틀린 채 판정에 쓰이면
 * 부적합의 이유가 「우리 회사 정보가 틀려서」가 되고 사용자는 그것을 영영 모른다.
 *
 * ## 모르는 값에 0 을 넣지 않는다
 *
 * 약한 점수 다섯 중 경쟁 환경은 볼 데이터가 아직 없다. 0 을 넣으면 「경쟁이 없다」가 아니라
 * 「경쟁에서 최하점」이 되어 점수를 끌어내린다. 그래서 중립인 0.5 를 쓴다.
 */

/** 자격 요건이 들어 있는 칸들. 하나라도 빠지면 그 요건은 판정에서 통째로 사라진다 */
const HARD_KEYS = ['eligibility', 'technical', 'legal', 'security', 'personnel', 'subcontracting'] as const

/** 값이 글이든 글 목록이든 줄 목록으로 편다 */
function textsOf(node: { value: unknown } | undefined): string[] {
  const v = node?.value
  if (typeof v === 'string') return v.split('\n').map((s) => s.trim()).filter(Boolean)
  if (Array.isArray(v)) {
    return v.flatMap((x) => (typeof x === 'string' ? [x.trim()] : [])).filter(Boolean)
  }
  return []
}

export interface FitReportLike {
  scope?: Record<string, { value: unknown }>
  budget?: Record<string, { value: unknown }>
  schedule?: Record<string, { value: unknown }>
  constraints?: Record<string, { value: unknown }>
}

/** 제약 칸에서 자격 요건 줄을 뽑는다. 근거 블록은 리포트가 안 들고 있어 null 이다 */
export function hardRequirementsFrom(report: FitReportLike): HardRequirement[] {
  const out: HardRequirement[] = []
  for (const key of HARD_KEYS) {
    for (const text of textsOf(report.constraints?.[key])) {
      out.push({ text, blockId: null })
    }
  }
  return out
}

/** 이상 조항 심각도를 0~1 위험도로 — 막는 조항 하나면 이미 절반이다 */
const RISK_OF: Record<string, number> = { blocking: 0.5, margin: 0.25, contract: 0.15, competition: 0.1 }

export function softInputsFrom(input: {
  report: FitReportLike
  profile: CompanyProfile
  anomalies: readonly { severity: string }[]
}): SoftInputs {
  const { report, profile, anomalies } = input

  const tags = new Set(profile.capabilities.map((c) => c.tag.toLowerCase()).filter(Boolean))
  const wanted = textsOf(report.scope?.workItems).concat(textsOf(report.scope?.deliverables))
  const hitCount = wanted.filter((w) => {
    const low = w.toLowerCase()
    return Array.from(tags).some((t) => low.includes(t))
  }).length

  const budget = report.budget?.totalAmount?.value
  const budgetNum = typeof budget === 'number' && Number.isFinite(budget) ? budget : null
  const biggest = profile.trackRecords.reduce((m, r) => Math.max(m, r.amountKrw ?? 0), 0)

  return {
    // 볼 것이 없으면 0.5 — 0 은 「안 맞는다」는 주장이고, 우리는 그 주장을 할 근거가 없다
    capability: wanted.length === 0 || tags.size === 0 ? 0.5 : clamp01(hitCount / wanted.length),
    trackRecord: profile.trackRecords.length === 0 ? 0 : clamp01(profile.trackRecords.length / 5),
    scale: budgetNum === null || biggest === 0 ? 0.5 : clamp01(biggest / budgetNum),
    risk: clamp01(anomalies.reduce((n, a) => n + (RISK_OF[a.severity] ?? 0.1), 0)),
    // 경쟁 환경은 볼 데이터가 아직 없다. 중립값이지 관측값이 아니다
    competition: 0.5,
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

export type FitBlockedReason = 'no_profile' | 'draft_profile'

export interface FitLayerResult {
  assessment: Assessment | null
  /** 판정을 못 한 이유. 지어내는 대신 이것을 화면에 보여 준다 */
  blocked: FitBlockedReason | null
}

export function applyFitLayer(input: {
  profile: CompanyProfile | null
  usable: boolean
  report: FitReportLike
  anomalies: readonly { severity: string }[]
  reportVersion: number
}): FitLayerResult {
  if (!input.profile) return { assessment: null, blocked: 'no_profile' }
  if (!input.usable) return { assessment: null, blocked: 'draft_profile' }

  return {
    assessment: assess({
      hardRequirements: hardRequirementsFrom(input.report),
      profile: input.profile,
      soft: softInputsFrom({ report: input.report, profile: input.profile, anomalies: input.anomalies }),
      reportVersion: input.reportVersion,
    }),
    blocked: null,
  }
}
