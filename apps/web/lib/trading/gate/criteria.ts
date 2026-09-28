/**
 * 관문 — **1-B 에서 1-C 로 넘어가도 되나** (명세 §13.5)
 *
 * ## 세 가지 답이 있다
 *
 * 「통과」와 「미달」만 있으면 안 된다. **아직 못 잼**이 따로 있어야 한다 —
 * 표본 80건으로 「기대값 하한이 0 이하라 미달」이라고 말하면, 읽는 사람은
 * 전략이 나쁘다고 읽는다. 사실은 아직 아무것도 모르는 것이다.
 * 그 둘을 섞으면 멀쩡한 전략을 버리거나, 반대로 표본이 없는데 통과시킨다.
 *
 * ## 미달은 「얼마나」를 말한다
 *
 * 「PF 미달」로는 다음에 무엇을 할지 모른다. 「1.18 인데 1.25 가 필요하다」면
 * 얼마나 더 가야 하는지가 보인다.
 *
 * ## 기준값은 전부 설정에서 온다
 *
 * 관문 숫자를 코드에 박으면 화면이 말하는 기준과 실제로 재는 기준이 갈린다.
 */

export type CriterionStatus = 'pass' | 'fail' | 'insufficient'

export interface CriterionResult {
  id: string
  label: string
  status: CriterionStatus
  /** 실제로 잰 값. 못 쟀으면 null */
  actual: number | null
  /** 넘어야 하는 값 */
  required: number | null
  /** 사람이 읽을 한 줄 */
  detail: string
  /**
   * 못 잰 줄에 붙는 **할 일**. 잰 줄에는 없다.
   *
   * 사용자 지적 2026-09-28: 관문 열 줄이 전부 「아직 못 잼」인데 무엇을 하면 되는지가
   * 한 줄도 없었다. 「없습니다」만 있는 화면은 읽는 사람의 일을 늘리기만 한다.
   */
  how?: string
}

/**
 * 검증 한 바퀴가 돌아야 생기는 값들의 할 일 — **한 곳에 둔다.**
 *
 * 실측 2026-09-28: `/api/trading/cron/validate` 가 `vercel.json` 크론에 없어
 * **아무도 안 불렀다.** 그래서 봉이 쌓여도 거래가 영영 0건이었고 이 줄들이 전부 못 잼이었다.
 * 그 크론을 등록했으므로 이제 이 말이 참이 된다 — 안 등록했으면 이 문장은 거짓말이다.
 */
const RUN_VALIDATION = '봉이 더 쌓이면 밤마다 도는 검증이 거래를 만듭니다. 자료 화면에서 모인 봉을 볼 수 있습니다'

/**
 * 「무엇이 얼마나 모자란가」 — **같은 한 줄을 아홉 번 쓰지 않는다**
 *
 * 실측 2026-09-28: 못 잰 아홉 줄이 전부 같은 문장을 달고 있었다. 읽는 사람은
 * 아홉 번째쯤에서 그 줄을 안 읽게 되고, 그러면 안내가 있으나 없으나 같아진다.
 * 거래 수는 줄마다 같지만 **얼마나 모자란지는 숫자로 말할 수 있다.**
 */
function needTrades(have: number, need: number): string {
  return `검증 거래가 ${have}건입니다. ${need}건이 모이면 이 줄을 잽니다 — ${RUN_VALIDATION}`
}

export interface GateThresholds {
  minValidateTrades: number
  minLockboxTrades: number
  minProfitFactor: number
  /** MDD 상한 = 일일 손실 한도 × 이 배수 */
  maxDrawdownLimitMultiple: number
  dailyLossLimitKrw: number
  /** 판단기 비교 최소 개선폭(R) */
  minJudgeImprovementR: number
}

