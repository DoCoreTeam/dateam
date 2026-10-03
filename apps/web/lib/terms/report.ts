/**
 * 영업 리포트의 말 — SSOT (용어집 §03-3)
 *
 * **왜 여기인가**: 리포트의 숫자는 화면 하나가 아니라 **요약 카드·교차표·추이·마감·
 * 내보내기·AI 도우미**가 함께 읽는다. 화면마다 「갭」·「부족분」·「미달」로 갈리면
 * 사용자는 같은 숫자를 다른 것으로 읽고, 도우미는 어느 이름으로 답해야 할지 모른다.
 *
 * **지표 이름은 여기서 새로 짓지 않는다.** `domain/metric-labels.ts` 의 `METRIC` 이
 * 이미 일곱을 정의했다(수주·열린 파이프라인·가중 예상·승률·평균 소요·수주잔고·
 * 파이프라인 배수, `domain/report-axis.ts` 가 재수출한다). 여기 있는 것은 **그 목록에
 * 없던 말**뿐이다. 같은 것을 두 이름으로 부르는 순간 한쪽만 고쳐지고, 그때부터 두
 * 화면이 다른 제품이 된다.
 *
 * **금지어**: `갭`(부족분) · `커버리지`(파이프라인 배수) · `타깃`·`쿼터`(목표) ·
 * `세그먼트`(고객 구분) · `차원`·`각도`(쪼개는 기준) · `시계`·`날짜축`(기준 날짜) ·
 * `연체`(기한 지남 — 상태 라벨이 이미 표준어다) ·
 * `안 판 것`·`판 것`·`봐야 할 것`(진행 중·실적·주의 — 구어체는 보고서에 옮겨 적을 수 없다).
 */

import { iGa } from '../ui/josa.ts'

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

  /* ── 기간 ─────────────────────────────────────── */
  /** 기간 묶음의 이름: 읽어 주는 장치가 이 말로 읽는다 */
  period: '기간',
  /**
   * 한 칸 뒤로·앞으로.
   *
   * 「지난 분기」라고 쓰지 않는다. 분기를 보고 있을 때만 맞는 말이고
   * 월을 보고 있으면 거짓말이 된다. 무엇을 보고 있든 맞는 말을 쓴다.
   *
   * 글자는 저장소가 이미 쓰는 것을 따랐다. 캘린더가 「이전 {단위}」,
   * 주간보고가 「이전 주」, 목록 넘기기가 「이전 페이지」로 쓴다.
   */
  periodPrev: '이전 기간',
  periodNext: '다음 기간',
  /** 견줄 대상을 고르는 묶음의 이름 */
  compare: '비교',
} as const

// ------------------------------------------------------------
// 기간의 이름: SSOT
// ------------------------------------------------------------

/**
 * 기간 종류 넷의 이름.
 *
 * **왜 용어집에 있나**: 같은 네 종류의 이름이 세 곳에 따로 적혀 있었다.
 * `domain/target.ts` 의 표, `reports/MetricsClient.tsx` 안의 목록, 그리고 같은
 * 화면 아래쪽의 삼항 연산자(실측 2026-10-03). 세 벌이면 한 벌만 고쳐지고,
 * 그때부터 같은 화면의 두 자리가 다른 말을 한다.
 *
 * 타입은 `domain/target.ts` 의 `PeriodKind` 가 들고 있다. 말은 여기, 규칙은 거기다.
 */
export const PERIOD_KIND_LABEL = {
  YEAR: '연간',
  HALF: '반기',
  QUARTER: '분기',
  /** 「연간」과 짝이 되는 말을 쓴다. 지표 탭이 이미 이 말을 썼고 목표 쪽만 「월」이었다 */
  MONTH: '월간',
} as const

export type PeriodKindKey = keyof typeof PERIOD_KIND_LABEL

/**
 * 고르는 칸에 서는 순서: **긴 것부터**.
 *
 * 순서도 말이다. 세 화면(현황 탭·지표 탭·목표 모달)이 각자 목록을 들고 있었고,
 * 하나에 종류를 더하면 나머지 둘에는 안 생겼다(실측 2026-10-03).
 */
export const PERIOD_KIND_ORDER: readonly PeriodKindKey[] = ['YEAR', 'HALF', 'QUARTER', 'MONTH']

/**
 * 고르는 칸의 이름: 「어느 분기인가」를 묻는 자리.
 *
 * 종류 이름과 **다른 말이다**. 종류는 「월간 단위로 본다」이고 칸은 「몇 월」을 묻는다.
 * 한 말로 합치면 칸 이름이 「월간」이 되어 묻는 것이 무엇인지 흐려진다.
 */
