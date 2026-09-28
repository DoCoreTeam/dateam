/**
 * 현황·검증 화면이 관문에 넘길 값을 만든다 — **표에 있는 것은 표에서 읽는다**
 *
 * ## 무엇이 고장이었나
 *
 * `overview.ts` 는 `trading_backtest_runs` 에서
 * `net_expectancy_r, profit_factor, max_drawdown_krw` 를 **select 로 가져와 놓고 버렸다.**
 * 그리고 관문에는 아홉 자리 중 일곱을 고정 `null` 로 넘겼다. 관문은 null 을
 * 「아직 못 잼」으로 읽으므로, 검증 화면은 값이 있든 없든 언제나 열 줄이 전부
 * 「아직 못 잼」이었다. 사용자 지적 2026-09-28 「각 메뉴에도 정상적인 데이터가 안보이고」.
 *
 * ## 이 자리가 가르는 것
 *
 * 「표에 있는데 안 읽은 것」과 「표에 없어서 못 읽는 것」은 다르다.
 * 앞의 것은 고장이고 뒤의 것은 사실이다. 그래서 못 읽는 자리마다 **왜 못 읽는지**를
 * 주석으로 적어 둔다 — 안 적으면 다음 사람이 또 「그냥 null 이네」로 읽는다.
 *
 * ## 왕복을 안 한다
 *
 * 규칙만 두고 질의는 부르는 쪽에 남긴다. 판정을 질의 안에 섞으면 확인하려고
 * Supabase 를 세워야 하고, 그렇게 세운 시험은 규칙이 아니라 연결을 본다.
 */

import type { GateInput, GateThresholds } from './gate/criteria.ts'

/** `trading_backtest_runs` 의 요약 한 줄. 이 모듈이 쓰는 칸만 적는다 */
export interface BacktestRunRow {
  window_kind: string | null
  trade_count: number | string | null
  net_expectancy_r: number | string | null
  profit_factor: number | string | null
  max_drawdown_krw: number | string | null
}

/** 숫자 칸을 숫자로. 빈 문자열과 null 은 0 이 아니라 **없음**이다 */
function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function buildGateInput(input: {
  runs: BacktestRunRow[]
  thresholds: GateThresholds
  /**
   * 이 상품·설정에서 한 거래에 걸리는 돈.
   * `lib/trading/risk/arithmetic.ts` 의 `typicalTradeRisk` 가 유일한 출처다.
   */
  typicalRiskKrw: number | null
}): GateInput {
  const t = input.thresholds
  const of = (kind: string) => input.runs.filter((r) => r.window_kind === kind)
  const sumTrades = (kind: string) => of(kind).reduce((acc, r) => acc + (num(r.trade_count) ?? 0), 0)

  const validate = of('validate')
  /** 거래가 한 건도 없는 판은 요약 숫자가 있어도 아무 뜻이 없다 */
  const scored = validate.filter((r) => (num(r.trade_count) ?? 0) > 0)

  /** 가장 나쁜 쪽을 쓴다 — 여러 구간을 돌렸으면 관문은 그중 최악을 넘어야 한다 */
  const worstProfitFactor = scored
    .map((r) => num(r.profit_factor))
    .filter((v): v is number => v !== null)
    .reduce<number | null>((acc, v) => (acc === null || v < acc ? v : acc), null)

  const deepestDrawdownKrw = scored
    .map((r) => num(r.max_drawdown_krw))
    .filter((v): v is number => v !== null)
    .reduce<number | null>((acc, v) => (acc === null || v > acc ? v : acc), null)

  const risk = input.typicalRiskKrw !== null && input.typicalRiskKrw > 0 ? input.typicalRiskKrw : null

  return {
    thresholds: t,
    validateTradeCount: sumTrades('validate'),
    lockboxTradeCount: sumTrades('lockbox'),
    /*
      기대값 관문은 **신뢰구간의 아래끝**을 본다(§13.5). 요약 줄에는 점추정
      `net_expectancy_r` 하나뿐이고 구간은 안 적힌다. 점추정을 구간인 척 넣으면
      표본 한 줌으로도 관문이 열린다 — 그래서 안 넣는다.
      구간은 밤에 도는 검증이 그 자리에서 계산하고, 그 판정은 파이프라인이 낸다.
    */
    validateExpectancy: null,
    lockboxExpectancy: null,
    /*
      가혹 조건은 슬리피지 틱 수로 갈리는데 요약 줄에 그 칸이 안 실린다.
      어느 줄이 가혹인지 모르는 채 아무 줄이나 집으면 「가혹에서도 벌었다」가 거짓이 된다.
    */
    harshExpectancyR: null,
    profitFactor: worstProfitFactor,
    maxDrawdownR: deepestDrawdownKrw !== null && risk !== null ? deepestDrawdownKrw / risk : null,
    riskPerTradeKrw: risk,
    /* 보정은 `trading_calibrations` 에 따로 산다. 이 표에는 없다 */
    calibration: null,
    /*
      판단기 비교는 **같은 날짜끼리 짝지은 차이의 신뢰구간**이다(§13.4).
      요약 줄끼리 빼면 짝이 안 맞는 날이 섞여 차이가 부풀거나 줄어든다.
      두 판단기가 나란히 기록되고 있다는 사실과 비교가 끝났다는 사실은 다르다.
    */
    judgeComparison: null,
    /*
      리스크 산술만은 **거래가 0건이어도 잴 수 있다.** 설정과 상품 규격만으로 정해지고,
      여기서 막히면 신호가 한 건도 못 나가므로 가장 먼저 보여야 하는 줄이다.
    */
    riskArithmeticOk: risk === null ? null : t.dailyLossLimitKrw >= risk,
  }
}