export interface GateInput {
  thresholds: GateThresholds
  /** 개발 구간 검증 합계 */
  validateTradeCount: number
  lockboxTradeCount: number
  /** 검증 구간 기대값 신뢰구간 */
  validateExpectancy: { estimate: number; lower: number; upper: number } | null
  /** Lockbox 기대값. 부호가 유지되고 검증 구간 추정 범위 안이어야 한다 */
  lockboxExpectancy: { estimate: number; lower: number; upper: number } | null
  /** 가혹 슬리피지 + 긴 지연에서의 기대값 */
  harshExpectancyR: number | null
  profitFactor: number | null
  maxDrawdownR: number | null
  /** 1R 이 몇 원인가. MDD 를 원으로 바꾸는 데 쓴다 */
  riskPerTradeKrw: number | null
  calibration: { betterThanBaseRate: boolean; monotonic: boolean; insufficient: boolean } | null
  judgeComparison: { better: boolean; reason: string } | null
  riskArithmeticOk: boolean | null
}

export interface GateVerdict {
  passed: boolean
  criteria: CriterionResult[]
  /** 아직 못 잰 항목 수. 0 이 아니면 「미달」이라고 말하면 안 된다 */
  insufficientCount: number
  failedCount: number
}

function pass(id: string, label: string, actual: number | null, required: number | null, detail: string): CriterionResult {
  return { id, label, status: 'pass', actual, required, detail }
}
function fail(id: string, label: string, actual: number | null, required: number | null, detail: string): CriterionResult {
  return { id, label, status: 'fail', actual, required, detail }
}
function unknown(
  id: string, label: string, detail: string,
  actual: number | null = null, required: number | null = null,
  how: string = RUN_VALIDATION,
): CriterionResult {
  return { id, label, status: 'insufficient', actual, required, detail, how }
}

