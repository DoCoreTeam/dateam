/**
 * 매출 인식 장부의 말 — SSOT (용어집 §03-2)
 *
 * **왜 여기인가**: 장부는 화면 하나가 아니라 **딜 상세·리포트·견적·정산**이 함께 읽는다.
 * 화면마다 「수주 매출」·「총 사업비」·「계약금액」으로 갈리면
 * 사용자는 같은 숫자를 다른 것으로 읽는다 — 그게 이 기능 전체를 망가뜨린다.
 *
 * **금지어**: `총매출`·`매출액`(무엇의 매출인지 안 밝힌다) · `현물비`(비용이 아니다) ·
 * `자부담금`(현금과 현물을 뭉갠다) · `부가세 별도금액`(공급가액이 표준어다).
 */

import { eulReul } from '../ui/josa.ts'

/** 장부에 나오는 금액의 이름 — 자리마다 같은 말을 쓴다 */
export const LEDGER = {
  /** 전체 사업비. 영업 실적·목표의 기준이 되는 큰 숫자 */
  booked: '수주 매출',
  /** 수주 매출 − 현물. 실제로 돈이 오가는 규모 */
  exInKind: '현물 제외',
  /** 국비 + 지방비. 회계가 매출로 인식하는 금액 */
  accountingRevenue: '회계 수익 인식',
  /** 현물이 아닌 재원의 합 */
  cashInflow: '현금 유입',
  /** 부가세를 뺀 금액 — `부가세 별도금액` 금지 */
  net: '공급가액',
  tax: '부가세',
  gross: '합계',
  /** 절 제목 */
  title: '매출 인식 장부',
  amountBasis: '금액 기준',
  fundingSection: '재원 구성',
  inKindSection: '현물 명세',
  inKindByYear: '현물 연차 배분',
  /** 법령상 정부출연금과 구분해 따로 관리해야 하는 재원에 붙는 표시 */
  separateAccount: '별도 계좌',
  /** 접힌 상세를 여는 말 — `더보기`·`상세` 금지(같은 행위가 화면마다 다른 이름이 된다) */
  expand: '자세히',
  /**
   * 장부에 아직 아무것도 안 적혔을 때의 버튼.
   *
   * ~~「수정」~~ 은 **고칠 것이 이미 있다**는 뜻이라, 재원도 현물도 없는 딜에서
   * 무엇을 고치라는 건지 알 수 없다(사용자 지적).
   * 채운 뒤에는 「수정」이 맞다 — 같은 버튼이 상태에 따라 다른 말을 한다.
   */
  registerDetail: '상세 등록',
  collapse: '접기',
  /** 현물 입력 안내 — 왜 근거를 적어야 하는지까지 말한다 */
  inKindWhy: '숫자 한 칸으로 두면 다음 달에 그 금액이 무엇이었는지 아무도 모릅니다. 정산 서류에 그대로 쓰이는 환산 근거를 함께 적어 주세요.',
  fundingWhy: '국가 과제에서만 씁니다. 비워 두면 재원 구성을 쓰지 않는 딜로 봅니다.',
  basisWhy: '국가 과제 사업비는 보통 부가세가 포함된 금액입니다. 「포함」을 고르면 공급가액과 세액을 그 금액에서 나눠 계산합니다.',
  /** 견적 금액을 여기서 못 고치는 이유 — 밝히지 않으면 «왜 칸이 없지»가 된다 */
  /** 현물 명세의 입력 라벨 — 화면 셋(입력·목록·오류)이 같은 말을 쓴다 */
  inKindName: '현물 이름',
  inKindNamePlaceholder: '이름 (예: 연구원 3명)',
  inKindValue: '현물 평가액',
  inKindBasis: '환산 근거',
  startDate: '현물 시작일',
  endDate: '현물 종료일',
  inKindEmptyHint: '아래에서 한 줄씩 더하면 여기에 쌓입니다.',
  /** 빈 이름 거부 — 「입력해 주세요」는 사과가 아니라 다음 조치다(§0-2 문형) */
  inKindNameRequired: '현물 이름을 입력해 주세요.',
  quotedReadOnlyWhy: '수주 매출은 계약 > 견적 > 예산 중 가장 확실한 것을 씁니다. 견적 금액은 대표 견적에서 와야 해서 여기서 고치지 않습니다.',
} as const

