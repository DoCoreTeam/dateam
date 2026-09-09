/**
 * 지표 선언 — SSOT
 *
 * **왜 선언인가**: 지표를 하나 더할 때마다 계산 함수를 새로 쓰면, 그 지표는 **자기가
 * 태어난 화면에서만** 산다. 기간으로 못 자르고 다른 기준으로 못 쪼갠다.
 * 실제로 그렇게 됐다 — 파이프라인·예상·소요 셋은 인자가 파이프라인 하나뿐이라
 * 「이번 분기 공공 예상」에 답하지 못했다.
 *
 * 그래서 지표를 **네 가지 답**으로 적는다:
 *   ① 어떤 딜을 세나(scope) ② 무엇을 더하나(value) ③ 어느 날짜로 기간을 자르나(dateBasis)
 *   ④ 어떻게 모으나(agg)
 * 집계 엔진 하나가 이 네 답을 읽어 전부 처리한다. 지표를 더하는 일이 **줄 하나**가 된다.
 *
 * **이 파일은 순수하다** — DB 도 Prisma 도 모른다. 화면(클라이언트)과 서비스(서버)가
 * 같은 목록을 봐야 하기 때문이다(`business-type.ts` 가 같은 이유로 분리돼 있다).
 *
 * **말은 여기서 짓지 않는다.** 이름은 `METRIC`(report-axis) 과 `METRIC_MORE`(terms/report)
 * 에서 온다 — 같은 것을 두 이름으로 부르면 한쪽만 고쳐진다.
 */

import { METRIC, METRIC_HINT } from './report-axis.ts'
import {
  METRIC_MORE, METRIC_MORE_HINT,
  type DateBasisKey, type UnitKey,
} from '../../terms/report.ts'

/** 어떤 딜을 세나 */
export type MetricScope =
  /** 아직 안 끝난 딜 */
  | 'OPEN'
  /** 성사된 딜 */
  | 'WON'
  /** 실패한 딜 */
  | 'LOST'
  /** 끝난 딜(성사+실패) — 승률의 분모 */
  | 'CLOSED'
  /** 전부 */
  | 'ALL'

/**
 * 어느 금액 칸을 더하나.
 *
 * **네 칸이 따로 있는 이유**: 확실성이 다른 네 숫자다. `pickBooked` 는 그중
 * «가장 확실한 것» 하나를 고르는데, 그건 **수주를 셀 때만** 맞는 규칙이다.
 * 「견적으로 나간 총액」을 물으려면 접기 전 값을 따로 읽어야 한다.
 */
export type AmountField = 'booked' | 'budget' | 'quoted' | 'contract'

/** 조건 하나 더 — 대상 집합을 좁힌다 */
export type MetricFilterKind =
  /** 마감 예정일이 오늘보다 앞선 것 */
  | 'overdue'
  /** 단계에 들어온 지 오래된 것. 기준 일수는 설정에서 온다 */
  | 'stalled'

export interface MetricDecl {
  key: string
  label: string
  hint: string
  unit: UnitKey
  scope: MetricScope
  /** 금액을 더하면 그 칸 이름, 건수를 세면 null */
  amount: AmountField | null
  /** 단계 성사확률을 곱하나 */
  weighted: boolean
  dateBasis: DateBasisKey
  agg: 'sum' | 'count'
  filter?: MetricFilterKind
  /**
   * 이 숫자를 말하려면 표본이 몇 개 있어야 하나.
   *
   * 없으면 표본과 무관하게 낸다(합계는 1건이어도 맞는 값이다).
   * 비율·중앙값처럼 **적은 표본에서 뜻이 없어지는 것**에만 건다.
   */
  minSample?: number
}

/**
 * 파생 지표 — 다른 지표의 뺄셈·나눗셈.
 *
 * 따로 두는 이유: 이것들은 **DB 를 안 읽는다.** 이미 나온 값으로 계산하므로
 * 집계 엔진이 한 번 더 돌 필요가 없고, 목표처럼 DB 밖에서 오는 값과도 섞을 수 있다.
 */
