/**
 * 영업 리포트의 말 — SSOT (용어집 §03-3)
 *
 * **왜 여기인가**: 리포트의 숫자는 화면 하나가 아니라 **요약 카드·교차표·추이·마감·
 * 내보내기·AI 도우미**가 함께 읽는다. 화면마다 「갭」·「부족분」·「미달」로 갈리면
 * 사용자는 같은 숫자를 다른 것으로 읽고, 도우미는 어느 이름으로 답해야 할지 모른다.
 *
 * **지표 이름은 여기서 새로 짓지 않는다.** `domain/report-axis.ts` 의 `METRIC` 이
 * 이미 일곱을 정의했다(수주·열린 파이프라인·가중 예상·승률·평균 소요·수주잔고·
 * 파이프라인 배수). 여기 있는 것은 **그 목록에 없던 말**뿐이다 — 같은 것을 두 이름으로
 * 부르는 순간 한쪽만 고쳐지고, 그때부터 두 화면이 다른 제품이 된다.
 *
 * **금지어**: `갭`(부족분) · `커버리지`(파이프라인 배수) · `타깃`·`쿼터`(목표) ·
 * `세그먼트`(고객 구분) · `차원`·`각도`(쪼개는 기준) · `시계`·`날짜축`(기준 날짜) ·
 * `연체`(기한 지남 — 상태 라벨이 이미 표준어다).
 */

/** 리포트를 이루는 세 축의 이름 — 화면·도우미가 같은 말을 쓴다 */
export const REPORT = {
  /** 무엇을 세나 */
  metric: '지표',
  /** 무엇으로 쪼개나 — 화면에 이미 「쪼개 보는 기준」으로 떠 있다 */
  dimension: '쪼개는 기준',
  /**
   * 어느 날짜로 기간을 자르나.
   *
   * **사람이 고르지 않는다 — 지표가 정한다.** 같은 딜이 어느 날짜로 재느냐에 따라
   * 다른 달에 서기 때문이다. 화면은 «고르는 칸»이 아니라 «밝히는 줄»로 쓴다.
   */
  dateBasis: '기준 날짜',
  /** 저장된 축 조합 */
  view: '뷰',
  /** 기간을 닫는 일 — 딜을 닫는 것(성사·실주)과 다르다 */
  close: '마감',
  title: '영업 리포트',
} as const

/**
 * 기준 날짜 다섯.
 *
 * 지표 선언이 이 중 하나를 고른다. 목록을 늘리려면 **딜에 그 날짜가 실제로 있어야**
 * 한다 — 없는 날짜를 기준으로 두면 그 지표는 언제나 빈 값이다.
 */
export type DateBasisKey = 'createdAt' | 'expectedCloseDate' | 'wonAt' | 'termSpread' | 'stageEnteredAt'

export const DATE_BASIS_LABEL: Record<DateBasisKey, string> = {
  createdAt: '만든 날',
  expectedCloseDate: '마감 예정일',
  wonAt: '따낸 날',
  /** 시작~종료에 나눠 담는다 — 한 날짜가 아니라 기간이라 이름이 다르다 */
  termSpread: '사업 기간',
  stageEnteredAt: '단계 진입일',
}

/** 왜 그 날짜인지 — 숫자가 달라 보일 때 사람이 읽을 한 줄 */
export const DATE_BASIS_HINT: Record<DateBasisKey, string> = {
  createdAt: '딜을 만든 날로 셉니다. 이번 달에 새로 들어온 것을 봅니다',
  expectedCloseDate: '마감 예정일로 셉니다. 아직 안 끝난 딜이 언제 끝날 예정인지를 봅니다',
  wonAt: '계약한 날로 셉니다. 5년 계약이면 계약한 달에 5년치가 통째로 들어갑니다',
  termSpread: '사업 기간에 나눠 셉니다. 5년 계약 5억이면 해마다 1억입니다',
  stageEnteredAt: '단계에 들어온 날로 셉니다. 어디서 얼마나 머물렀는지를 봅니다',
}

