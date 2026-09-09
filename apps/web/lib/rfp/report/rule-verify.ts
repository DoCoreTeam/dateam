/**
 * 규칙 검증 — 산술과 법정 기간과 외부 메타 대조 (설계서 3.6.4)
 *
 * ## AI 가 못 잡는 것을 규칙이 잡는다
 *
 * 「사업기간 12개월, 2026-03-01 ~ 2026-09-30」 은 문장으로는 자연스럽다.
 * 모델은 두 값을 각각 원문에서 맞게 가져왔고 인용도 진짜다. 그런데 **더해 보면 안 맞는다.**
 * 이런 것은 산술이 잡는 것이지 언어 모델이 잡는 것이 아니다.
 *
 * ## 법정 기간은 사실이지 의견이 아니다
 *
 * 공고 기간·재공고 기간은 국가계약법 시행령에 숫자로 적혀 있다.
 * 모델에 물으면 그럴듯하게 틀린다. 표로 갖고 있어야 한다.
 */

export type RuleSeverity = 'error' | 'warning'

export interface RuleFinding {
  ruleId: string
  severity: RuleSeverity
  message: string
  /** 어느 필드가 어긋났나 */
  fields: string[]
}

// 산술 정합

export interface ScheduleFacts {
  start: string | null
  end: string | null
  durationMonths: number | null
  proposalDeadline: string | null
  bidOpenDate: string | null
  noticeDate: string | null
}

/** 두 날짜 사이 개월 수 — 반올림하지 않고 소수로 둔다 */
export function monthsBetween(start: string, end: string): number | null {
  const a = Date.parse(start)
  const b = Date.parse(end)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return (b - a) / (1000 * 60 * 60 * 24 * 30.44)
}

/** 기간이 이만큼 어긋나면 짚는다. 월 길이 차이로 0.5 정도는 늘 생긴다 */
export const DURATION_TOLERANCE_MONTHS = 0.7

export function checkSchedule(f: ScheduleFacts): RuleFinding[] {
  const out: RuleFinding[] = []

  if (f.start && f.end) {
    const a = Date.parse(f.start)
    const b = Date.parse(f.end)
    if (!Number.isNaN(a) && !Number.isNaN(b) && b < a) {
      out.push({ ruleId: 'schedule.end_before_start', severity: 'error',
        message: '종료일이 시작일보다 앞선다', fields: ['start', 'end'] })
    }
    if (f.durationMonths !== null) {
      const actual = monthsBetween(f.start, f.end)
      if (actual !== null && Math.abs(actual - f.durationMonths) > DURATION_TOLERANCE_MONTHS) {
        // 문장으로는 자연스럽고 인용도 진짜인데 더해 보면 안 맞는 자리다
        out.push({ ruleId: 'schedule.duration_mismatch', severity: 'error',
          message: `사업기간 ${f.durationMonths}개월과 시작·종료일 차이 ${actual.toFixed(1)}개월이 다르다`,
          fields: ['start', 'end', 'durationMonths'] })
      }
    }
  }

  if (f.proposalDeadline && f.bidOpenDate) {
    const p = Date.parse(f.proposalDeadline)
    const o = Date.parse(f.bidOpenDate)
    if (!Number.isNaN(p) && !Number.isNaN(o) && o < p) {
      out.push({ ruleId: 'schedule.open_before_deadline', severity: 'warning',
        message: '개찰일이 제안 마감보다 앞선다', fields: ['proposalDeadline', 'bidOpenDate'] })
    }
  }

  return out
}

// 법정 공고 기간

/**
 * 국가를 당사자로 하는 계약에 관한 법률 시행령의 공고 기간.
 *
 * 모델에 물으면 그럴듯하게 틀린다. 표로 갖고 있어야 한다.
 */
export const LEGAL_NOTICE_DAYS = {
  /** 일반 경쟁입찰 */
  general: 7,
  /** 협상에 의한 계약 (제안서 제출 마감까지) */
  negotiated: 40,
  /** 긴급 공고 */
  urgent: 5,
  /** 재공고 */
  rebid: 5,
} as const

export type NoticeKind = keyof typeof LEGAL_NOTICE_DAYS

export function daysBetween(a: string, b: string): number | null {
  const x = Date.parse(a)
  const y = Date.parse(b)
  if (Number.isNaN(x) || Number.isNaN(y)) return null
  return (y - x) / (1000 * 60 * 60 * 24)
}

/**
 * 공고일과 마감일 사이가 법정 기간을 채웠나.
 *
 * 못 채웠다고 **위법이라 단정하지 않는다** — 예외 규정이 여럿이고,
 * 우리가 공고 종류를 잘못 짚었을 수도 있다. 「짧다」고만 적는다.
 */