export function periodUnitLabel(kind: PeriodKindKey): string {
  if (kind === 'MONTH') return '월'
  // 연간은 고를 칸이 없다. 연도 칸이 그 자리를 이미 맡는다
  if (kind === 'YEAR') return ''
  return PERIOD_KIND_LABEL[kind]
}

/** 반기의 이름. 「1반기」라고 쓰지 않는다. 업무 문서가 쓰지 않는 말이다 */
export const PERIOD_HALF_LABEL = { 1: '상반기', 2: '하반기' } as const

/**
 * 달력에 없는 기간 하나.
 *
 * 「올해」는 1월에 물으면 한 달치지만 이것은 언제 물어도 열두 달치다.
 * 달력 기간과 **다른 질문**이라 이름도 따로 있다.
 */
export const ROLLING_12M_LABEL = '최근 12개월'

/**
 * 기간 안의 한 칸 이름: 「상반기」 「3분기」 「9월」.
 *
 * 맨숫자 `1` `2` 를 화면에 두지 않는다. 고르는 칸에 `1` 만 떠 있으면
 * 그것이 1분기인지 1월인지 읽는 사람이 라벨을 거슬러 올라가 맞춰야 한다.
 */
export function periodIndexLabel(kind: PeriodKindKey, index: number): string {
  if (kind === 'HALF') return PERIOD_HALF_LABEL[index === 1 ? 1 : 2]
  if (kind === 'QUARTER') return `${index}분기`
  if (kind === 'MONTH') return `${index}월`
  return ''
}

/**
 * 사람이 읽는 기간 이름: 「2026년」 「2026년 상반기」 「2026년 3분기」 「2026년 9월」.
 *
 * **한 가지 모양만 쓴다.** 예전에는 목표 화면이 「2026 3분기」, 리포트 현황 탭이
 * 「2026년 3분기」를 썼다. 같은 화면의 두 탭이 같은 기간을 다르게 적으면 읽는 쪽은
 * 둘이 같은 기간인지 알 길이 없고, 보고서에 옮겨 적을 때마다 다른 말이 된다
 * (실측 2026-10-03: `target.ts:49` 와 `report-axis.ts:142` 가 서로 다른 글자를 냈다).
 *
 * 연도 뒤에 「년」을 붙이는 쪽을 골랐다. 업무 문서가 그렇게 쓴다.
 */
export function periodText(kind: PeriodKindKey, year: number, index?: number): string {
  const head = `${year}년`
  if (kind === 'YEAR' || index === undefined) return head
  return `${head} ${periodIndexLabel(kind, index)}`
}

// ------------------------------------------------------------
// 비교 — 무엇과 견주나
// ------------------------------------------------------------

/**
 * 견주는 방식의 이름.
 *
 * **「전기」라고 쓰지 않는다.** 회계에서 쓰는 말이지만 이 저장소는 한자를 안 쓰므로
 * 그 두 글자가 전기요금 쪽으로도 읽힌다. 화면이 이미 「이전 기간」을 쓰고 있어
 * (`REPORT.periodPrev`) 같은 말을 쓴다. 한 화면에서 같은 기간을 두 이름으로
 * 부르면 둘이 같은 것인지 읽는 사람이 알 수 없다.
 *
 * 「전년 동기」는 그대로 쓴다. 업무 문서가 쓰는 말이고 다르게 읽힐 자리가 없다.
 */
export const COMPARE_LABEL = {
  PREV: '이전 기간',
  YOY: '전년 동기',
  NONE: '비교 없음',
} as const

export type CompareLabelKey = keyof typeof COMPARE_LABEL

/** 견줄 것이 없을 때. **「0%」라고 쓰지 않는다** — 0 은 「견줘 봤더니 같다」로 읽힌다 */
export const NO_COMPARE = '견줄 것 없음'

/**
 * 견준 결과를 한 줄로.
 *
 * 「없다」를 네 가지로 가른다. 한 말로 합치면 **처음 생긴 매출**과 **사라진 매출**이
 * 같은 말로 보이고, 둘은 영업이 해야 할 일이 정반대인 사실이다.
 */
export function compareNote(state: 'ok' | 'noPeriod' | 'noBase' | 'gone', compareLabel: string): string {
  if (state === 'noPeriod') return NO_COMPARE
  if (state === 'noBase') return `${compareLabel}에는 없었어요`
  if (state === 'gone') return `${compareLabel}에는 있었는데 이번에는 없어요`
  return ''
}