/**
 * `METRIC` 에 없던 지표의 이름.
 *
 * 여기 있는 것은 전부 **이미 있는 값의 뺄셈·나눗셈이거나 조건 하나 더한 조회**다.
 * 새 계산을 만든 것이 아니라 **이름이 없어서 못 부르던 것**에 이름을 준 것이다.
 */
export const METRIC_MORE = {
  /** 딜의 예산 칸 합계 — 고객이 말한 금액. 「리드 액수」라 부르지 않는다(`AMOUNT_LABEL` 이 이미 정했다) */
  budgetSum: '예산 합계',
  quotedSum: '견적 합계',
  contractSum: '계약 합계',
  /** 사업 기간에 나눠 담은 몫 — `business-report` 가 이미 내는 값 */
  recognized: '인식 매출',
  cash: '현금',
  /** 실적 ÷ 목표 */
  attainment: '달성률',
  /** 목표 − (수주 + 가중 예상). ~~갭~~ 금지 */
  shortfall: '부족분',
  /** 부족분 ÷ 승률 — 새로 만들어야 하는 파이프라인 규모 */
  neededNew: '필요 신규',
  /** 달성률 ÷ 기간 경과율. 이 속도로 가면 닿는가 */
  pace: '페이스',
  /** 마감 예정일이 지났는데 아직 열린 딜. 상태 라벨 「기한 지남」과 같은 말을 쓴다 */
  overdue: '기한 지난 딜',
  /** 단계에 들어온 뒤 오래 안 움직인 딜 */
  stalled: '정체 딜',
  /** 그 기간에 만들어진 딜 */
  newDeals: '신규 딜',
  /** 상위 몇 곳이 전체의 몇 퍼센트인가 */
  concentration: '집중도',
  /** 목표 자체를 지표처럼 쓴다 — 카드에 나란히 서기 때문 */
  target: '목표',
} as const

export type MetricMoreKey = keyof typeof METRIC_MORE

export const METRIC_MORE_HINT: Record<MetricMoreKey, string> = {
  budgetSum: '고객이 말한 금액의 합. 견적을 내기 전 단계의 규모입니다',
  quotedSum: '견적으로 나간 금액의 합',
  contractSum: '도장 찍은 금액의 합',
  recognized: '사업 기간에 나눠 담은 몫 중 이 기간에 걸린 것',
  cash: '현물을 뺀 금액. 실제로 들어오는 돈입니다',
  attainment: '실적을 목표로 나눈 값. 목표가 없으면 낼 수 없습니다',
  shortfall: '목표에서 수주와 가중 예상을 뺀 값. 지금 걸린 것을 다 따내도 남는 몫입니다',
  neededNew: '부족분을 승률로 나눈 값. 새로 만들어야 하는 파이프라인 규모입니다',
  pace: '달성률을 기간 경과율로 나눈 값. 1보다 작으면 이 속도로는 목표에 못 닿습니다',
  overdue: '마감 예정일이 지났는데 아직 열려 있는 딜. 예상의 신뢰도를 봅니다',
  stalled: '단계에 들어온 뒤 오래 움직이지 않은 딜. 어디서 막혔는지를 봅니다',
  newDeals: '그 기간에 새로 만들어진 딜. 건수와 금액을 같이 봐야 질이 보입니다',
  concentration: '상위 몇 곳이 전체의 몇 퍼센트인가. 한 고객에 매달려 있는지를 봅니다',
  target: '사업계획에서 정한 기준값. 설정에서 등록합니다',
}

/** 지표의 단위 — 지표가 정한다. 사람이 고르면 「수주 · 건」 같은 뜻 안 통하는 줄이 생긴다 */
export type UnitKey = 'money' | 'count' | 'place' | 'person' | 'unit' | 'percent' | 'times' | 'days'

export const UNIT_LABEL: Record<UnitKey, string> = {
  money: '원',
  count: '건',
  place: '곳',
  person: '명',
  /** 대수 — GPU 연동 대수 같은 것 */
  unit: '대',
  percent: '%',
  times: '배',
  days: '일',
}

/** 쪼개는 기준에서 값이 비어 있는 줄의 이름 — 숨기면 합이 안 맞는다 */
export const DIMENSION_EMPTY = '없음'

// ------------------------------------------------------------
// 문형 — 근거가 없을 때 무엇을 말하나
// ------------------------------------------------------------