/** 수주 매출이 어느 칸에서 왔나 — 사용자에게 «옛 칸»이라고 말하지 않는다 */
export type BookedFromKey = 'contract' | 'quote' | 'budget' | 'legacy' | 'none'

export const BOOKED_FROM_LABEL: Record<BookedFromKey, string> = {
  contract: '계약 금액',
  quote: '견적 금액',
  budget: '예산 금액',
  /** 이관 중인 옛 칸 — 화면의 「금액」과 같은 말을 쓴다 */
  legacy: '금액',
  none: '금액 미정',
}

/** 금액 셋의 이름 — 시간축이 다른 숫자다 */
export const AMOUNT_LABEL = {
  budget: '예산',
  quoted: '견적',
  contract: '계약',
} as const

export const AMOUNT_HINT = {
  budget: '고객이 말한 금액',
  contract: '도장 찍은 금액',
} as const

/** 재원 네 갈래 — 사용자가 종류를 만들지 않는다 */
export type FundingKey = 'NATIONAL' | 'LOCAL' | 'OWN_CASH' | 'IN_KIND'

export const FUNDING_LABEL: Record<FundingKey, string> = {
  NATIONAL: '국비',
  LOCAL: '지방비',
  /** `자부담금` 금지 — 현금과 현물을 뭉개면 「현물 제외」가 설명되지 않는다 */
  OWN_CASH: '자부담 현금',
  IN_KIND: '자부담 현물',
}

/** 부처·지자체 이름을 받는 재원 — 정산 서류에 그대로 쓰인다 */
export const FUNDING_AGENCY_HINT = '부처·지자체'

/** 현물 종류 — 환산 근거가 종류마다 다르다(연구개발비 사용기준) */
export type InKindKindKey = 'LABOR' | 'EQUIPMENT' | 'MATERIAL' | 'FACILITY'

export const IN_KIND_LABEL: Record<InKindKindKey, string> = {
  LABOR: '인건비',
  EQUIPMENT: '장비사용료',
  MATERIAL: '연구재료',
  FACILITY: '시설',
}

/** 환산 근거의 표준 문구 — 비워 두면 다음 달에 그 금액이 무엇이었는지 아무도 모른다 */
export const IN_KIND_BASIS_HINT: Record<InKindKindKey, string> = {
  LABOR: '연봉 × 참여율 × 기간',
  EQUIPMENT: '취득가 감가상각 또는 시간당 사용료',
  MATERIAL: '장부가',
  FACILITY: '면적 × 단가 × 기간',
}

/** 부가세를 어느 쪽으로 푸는가 — 이 한 칸이 방향을 기록하고 세 값은 계산된다 */
export const TAX_BASIS_LABEL = {
  NET: '별도 — 이 금액이 공급가액입니다',
  GROSS: '포함 — 이 금액에 부가세가 들어 있습니다',
} as const

/** 부가세 계산 방향을 사람 말로 — 화면이 문장을 짓지 않는다 */
export function taxBasisNote(basis: 'NET' | 'GROSS'): string {
  return basis === 'GROSS'
    ? `${LEDGER.booked}이 ${LEDGER.tax} 포함 금액입니다. ${LEDGER.net}과 세액은 여기서 나눠 계산했습니다.`
    : `${LEDGER.booked}이 ${LEDGER.net}입니다. 세액은 여기서 더해 계산했습니다.`
}

/** 현물이 사업비에서 차지하는 비중 */
export function inKindShare(amountText: string, pct: number | null): string {
  return pct === null
    ? `${FUNDING_LABEL.IN_KIND} ${amountText}`
    : `${FUNDING_LABEL.IN_KIND} ${amountText} · 사업비의 ${pct}%`
}

/** 권한이 없어 명세를 못 볼 때 — 무엇이 보이고 무엇이 안 보이는지 둘 다 말한다 */
export const IN_KIND_LOCKED = `${LEDGER.inKindSection}는 관리자만 볼 수 있습니다. 합계는 위에 있습니다.`