/**
 * 늘거나 줄어든 비율을 사람이 읽는 말로.
 *
 * 반올림해서 0 이 되는 변화를 「0%」로 적지 않는다. 그 글자는 「그대로다」로 읽히는데
 * 실제로는 조금 움직인 것이라, 다음 달에 같은 자리가 또 「0%」면 아무도 안 본다.
 */
export function deltaText(ratio: number): string {
  if (ratio === 0) return '변화 없음'
  const pct = ratio * 100
  const digits = Math.abs(pct) < 10 ? 1 : 0
  const shown = Number(pct.toFixed(digits))
  if (shown === 0) return '거의 그대로'
  return `${shown > 0 ? '+' : ''}${shown}%`
}

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
 * 첫 화면 카드 묶음 셋 — **뜻이 같은 지표끼리 모으는 이름**.
 *
 * 카드 여덟을 한 줄로 늘어놓으면 「38억」과 「0건」이 같은 무게로 읽힌다.
 * 묶음 이름이 그 무게를 갈라 준다.
 *
 * **업무 표준어로 적는다.** 예전엔 화면이 「아직 안 판 것 · 판 것 · 봐야 할 것」을
 * 직접 들고 있었다(사용자 지적 2026-09-09: 「용어집이 업무용 용어집으로 써야 할 거 아냐,
 * 통상적인」). 구어체는 두 가지가 문제다 —
 *   · 보고서·메일에 그대로 옮겨 적을 수 없다. 옮기는 사람이 매번 다른 말로 바꾼다
 *   · 「안 판 것」은 「못 판 것」으로도 읽혀, 진행 중인 딜이 실패로 보인다
 */
export type MetricGroupKey = 'open' | 'closed' | 'risk'

export const METRIC_GROUP_LABEL: Record<MetricGroupKey, string> = {
  /** 아직 안 끝난 딜. 저장소가 이미 「진행 중인 딜」로 부른다(`report-intent` 유의어) */
  open: '진행 중',
  /** 끝난 딜 — 수주와 실주를 함께 본다. 기간을 닫는 「마감」과 겹치지 않게 이 말을 쓴다 */
  closed: '실적',
  /** 예상을 믿을 수 없게 만드는 딜 */
  risk: '주의',
}

export const METRIC_GROUP_HINT: Record<MetricGroupKey, string> = {
  open: '이번 기간에 마감 예정인 딜',
  closed: '이번 기간에 끝난 딜 · 수주와 실주',
  risk: '예상의 신뢰도를 깎는 딜',
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

/**
 * 금액이 아닌 지표의 증감.
 *
 * **단위마다 맞는 말이 다르다.**
 *   · 비율 지표는 **퍼센트포인트**다. 40% 가 50% 가 된 것을 「+25%」라고 적으면
 *     비율의 비율이 되어 읽는 사람이 10 포인트 오른 것을 25 포인트로 읽는다
 *   · 건수는 **절대수**다. 2건이 3건이 된 것을 「+50%」라고 적으면 작은 수에서
 *     비율이 과장되어 「절반이 늘었다」로 읽힌다
 *   · 배수는 그대로 배로 적는다
 *
 * 금액은 이 함수를 안 쓴다. 통화를 합칠 수 없어 `compareSums` 가 통화별로 가른 뒤
 * `deltaText` 로 비율을 적는다 — 그래서 단위에서 `money` 를 뺀다.
 */
export function deltaByUnit(unit: Exclude<UnitKey, 'money'>, now: number, before: number | null): string {
  if (before === null) return NO_COMPARE
  const diff = now - before
  if (diff === 0) return '변화 없음'
  const sign = diff > 0 ? '+' : '-'
  const size = Math.abs(diff)
  if (unit === 'percent') return `${sign}${Number(size.toFixed(1))}%p`
  if (unit === 'times') return `${sign}${Number(size.toFixed(1))}${UNIT_LABEL.times}`
  return `${sign}${size.toLocaleString('ko-KR')}${UNIT_LABEL[unit]}`
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
export function dimensionThin(label: string, filled: number, total: number, counter = '건'): string {
  // 조사를 화면이 고르지 않는다 — 「기관 종류이」 같은 줄이 나온다(용어집 §0-2)
  return `${label}${iGa(label)} 채워진 것이 ${total}${counter} 중 ${filled}${counter}입니다. 이 기준은 아직 뜻이 없습니다`
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