export function checkNoticePeriod(
  noticeDate: string | null, deadline: string | null, kind: NoticeKind,
): RuleFinding[] {
  if (!noticeDate || !deadline) return []
  const days = daysBetween(noticeDate, deadline)
  if (days === null) return []
  const required = LEGAL_NOTICE_DAYS[kind]
  if (days >= required) return []
  return [{
    ruleId: 'notice.period_short',
    severity: 'warning',
    message: `공고 기간이 ${days.toFixed(0)}일로 ${kind} 기준 ${required}일보다 짧다`,
    fields: ['noticeDate', 'proposalDeadline'],
  }]
}

// 금액

export interface BudgetFacts {
  totalAmount: number | null
  vatIncluded: boolean | null
  /** 원문에 나온 금액들. 총액과 다른 값이 섞여 있으면 짚는다 */
  mentions: number[]
}

/** 총액과 이만큼 넘게 다르면 다른 금액으로 본다 */
export const AMOUNT_TOLERANCE = 0.01

export function checkBudget(f: BudgetFacts): RuleFinding[] {
  const out: RuleFinding[] = []
  if (f.totalAmount === null) return out

  if (f.totalAmount <= 0) {
    out.push({ ruleId: 'budget.non_positive', severity: 'error',
      message: '사업 금액이 0 이하다', fields: ['totalAmount'] })
  }

  // 부가세 포함 여부를 안 적으면 제안 가격이 10% 틀린다
  if (f.vatIncluded === null) {
    out.push({ ruleId: 'budget.vat_unknown', severity: 'warning',
      message: '부가세 포함 여부가 없다', fields: ['vatIncluded'] })
  }

  const others = f.mentions.filter((m) =>
    Math.abs(m - f.totalAmount!) / Math.max(1, f.totalAmount!) > AMOUNT_TOLERANCE)
  if (others.length > 0) {
    // 배정예산·추정가격·기초금액이 섞여 있는 것이 정상이다. 그래서 경고이지 오류가 아니다
    const vat = others.find((m) => closeTo(m, f.totalAmount! * 1.1) || closeTo(m, f.totalAmount! / 1.1))
    out.push({
      ruleId: vat ? 'budget.vat_pair' : 'budget.amount_mismatch',
      severity: 'warning',
      message: vat
        ? `총액과 부가세 관계로 보이는 금액이 함께 있다 (${vat.toLocaleString()})`
        : `총액과 다른 금액이 원문에 ${others.length}건 있다`,
      fields: ['totalAmount', 'mentions'],
    })
  }

  return out
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(1, b) <= AMOUNT_TOLERANCE
}

// 외부 메타 대조

export interface G2bMeta {
  noticeNo: string | null
  title: string | null
  agency: string | null
  budgetAmount: number | null
  proposalDeadline: string | null
}

export interface ExtractedMeta {
  title: string | null
  agency: string | null
  budgetAmount: number | null
  proposalDeadline: string | null
}

/**
 * 나라장터가 준 값과 문서에서 뽑은 값을 맞춰 본다.
 *
 * **문서 쪽을 틀렸다고 단정하지 않는다** — 정정공고로 금액이 바뀌었는데
 * 우리가 옛 첨부를 읽고 있을 수도 있다. 다르면 다르다고만 적는다.
 */
export function compareWithG2b(meta: G2bMeta, extracted: ExtractedMeta): RuleFinding[] {
  const out: RuleFinding[] = []

  if (meta.budgetAmount !== null && extracted.budgetAmount !== null
      && !closeTo(extracted.budgetAmount, meta.budgetAmount)) {
    out.push({ ruleId: 'g2b.budget_mismatch', severity: 'warning',
      message: `공고 금액 ${meta.budgetAmount.toLocaleString()}원과 문서에서 뽑은 ${extracted.budgetAmount.toLocaleString()}원이 다르다`,
      fields: ['budget.totalAmount'] })
  }

  if (meta.proposalDeadline && extracted.proposalDeadline) {
    const d = daysBetween(meta.proposalDeadline, extracted.proposalDeadline)
    if (d !== null && Math.abs(d) > 1) {
      out.push({ ruleId: 'g2b.deadline_mismatch', severity: 'warning',
        message: '공고 마감일과 문서에서 뽑은 마감일이 다르다',
        fields: ['schedule.proposalDeadline'] })
    }
  }

  if (meta.agency && extracted.agency && !sameOrg(meta.agency, extracted.agency)) {
    out.push({ ruleId: 'g2b.agency_mismatch', severity: 'warning',
      message: `공고 기관 「${meta.agency}」과 문서 기관 「${extracted.agency}」이 다르다`,
      fields: ['overview.agency'] })
  }

  return out
}

/** 기관 이름 비교 — 「(재)」 「주식회사」 같은 장식은 무시한다 */
function sameOrg(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[\s()（）주식회사재단법인사단법인㈜]/g, '')
  const x = norm(a)
  const y = norm(b)
  return x === y || x.includes(y) || y.includes(x)
}

/** 오류가 하나라도 있으면 리포트에 「검증 실패」가 붙는다 */
export function hasErrors(findings: readonly RuleFinding[]): boolean {
  return findings.some((f) => f.severity === 'error')
}
