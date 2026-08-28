/**
 * 리포트의 축 (SSOT) — 관점·기간·대상
 *
 * **왜 축부터 정하나**: 지금 리포트는 「파이프라인 합계와 성사율」 하나뿐이다.
 * 그런데 같은 딜을 보는 눈이 **셋**이고, 셋이 서로 다른 숫자를 답한다 —
 * 그 셋을 구분하지 않으면 어떤 숫자를 봐도 「이게 무슨 뜻이지」가 남는다.
 * (사용자 지적: 「매출관점이든 회계 관점이든 영업관점이든 리포트가 명확해야 하고
 *  마감, 시점, 대상, 금액, 상세 이런 리포트에 담겨야 하는 항목이…」)
 *
 * 표준 용어를 그대로 쓴다 — 우리가 지어내면 회계·경영진과 말이 안 통한다.
 *   · Bookings(수주) / Revenue(인식 매출) / Billings·Cash(현금)
 *   · 한국 건설·용역 회계의 수주액 / 매출액(진행기준) / 기성고와 같은 갈래다
 */

/** 같은 딜을 보는 세 가지 눈 */
export type ReportLens = 'SALES' | 'REVENUE' | 'CASH'

export const LENS_LABEL: Record<ReportLens, string> = {
  SALES: '영업',
  REVENUE: '매출',
  CASH: '현금',
}

/** 각 눈이 답하는 **질문**. 이걸 화면에 적어야 사람이 숫자를 해석할 수 있다 */
export const LENS_QUESTION: Record<ReportLens, string> = {
  SALES: '얼마나 따냈나',
  REVENUE: '이 기간에 얼마가 매출로 잡히나',
  CASH: '얼마가 들어오나',
}

export const LENS_HINT: Record<ReportLens, string> = {
  SALES: '계약한 시점으로 셉니다. 5년 계약이면 계약한 달에 5년치가 통째로 잡힙니다 — 「얼마짜리 일을 따냈나」의 답입니다.',
  REVENUE: '사업 기간에 나눠 셉니다. 5년 계약 5억이면 해마다 1억입니다 — 회계가 보는 숫자입니다.',
  CASH: '현물을 뺀 금액으로 셉니다. 현물은 돈으로 들어오지 않습니다.',
}

/** 각 눈이 **어느 금액**을 보나 — 기획 「수주 매출과 현물」 단계 5 */
export const LENS_AMOUNT_LABEL: Record<ReportLens, string> = {
  SALES: '수주 총액',
  REVENUE: '인식 매출',
  CASH: '현금 매출',
}

export const LENS_ORDER: readonly ReportLens[] = ['SALES', 'REVENUE', 'CASH']

// ------------------------------------------------------------
// 기간
// ------------------------------------------------------------

export type PeriodKey = 'THIS_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR' | 'LAST_12M'

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  THIS_MONTH: '이번 달',
  THIS_QUARTER: '이번 분기',
  THIS_YEAR: '올해',
  LAST_12M: '최근 12개월',
}

export const PERIOD_ORDER: readonly PeriodKey[] = ['THIS_MONTH', 'THIS_QUARTER', 'THIS_YEAR', 'LAST_12M']

export interface PeriodRange {
  /** `YYYY-MM-DD` — KST 기준. 이 날 포함 */
  from: string
  /** `YYYY-MM-DD` — 이 날 포함 */
  to: string
  label: string
}

/**
 * 기간을 날짜 범위로.
 *
 * **오늘을 인자로 받는다.** 이 파일은 시간을 모른다 — 호출부가 KST 오늘을 넘긴다.
 * 그래야 테스트가 「12월 31일에 이번 분기가 어디까지인가」를 물을 수 있다.
 */
export function periodRange(key: PeriodKey, todayKey: string): PeriodRange {
  const [y, m] = todayKey.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()

  if (key === 'THIS_MONTH') {
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, label: PERIOD_LABEL[key] }
  }
  if (key === 'THIS_QUARTER') {
    const q = Math.floor((m - 1) / 3)
    const startM = q * 3 + 1
    const endM = startM + 2
    return { from: `${y}-${pad(startM)}-01`, to: `${y}-${pad(endM)}-${pad(lastDay(y, endM))}`, label: `${y}년 ${q + 1}분기` }
  }
  if (key === 'THIS_YEAR') {
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}년` }
  }
  // 최근 12개월 — 이번 달 포함 12개월
  const fromM = m - 11
  const fromY = fromM > 0 ? y : y - 1
  const realFromM = fromM > 0 ? fromM : fromM + 12
  return {
    from: `${fromY}-${pad(realFromM)}-01`,
    to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`,
    label: PERIOD_LABEL[key],
  }
}

// ------------------------------------------------------------
// 대상 — 무엇으로 쪼개 볼 것인가
// ------------------------------------------------------------

export type GroupKey = 'OWNER' | 'BUSINESS_TYPE' | 'PIPELINE' | 'COMPANY' | 'STAGE'

export const GROUP_LABEL: Record<GroupKey, string> = {
  OWNER: '담당자',
  BUSINESS_TYPE: '사업 유형',
  PIPELINE: '파이프라인',
  COMPANY: '회사',
  STAGE: '단계',
}

export const GROUP_ORDER: readonly GroupKey[] = ['STAGE', 'BUSINESS_TYPE', 'OWNER', 'COMPANY', 'PIPELINE']

// ------------------------------------------------------------
// 지표 — 이름과 뜻
// ------------------------------------------------------------

export const METRIC = {
  /** 이 기간에 성사된 계약 총액 */
  bookings: '수주',
  /** 아직 안 끝난 딜의 합 */
  openPipeline: '열린 파이프라인',
  /** Σ(금액 × 단계 성사율) */
  weighted: '가중 예상',
  /** 성사 ÷ (성사 + 실패) */
  winRate: '승률',
  /** 리드 → 성사까지 걸린 날 */
  cycleDays: '평균 소요',
  /**
   * 수주 총액 − 누적 인식 매출.
   * 한국 건설·용역 회계의 **수주잔고**와 같은 개념이다 —
   * 「따냈지만 아직 매출로 안 잡힌 몫」이고, 다음 기간의 매출 기반이 된다
   */
  backlog: '수주잔고',
  /** 열린 파이프라인 ÷ 목표. 3~5배가 건강하다는 것이 업계 통설 */
  coverage: '파이프라인 배수',
} as const

export const METRIC_HINT = {
  bookings: '이 기간에 계약한 금액. 5년 계약이면 계약한 달에 5년치가 통째로 들어갑니다',
  openPipeline: '아직 끝나지 않은 딜의 합. 「지금 걸려 있는 일의 규모」입니다',
  weighted: '단계마다 성사율을 곱해 더한 값. 실적이 쌓이면 그 실적을, 없으면 설정값을 씁니다',
  winRate: '끝난 딜 중 성사한 비율. 끝난 딜이 없으면 계산하지 않습니다',
  cycleDays: '딜을 만들고 성사까지 걸린 날. 표본이 적으면 말하지 않습니다',
  backlog: '따냈지만 아직 매출로 안 잡힌 몫. 다음 기간 매출의 기반입니다',
  coverage: '목표 대비 몇 배가 걸려 있나. 3~5배면 건강하다고 봅니다',
} as const

/** 근거가 부족할 때 — 숫자를 지어내지 않는다 */
export const NOT_ENOUGH = '아직 모름'
export function notEnoughBecause(need: string): string {
  return `${need}이 쌓이면 보여 드릴게요`
}
