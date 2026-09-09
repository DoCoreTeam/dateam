/**
 * 회사 프로필 (설계서 3.10.1)
 *
 * ## 왜 버전을 매기나
 *
 * 「우리가 이 사업에 적합한가」의 답은 **우리가 어떤 회사인가에 따라 바뀐다.**
 * 인증을 하나 따면 어제의 부적합이 오늘의 적합이 된다.
 * 그래서 판정 결과에 **어느 프로필 버전으로 판정했는지** 남긴다 —
 * 안 남기면 「그때는 왜 부적합이었지」에 영영 답할 수 없다.
 *
 * ## 요건 유형 사전이 여기 있는 이유
 *
 * 「소프트웨어사업자 신고」 「자본금 5억 이상」 「ISO 27001」 은 생김새가 제각각이지만
 * **비교하는 방법은 유형별로 정해져 있다.** 유형을 먼저 알아내면 그다음은 산수다.
 */

export type RequirementType =
  | 'business_registration'   // 사업자 신고·등록
  | 'record_count'            // 실적 건수
  | 'record_amount'           // 실적 금액
  | 'capital'                 // 자본금
  | 'revenue'                 // 매출
  | 'certification'           // 인증
  | 'region'                  // 지역
  | 'personnel'               // 인력 등급별 인원
  | 'unknown'

export interface ProfileBasic {
  companyName: string
  businessNumber: string | null
  /** 소프트웨어사업자 신고 등 */
  registrations: string[]
  capitalKrw: number | null
  annualRevenueKrw: number | null
  headcount: number | null
  region: string | null
}

export interface Certification {
  name: string
  issuer: string | null
  validUntil: string | null
}

export interface TrackRecord {
  projectName: string
  client: string | null
  amountKrw: number | null
  startDate: string | null
  endDate: string | null
  domainTags: string[]
}

export interface Capability {
  tag: string
  /** 1~5 */
  level: number
}

export interface Partner {
  name: string
  capabilities: string[]
}

export interface CompanyProfile {
  /** 판정에 함께 기록된다 */
  version: number
  status: 'draft' | 'active' | 'archived'
  basic: ProfileBasic
  certifications: Certification[]
  trackRecords: TrackRecord[]
  capabilities: Capability[]
  partners: Partner[]
}

export function emptyProfile(version = 1): CompanyProfile {
  return {
    version,
    status: 'draft',
    basic: {
      companyName: '', businessNumber: null, registrations: [],
      capitalKrw: null, annualRevenueKrw: null, headcount: null, region: null,
    },
    certifications: [], trackRecords: [], capabilities: [], partners: [],
  }
}

/**
 * 요건 문장에서 유형을 알아낸다.
 *
 * 위에서부터 먼저 맞는 것이 이긴다 — 「실적 3건 이상, 각 10억 이상」은
 * 건수와 금액 둘 다이지만 건수를 먼저 본다(둘 다 검사하려면 요건을 쪼개야 한다).
 */
export function classifyRequirement(text: string): RequirementType {
  const t = text.replace(/\s/g, '')
  if (/(소프트웨어사업자|사업자등록|업종등록|면허|등록증).*(신고|보유|필)/.test(t)) return 'business_registration'
  if (/실적.*\d+\s*건|(\d+\s*건).*실적/.test(t)) return 'record_count'
  if (/실적.*(금액|억|만원|원)|(계약금액|사업금액).*실적/.test(t)) return 'record_amount'
  if (/자본금/.test(t)) return 'capital'
  if (/(연간|연)?(매출|매출액)/.test(t)) return 'revenue'
  if (/(인증|ISO|CSAP|GS인증|CMMI|CC인증)/.test(t)) return 'certification'
  if (/(소재지|본사|지역|관내|소재)/.test(t)) return 'region'
  if (/(특급|고급|중급|초급|기술자|인력).*(명|인)/.test(t)) return 'personnel'
  return 'unknown'
}

/** 요건에서 숫자를 뽑는다 — 억·만원 단위를 원으로 편다 */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[\s,]/g, '')
  const 억 = t.match(/(\d+(?:\.\d+)?)억/)
  if (억) return Math.round(Number(억[1]) * 100_000_000)
  const 만 = t.match(/(\d+(?:\.\d+)?)만원/)
  if (만) return Math.round(Number(만[1]) * 10_000)
  const 원 = t.match(/(\d[\d]*)원/)
  if (원) return Number(원[1])
  return null
}

/** 요건에서 건수를 뽑는다 */
export function parseCount(text: string): number | null {
  const m = text.replace(/\s/g, '').match(/(\d+)\s*건/)
  return m ? Number(m[1]) : null
}