export interface DerivedDecl {
  key: string
  label: string
  hint: string
  unit: UnitKey
  /** 계산에 필요한 값들 — 하나라도 없으면 «아직 모름» */
  needs: readonly string[]
}

/**
 * 지표 목록.
 *
 * 순서는 **영업이 말하는 순서**다 — 아직 안 판 것에서 판 것으로.
 * 화면이 이 순서를 그대로 쓴다.
 */
export const METRICS: readonly MetricDecl[] = [
  {
    key: 'budget_sum', label: METRIC_MORE.budgetSum, hint: METRIC_MORE_HINT.budgetSum,
    unit: 'money', scope: 'OPEN', amount: 'budget', weighted: false,
    dateBasis: 'expectedCloseDate', agg: 'sum',
  },
  {
    key: 'quoted_sum', label: METRIC_MORE.quotedSum, hint: METRIC_MORE_HINT.quotedSum,
    unit: 'money', scope: 'OPEN', amount: 'quoted', weighted: false,
    dateBasis: 'expectedCloseDate', agg: 'sum',
  },
  {
    key: 'contract_sum', label: METRIC_MORE.contractSum, hint: METRIC_MORE_HINT.contractSum,
    unit: 'money', scope: 'OPEN', amount: 'contract', weighted: false,
    dateBasis: 'expectedCloseDate', agg: 'sum',
  },
  {
    key: 'open_pipeline', label: METRIC.openPipeline, hint: METRIC_HINT.openPipeline,
    unit: 'money', scope: 'OPEN', amount: 'booked', weighted: false,
    dateBasis: 'expectedCloseDate', agg: 'sum',
  },
  {
    key: 'weighted', label: METRIC.weighted, hint: METRIC_HINT.weighted,
    unit: 'money', scope: 'OPEN', amount: 'booked', weighted: true,
    dateBasis: 'expectedCloseDate', agg: 'sum',
  },
  {
    key: 'bookings', label: METRIC.bookings, hint: METRIC_HINT.bookings,
    unit: 'money', scope: 'WON', amount: 'booked', weighted: false,
    dateBasis: 'wonAt', agg: 'sum',
  },
  {
    key: 'recognized', label: METRIC_MORE.recognized, hint: METRIC_MORE_HINT.recognized,
    unit: 'money', scope: 'WON', amount: 'booked', weighted: false,
    dateBasis: 'termSpread', agg: 'sum',
  },
  {
    key: 'won_count', label: `성사 ${'건수'}`, hint: '이 기간에 성사된 딜 수',
    unit: 'count', scope: 'WON', amount: null, weighted: false,
    dateBasis: 'wonAt', agg: 'count',
  },
  {
    key: 'lost_count', label: `실주 ${'건수'}`, hint: '이 기간에 실패로 기록된 딜 수',
    unit: 'count', scope: 'LOST', amount: null, weighted: false,
    dateBasis: 'wonAt', agg: 'count',
  },
  {
    key: 'new_deals', label: METRIC_MORE.newDeals, hint: METRIC_MORE_HINT.newDeals,
    unit: 'count', scope: 'ALL', amount: null, weighted: false,
    dateBasis: 'createdAt', agg: 'count',
  },
  {
    key: 'new_deals_amount', label: `${METRIC_MORE.newDeals} 금액`, hint: '그 기간에 만들어진 딜의 금액 합. 건수만 보면 질을 못 본다',
    unit: 'money', scope: 'ALL', amount: 'booked', weighted: false,
    dateBasis: 'createdAt', agg: 'sum',
  },
  {
    key: 'overdue', label: METRIC_MORE.overdue, hint: METRIC_MORE_HINT.overdue,
    unit: 'count', scope: 'OPEN', amount: null, weighted: false,
    dateBasis: 'expectedCloseDate', agg: 'count', filter: 'overdue',
  },
  {
    key: 'overdue_amount', label: `${METRIC_MORE.overdue} 금액`, hint: '기한이 지난 채 열려 있는 딜의 금액 합',
    unit: 'money', scope: 'OPEN', amount: 'booked', weighted: false,
    dateBasis: 'expectedCloseDate', agg: 'sum', filter: 'overdue',
  },
  {
    key: 'stalled', label: METRIC_MORE.stalled, hint: METRIC_MORE_HINT.stalled,
    unit: 'count', scope: 'OPEN', amount: null, weighted: false,
    dateBasis: 'stageEnteredAt', agg: 'count', filter: 'stalled',
  },
]