export function evaluateGate(input: GateInput): GateVerdict {
  const t = input.thresholds
  const criteria: CriterionResult[] = []

  // ① 거래 수
  criteria.push(
    input.validateTradeCount >= t.minValidateTrades
      ? pass('trade_count', '거래 수', input.validateTradeCount, t.minValidateTrades,
        `검증 합계 ${input.validateTradeCount}건`)
      : unknown('trade_count', '거래 수', 
        `검증 합계가 ${input.validateTradeCount}건입니다. ${t.minValidateTrades}건이 모여야 나머지를 잴 수 있습니다`,
        input.validateTradeCount, t.minValidateTrades),
  )
  criteria.push(
    input.lockboxTradeCount >= t.minLockboxTrades
      ? pass('lockbox_count', '최종 검증 거래 수', input.lockboxTradeCount, t.minLockboxTrades,
        `${input.lockboxTradeCount}건`)
      : unknown('lockbox_count', '최종 검증 거래 수',
        `${input.lockboxTradeCount}건입니다. ${t.minLockboxTrades}건이 필요합니다`,
        input.lockboxTradeCount, t.minLockboxTrades),
  )

  // ② 기대값 신뢰구간 하한
  if (!input.validateExpectancy) {
    criteria.push(unknown('expectancy_lower', '기대값 하한', '아직 신뢰구간을 낼 표본이 없습니다',
      null, null, needTrades(input.validateTradeCount, t.minValidateTrades)))
  } else if (input.validateExpectancy.lower > 0) {
    criteria.push(pass('expectancy_lower', '기대값 하한', input.validateExpectancy.lower, 0,
      `하한 ${input.validateExpectancy.lower.toFixed(3)}R`))
  } else {
    criteria.push(fail('expectancy_lower', '기대값 하한', input.validateExpectancy.lower, 0,
      `하한이 ${input.validateExpectancy.lower.toFixed(3)}R 입니다. 0 을 넘어야 합니다`))
  }

  // ②' Lockbox 는 부호 유지 + 검증 구간 추정 범위 안
  if (!input.lockboxExpectancy || !input.validateExpectancy) {
    criteria.push(unknown('lockbox_consistency', '최종 검증 일관성', '아직 최종 검증을 열지 않았습니다',
      null, null, '앞 관문을 지난 뒤에 열립니다. 먼저 학습·검증 구간 성적이 기준을 넘어야 합니다'))
  } else {
    const sameSign = Math.sign(input.lockboxExpectancy.estimate) === Math.sign(input.validateExpectancy.estimate)
    const inRange = input.lockboxExpectancy.estimate >= input.validateExpectancy.lower
      && input.lockboxExpectancy.estimate <= input.validateExpectancy.upper
    criteria.push(sameSign && inRange
      ? pass('lockbox_consistency', '최종 검증 일관성', input.lockboxExpectancy.estimate, null,
        `${input.lockboxExpectancy.estimate.toFixed(3)}R — 검증 구간 범위 안`)
      : fail('lockbox_consistency', '최종 검증 일관성', input.lockboxExpectancy.estimate, null,
        `${input.lockboxExpectancy.estimate.toFixed(3)}R 이 검증 구간 `
        + `[${input.validateExpectancy.lower.toFixed(3)}, ${input.validateExpectancy.upper.toFixed(3)}] 밖이거나 부호가 다릅니다`))
  }

  // ③ 가혹 조건
  if (input.harshExpectancyR === null) {
    criteria.push(unknown('harsh_slippage', '가혹 슬리피지', '아직 가혹 조건으로 안 돌렸습니다',
      null, null, needTrades(input.validateTradeCount, t.minValidateTrades)))
  } else {
    criteria.push(input.harshExpectancyR > 0
      ? pass('harsh_slippage', '가혹 슬리피지', input.harshExpectancyR, 0,
        `${input.harshExpectancyR.toFixed(3)}R`)
      : fail('harsh_slippage', '가혹 슬리피지', input.harshExpectancyR, 0,
        `가혹 조건에서 ${input.harshExpectancyR.toFixed(3)}R 입니다. 가정이 조금만 나빠져도 뒤집히는 전략입니다`))
  }

  // ④ Profit Factor
  if (input.profitFactor === null) {
    /*
      거래가 한 건도 없는 것과 「졌던 거래가 없다」는 다른 사실이다.
      0 건인데 뒤엣말을 적으면 이긴 거래는 있었던 것처럼 읽힌다.
    */
    criteria.push(unknown('profit_factor', 'Profit Factor',
      input.validateTradeCount === 0
        ? '아직 잴 거래가 없습니다'
        : '잃은 거래가 없어 아직 측정할 수 없습니다',
      null, null,
      input.validateTradeCount === 0
        ? needTrades(input.validateTradeCount, t.minValidateTrades)
        : RUN_VALIDATION))
  } else {
    criteria.push(input.profitFactor >= t.minProfitFactor
      ? pass('profit_factor', 'Profit Factor', input.profitFactor, t.minProfitFactor,
        input.profitFactor.toFixed(3))
      : fail('profit_factor', 'Profit Factor', input.profitFactor, t.minProfitFactor,
        `${input.profitFactor.toFixed(3)} 입니다. ${t.minProfitFactor} 가 필요합니다`))
  }

  // ⑤ MDD
  if (input.maxDrawdownR === null || input.riskPerTradeKrw === null) {
    criteria.push(unknown('max_drawdown', '최대 낙폭', '아직 낙폭을 낼 거래가 없습니다',
      null, null, needTrades(input.validateTradeCount, t.minValidateTrades)))
  } else {
    const drawdownKrw = input.maxDrawdownR * input.riskPerTradeKrw
    const limit = t.dailyLossLimitKrw * t.maxDrawdownLimitMultiple
    criteria.push(drawdownKrw <= limit
      ? pass('max_drawdown', '최대 낙폭', drawdownKrw, limit,
        `${Math.round(drawdownKrw).toLocaleString('ko-KR')}원`)
      : fail('max_drawdown', '최대 낙폭', drawdownKrw, limit,
        `${Math.round(drawdownKrw).toLocaleString('ko-KR')}원으로 상한 `
        + `${Math.round(limit).toLocaleString('ko-KR')}원을 넘습니다`))
  }

  // ⑥ 보정
  if (!input.calibration || input.calibration.insufficient) {
    criteria.push(unknown('calibration', '보정', '보정을 판정할 표본이 모자랍니다',
      null, null, needTrades(input.validateTradeCount, t.minValidateTrades)))
  } else {
    const ok = input.calibration.betterThanBaseRate && input.calibration.monotonic
    criteria.push(ok
      ? pass('calibration', '보정', null, null, 'Brier 가 기저율보다 낫고 구간 승률이 오름차순입니다')
      : fail('calibration', '보정', null, null,
        input.calibration.betterThanBaseRate
          ? '구간 승률이 오름차순이 아닙니다'
          : 'Brier 가 기저율보다 나쁩니다 — 그 확률은 아무 정보도 안 줍니다'))
  }

  // ⑦ 판단기 비교
  if (!input.judgeComparison) {
    /*
      실측 2026-09-28: 여기가 「설정에서 AI 판단 모델을 고르면」이라고 적고 있었는데
      모델은 이미 골라져 있었고 두 판단기가 하루에 44건씩 **나란히 기록되고 있었다.**
      이미 한 일을 시키면 사람은 그것을 또 하고, 그래도 안 바뀌니 화면을 안 믿게 된다.

      비교에 정말 모자란 것은 판단기가 아니라 **짝지을 거래**다(§13.4: 같은 날짜끼리
      짝지은 차이의 신뢰구간). 그래서 모자란 것을 그대로 적는다.
    */
    criteria.push(unknown('judge_comparison', '판단기 비교',
      '두 판단기의 점수는 쌓이고 있지만 아직 짝지어 비교할 거래가 없습니다',
      null, null, needTrades(input.validateTradeCount, t.minValidateTrades)))
  } else {
    criteria.push(input.judgeComparison.better
      ? pass('judge_comparison', '판단기 비교', null, t.minJudgeImprovementR, input.judgeComparison.reason)
      : fail('judge_comparison', '판단기 비교', null, t.minJudgeImprovementR,
        `다른 판단기보다 낫다고 말할 수 없습니다 (${input.judgeComparison.reason})`))
  }

  // ⑧ 리스크 산술
  if (input.riskArithmeticOk === null) {
    /*
      이 줄이 못 잼으로 남는 경우는 하나다 — **상품 규격을 못 읽은 것**.
      손절 폭과 한도는 설정에 기본값이 있어 비어 있을 수 없다. 그런데도 「하루 목표와
      감당할 손실을 정하면」이라고 적으면, 이미 정해 둔 사람에게 또 정하라고 말하게 된다.
    */
    criteria.push(unknown('risk_arithmetic', '리스크 산술',
      '상품 규격을 못 읽어 한 거래에 얼마가 걸리는지 아직 못 구했습니다',
      null, null, '설정의 상품에서 어떤 상품인지 고르면 잽니다. 거래가 쌓이기 전에도 잴 수 있는 줄입니다'))
  } else {
    criteria.push(input.riskArithmeticOk
      ? pass('risk_arithmetic', '리스크 산술', null, null, '§9 를 통과합니다')
      : fail('risk_arithmetic', '리스크 산술', null, null,
        '이 상품·손절·한도로는 신호가 나갈 수 없습니다'))
  }

  const failedCount = criteria.filter((c) => c.status === 'fail').length
  const insufficientCount = criteria.filter((c) => c.status === 'insufficient').length
  return {
    // 하나라도 미달이거나 못 쟀으면 통과가 아니다
    passed: failedCount === 0 && insufficientCount === 0,
    criteria,
    insufficientCount,
    failedCount,
  }
}