/**
 * 목표가 없어 못 내는 지표.
 *
 * **0 으로 그리지 않는다.** 0 은 「목표가 0」으로 읽힌다.
 */
export const NO_TARGET = '목표가 필요합니다'
export const NO_TARGET_ACTION = '설정하기'

/** 표본이 얇아 못 내는 지표 — 숫자를 지어내지 않는다 */
export function notEnoughSample(what: string, have: number, needCounter = '건'): string {
  return `${what}이 ${have}${needCounter}뿐이라 아직 말씀드리기 어려워요`
}

/**
 * 쪼개는 기준의 값이 거의 안 채워져 있을 때.
 *
 * 축을 그리기는 하되 **뜻이 없다고 먼저 말한다** — 안 말하면 「없음 한 줄」을
 * 데이터가 없는 것으로 읽는다.
 */
export function dimensionThin(label: string, filled: number, total: number): string {
  return `${label}이 채워진 곳이 ${total}곳 중 ${filled}곳입니다. 이 기준은 아직 뜻이 없습니다`
}

/** 기준 날짜를 밝히는 줄 — 카드·표·내보내기가 같은 문장을 쓴다 */
export function basisLine(basis: DateBasisKey): string {
  return `기준 · ${DATE_BASIS_LABEL[basis]}`
}

// ------------------------------------------------------------
// 마감
// ------------------------------------------------------------

/** 마감 상태 셋. `StatusKey` 매핑은 `lib/crm/ui/report-close-status.ts` 가 한다 */
export type CloseStateKey = 'draft' | 'reviewing' | 'confirmed'

export const CLOSE_STATE_LABEL: Record<CloseStateKey, string> = {
  draft: '가마감',
  reviewing: '검토 중',
  confirmed: '확정',
}

export const CLOSE_STATE_HINT: Record<CloseStateKey, string> = {
  draft: '시스템이 다음 달 1일에 그달 값을 계산해 둡니다. 아직 고칠 수 있습니다',
  reviewing: '사람이 확인하는 중입니다. 딜을 고치면 값이 다시 계산됩니다',
  confirmed: '잠겼습니다. 이후 수정은 수정본으로 새로 만듭니다',
}

// ------------------------------------------------------------
// AI 도우미
// ------------------------------------------------------------

/**
 * 도우미의 이름.
 *
 * **새로 짓지 않았다** — 시스템 로그가 실행 종류를 이미 「CRM AI 도우미」라 부른다.
 * 화면에서만 다른 이름을 쓰면 로그를 보는 사람이 같은 것인 줄 모른다.
 */
export const ASSISTANT = {
  name: 'AI 도우미',
  /** 입력창에 뜨는 안내 — 되는 질문을 예로 든다. 빈 칸이면 무엇을 물어야 할지 모른다 */
  placeholder: '무엇이 궁금하세요?',
  /** 실행 전에 「이렇게 이해했습니다」를 보여준다. 없으면 숫자만 보고 무엇을 물었는지 잊는다 */
  readback: '이렇게 이해했습니다',
  /** 되돌릴 수 있는 쓰기를 실행하기 전 */
  confirmWrite: '실행 전 확인',
  cannot: '제가 못 하는 일입니다',
  working: '하는 중',
  /** 도우미가 스스로 말하는 자리 */
  notice: '눈에 띄는 것',
} as const

/**
 * 도우미가 못 하는 일을 말하는 문장.
 *
 * **막다른 답을 만들지 않는다** — 왜 못 하는지와 어디서 할 수 있는지를 함께 준다.
 * 이유 없이 거절하면 사용자는 다음부터 도우미를 안 쓴다.
 */
export function assistantCannot(what: string, why: string): string {
  return `${what}은 제가 바꾸지 못하게 되어 있습니다. ${why}`
}

/** 한 일과 못 한 일을 나눠 말한다 — 실패를 성공처럼 말하지 않는다 */
export function assistantDone(done: number, failed: number, counter = '건'): string {
  if (failed === 0) return `${done}${counter} 전부 됐습니다.`
  return `${done}${counter} 됐고 ${failed}${counter}은 못 했습니다.`
}