/**
 * 파생 지표.
 *
 * `needs` 에 적힌 것 중 하나라도 없으면 **«아직 모름»** 이다.
 * 목표가 없는데 0 으로 그리면 「목표가 0」으로 읽힌다.
 */
export const DERIVED: readonly DerivedDecl[] = [
  {
    key: 'attainment', label: METRIC_MORE.attainment, hint: METRIC_MORE_HINT.attainment,
    unit: 'percent', needs: ['bookings', 'target'],
  },
  {
    key: 'shortfall', label: METRIC_MORE.shortfall, hint: METRIC_MORE_HINT.shortfall,
    unit: 'money', needs: ['bookings', 'weighted', 'target'],
  },
  {
    key: 'coverage', label: METRIC.coverage, hint: METRIC_HINT.coverage,
    unit: 'times', needs: ['open_pipeline', 'bookings', 'target'],
  },
  {
    key: 'win_rate', label: METRIC.winRate, hint: METRIC_HINT.winRate,
    unit: 'percent', needs: ['won_count', 'lost_count'],
  },
  {
    key: 'needed_new', label: METRIC_MORE.neededNew, hint: METRIC_MORE_HINT.neededNew,
    unit: 'money', needs: ['shortfall', 'win_rate'],
  },
  {
    key: 'pace', label: METRIC_MORE.pace, hint: METRIC_MORE_HINT.pace,
    unit: 'percent', needs: ['attainment'],
  },
]

const BY_KEY: ReadonlyMap<string, MetricDecl> = new Map(METRICS.map((m) => [m.key, m]))
const DERIVED_BY_KEY: ReadonlyMap<string, DerivedDecl> = new Map(DERIVED.map((d) => [d.key, d]))

export function metricOf(key: string): MetricDecl | null {
  return BY_KEY.get(key) ?? null
}
export function derivedOf(key: string): DerivedDecl | null {
  return DERIVED_BY_KEY.get(key) ?? null
}

/**
 * 이 이름이 우리가 아는 지표인가.
 *
 * **AI 도우미가 이 함수로 걸린다.** 모델이 「매출액」 같은 없는 이름을 만들어 오면
 * 여기서 막고 되묻는다 — 가장 비슷한 것으로 밀어 넣지 않는다.
 * 밀어 넣으면 근거 없는 추정이 우리 손을 거쳐 확정값이 된다.
 */
export function isKnownMetric(key: string): boolean {
  return BY_KEY.has(key) || DERIVED_BY_KEY.has(key)
}

/** 화면·도우미에 보여줄 전체 목록 — 이름과 뜻만 */
export function metricCatalog(): { key: string; label: string; hint: string; unit: UnitKey; derived: boolean }[] {
  return [
    ...METRICS.map((m) => ({ key: m.key, label: m.label, hint: m.hint, unit: m.unit, derived: false })),
    ...DERIVED.map((d) => ({ key: d.key, label: d.label, hint: d.hint, unit: d.unit, derived: true })),
  ]
}

/**
 * 목표를 걸 수 있는 지표인가.
 *
 * 파생 지표에는 목표를 걸지 않는다 — 「달성률 목표 100%」는 「수주 목표」를 돌려 말한 것이라
 * 같은 것을 두 줄로 적게 만든다. 그리고 «기한 지난 딜 목표»처럼 **적을수록 좋은 것**도 뺀다.
 */
const NO_TARGET_METRICS: ReadonlySet<string> = new Set(['overdue', 'overdue_amount', 'stalled', 'lost_count'])

export function canHaveTarget(key: string): boolean {
  return BY_KEY.has(key) && !NO_TARGET_METRICS.has(key)
}

export function targetableMetrics(): MetricDecl[] {
  return METRICS.filter((m) => canHaveTarget(m.key))
}