/** 기간을 안 정한 현물은 연차에 배분하지 않는다 — 0으로 때우지 않았다는 사실을 밝힌다 */
export function undatedInKindNote(amountText: string): string {
  const subject = `기간을 정하지 않은 ${FUNDING_LABEL.IN_KIND} ${amountText}`
  return `${subject}${eulReul(amountText)} 연차에 배분하지 않았습니다.`
}


/** 연차 표기 — 화면이 「년」을 직접 붙이지 않는다 */
export function yearLabel(year: number): string {
  return `${year}년`
}

/** 개월 표기 */
export function monthsLabel(months: number): string {
  return `${months}개월`
}

/** 환산 근거 입력의 예시 — 종류를 바꾸면 예시도 따라간다 */
export function basisPlaceholder(kind: InKindKindKey): string {
  return `환산 근거 (예: ${IN_KIND_BASIS_HINT[kind]})`
}


/**
 * 사업 유형 — 무엇을 파는 일인가.
 *
 * **왜 필요한가**: 유형마다 원가 구조도 계약 형태도 다르다.
 * GPU 는 매입가가 원가고, SI 는 인건비가 원가다. 국책은 재원 구성이 붙는다.
 * 유형을 안 적어 두면 나중에 「어떤 사업이 남는 장사였나」에 답할 수 없다.
 */
export type BusinessTypeKey =
  | 'GPU' | 'SI' | 'SOLUTION' | 'HARDWARE' | 'MSP' | 'PROJECT' | 'CREDIT' | 'OTHER'

export const BUSINESS_TYPE_LABEL: Record<BusinessTypeKey, string> = {
  GPU: 'GPU',
  SI: 'SI',
  SOLUTION: '솔루션',
  HARDWARE: '하드웨어',
  MSP: 'MSP',
  /** 국가 과제 — 재원 구성과 현물이 붙는 유일한 유형이다 */
  PROJECT: '국책',
  /**
   * 크레딧 충전 — 고객이 미리 충전하고 쓰는 만큼 소진한다.
   *
   * **영업과 회계가 다른 말을 하는 유일한 유형이다.**
   * 영업: 충전한 순간 수주이고 이미 수금됐다.
   * 회계: 소진되기 전까지는 선수금(부채)이고 매출이 아니다.
   * 지금은 **영업 관점만** 담는다 — 소진에 따른 수익 인식은 아직 구현하지 않았다.
   */
  CREDIT: '크레딧 충전',
  OTHER: '기타',
}

/** 화면이 세우는 순서 — 자주 쓰는 것부터 */
export const BUSINESS_TYPE_ORDER: readonly BusinessTypeKey[] =
  ['GPU', 'SI', 'SOLUTION', 'HARDWARE', 'MSP', 'PROJECT', 'CREDIT', 'OTHER']

export const BUSINESS_TYPE_LABEL_TEXT = '사업 유형'

/** 기간 — 고르면 따라오는 칸이 달라진다 */
export type TermTypeKey = 'SHORT' | 'MID' | 'LONG'

export const TERM_TYPE_LABEL: Record<TermTypeKey, string> = {
  SHORT: '단기 (주·월)',
  MID: '중기 (몇 개월)',
  /** 1년 이상 — 연차 구분이 열린다 */
  LONG: '장기 (1년 이상)',
}

export const TERM_TYPE_ORDER: readonly TermTypeKey[] = ['SHORT', 'MID', 'LONG']
export const TERM_TYPE_LABEL_TEXT = '사업 기간'

/**
 * 딜이 **성사될 것으로 보는 날**.
 *
 * ~~「예상 마감일」~~ 은 «일이 끝나는 날»로 읽힌다 — 바로 위에 「사업 종료일」이 있어
 * 더 헷갈렸다(사용자 지적: 「예상 마감일은 영업 수주일 이야기하는거야?」).
 * 우리가 이 날짜로 하는 일은 **언제 수주할지 예측**하는 것이므로 그렇게 부른다.
 */
export const EXPECTED_CLOSE_LABEL = '수주 예상일'

/** 종료일을 알 수 없는 사업 — 크레딧은 소진될 때까지가 기간이라 날짜를 못 적는다 */
export const END_DATE_UNKNOWN_LABEL = '종료일 미정'
export const END_DATE_UNKNOWN_HINT = '크레딧 소진 시까지처럼 끝나는 날을 정할 수 없는 사업'
