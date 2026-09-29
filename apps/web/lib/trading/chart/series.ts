/**
 * 봉과 신호를 **한 그림이 읽을 수 있는 한 벌로** 바꾼다 — `server-only` 밖에 있다
 *
 * 사용자 지적 2026-09-28: 「차트 보이고 예측한 답은 어디서 보는 거야? 그게 메인이어야
 * 될 텐데」. 지금까지 현황은 숫자 표였다. 가격이 어디로 갔고 우리가 어디서 무엇을
 * 말했는지는 표 두 개를 눈으로 맞춰야 알 수 있었고, 그래서 아무도 안 맞춰 봤다.
 *
 * ## 왜 여기인가
 *
 * 봉을 그림 좌표로 바꾸는 일은 **한 곳에만 있어야 한다.** 화면마다 적으면 축 범위가
 * 서로 달라지고, 같은 봉이 화면에 따라 다른 높이로 그려진다. 그 순간 그림은
 * 근거가 아니라 인상이 된다.
 *
 * 그리고 **없을 때 무엇을 말할지가 이 모듈의 절반이다.** 빈 차트를 그리면 사람은
 * 「값이 0이구나」로 읽는다. 실제로는 봉이 한 줄도 안 들어온 것이고, 그 둘은
 * 할 일이 완전히 다르다 (실측 2026-09-28 trading_bars 0행).
 */

import { readRunReason, type RunReasonLine } from '../operator/run-reason.ts'
import { leaningOf, type Leaning } from '../judgment-labels.ts'
import { formatKstAgo, kstDateKey } from '../../datetime/kst.ts'
import { computeIndicators, requiredBarCount, type IndicatorParams } from '../judge/indicators.ts'
import { buildExitPlan, type ExitPlanParams } from '../judge/exit-plan-math.ts'

/** 그림이 읽는 봉 한 개. 시각은 ISO 그대로 두고 눈금은 화면이 만든다 */
export interface ChartBar {
  at: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** 봉 위에 찍는 신호 표식 */
export interface ChartMark {
  signalId: string
  at: string
  /**
   * **어느 봉 위에 서나.** 신호 시각은 봉이 닫힌 때(`bar_close_at`)라
   * 봉이 시작한 때와 1분 어긋난다. 그 어긋남을 화면이 각자 맞추게 두면
   * 표식이 화면마다 한 칸씩 다른 자리에 선다 — 여기서 한 번만 정한다
   */
  barAt: string
  direction: 'long' | 'short'
  /** 그때 우리가 본 값 */
  price: number
  stopPrice: number
  targetPrice: number
  /** 보정 확률. 없으면 이 신호는 안 나갔어야 한다 */
  prob: number | null
  /** 순 기대값(R). 평균표가 정한 값이고, 못 쟀으면 null 이다 */
  evR: number | null
}

/**
 * 판단 하나를 봉 위에 찍는다.
 *
 * **신호와 다르다.** 신호는 안전 관문과 신호 규칙을 다 지난 것이고, 판단은 그 앞이다.
 * 실측 2026-09-28: 판단이 88건 나왔는데 신호는 0건이었다(관문이 닫혀 있었다).
 * 그런데 화면은 신호만 보고 「판단이 한 번도 안 돌았습니다」라고 말했다 — 거짓말이었다.
 */
export interface ChartCall {
  judgmentId: string
  at: string
  /** 어느 봉 위에 서나 */
  barAt: string
  direction: Leaning
  /** 기운 쪽의 원점수(0~1). 보정 전이라 확률이 아니다 */
  prob: number
  /** 어느 판단기가 낸 것인가 */
  judge: string
}

/**
 * 지금 화면 맨 위에 세울 답 하나.
 *
 * **신호가 있으면 신호가 이긴다** — 관문을 다 지난 것이라 판단보다 무겁다.
 * 없으면 가장 최근 판단을 보여 준다. 둘 다 없을 때만 「없다」고 한다.
 */
export interface NowCall {
  from: 'signal' | 'judgment'
  at: string
  direction: Leaning
  /** 신호면 보정 확률, 판단이면 기운 쪽 원점수. 못 잰 값이면 null */
  prob: number | null
  /** 판단에서 왔으면 어느 판단기인가 */
  judge: string | null
  /** 신호에서 왔을 때만 채워진다 — 판단에는 이 값들이 없다 */
  referencePrice: number | null
  stopPrice: number | null
  targetPrice: number | null
  evR: number | null
}

/**
 * 계획을 세우는 데 필요한 설정 한 벌 — **서버가 실어 보낸다**
 *
 * 화면이 배수를 직접 적으면 설정 화면에서 손절 배수를 바꿔도 현황은 옛 배수로 말한다.
 * 그 어긋남은 「화면이 말한 손절가에 걸었는데 시스템은 다른 값을 봤다」로 나타난다.
 */
export interface PlanParams extends IndicatorParams, ExitPlanParams {
  /** 신호가 난 뒤 들어갈 수 있는 동안(분). `signal_valid_minutes` */
  validMinutes: number
  /** 당일 청산 시각(ISO). 세션을 모르면 null — 만기일은 15:05, 평일은 15:20 이라 날마다 다르다 */
  sameDayExitAt: string | null
}

/**
 * 그 답대로 주문한다면 얼마에 들어가고 얼마에 끊고 얼마에 나오나.
 *
 * 사용자 지적 2026-09-29: 「내가 지금 주문을 어떻게 해야 하는지 모르겠어」.
 * 화면에는 「롱 · 원점수 85%」만 있었다. 방향과 점수는 판단이지 주문이 아니다.
 *
 * **값은 `buildExitPlan` 하나가 만든다**(M4). 화면이 식을 따로 적으면 백테스트가 재는
 * 전략과 화면이 말하는 전략이 갈리고, 갈린 날부터 성적은 안 도는 전략의 것이 된다.
 */
export interface CallPlan {
  direction: 'long' | 'short'
  /** 이 계획이 어느 봉을 기준으로 선 것인가 (ISO) */
  barAt: string
  /** 기준가 — 그 봉의 종가다 (§13.1) */
  referencePrice: number
  stopPrice: number
  targetPrice: number
  /**
   * 진입 한계가 — 여기를 넘으면 안 따라간다.
   * 신호 행에는 안 남는 값이라 기록에서 온 계획에는 null 이다
   */
  chaseLimitPrice: number | null
  /** 들어간 뒤 이 분이 지나면 시간 청산 */
  timeExitMinutes: number
  /** 당일 청산 시각(ISO). 모르면 null */
  sameDayExitAt: string | null
  /** 들어갈 수 있는 동안(분). 시각을 셈한 재료로만 남긴다 */
  validMinutes: number
  /**
   * **언제까지 들어갈 수 있나 (ISO).** 판단 시각 + `validMinutes`.
   *
   * 사용자 지적 2026-09-29 「분 이렇게 표시 하지 말고」 — 「10분」은 언제부터 10분인지
   * 읽는 사람이 판단 시각에 더해야 안다. 그 덧셈은 화면이 할 일이지 사람이 할 일이 아니다.
   */
  entryDeadlineAt: string | null
  /** 기록에 남은 계획인가, 지금 셈한 예고인가 */
  from: 'signal' | 'preview'
}

/**
 * 계획을 세울 재료. **지표를 못 구하면 null 이고 그 이유를 `planBlocked` 가 말한다.**
 *
 * 0 으로 때우지 않는 이유: ATR 이 0 이면 손절 거리가 0 이고 그것은 「즉시 손절」이라는
 * 뜻이 된다. 「손절 없음」과 「손절 모름」이 화면에서 같아 보이면 안 된다.
 */
export interface PlanBase {
  barAt: string
  referencePrice: number
  atr: number
  params: PlanParams
}

/**
 * 그 봉까지의 봉으로 계획 재료를 잰다 — **뒤 봉을 안 섞는다.**
 *
 * 실측 2026-09-29: 계획이 늘 **마지막 봉**을 기준으로 섰다. 09:58 판단의 그 봉 종가는
 * 1083.58 인데 화면은 10:03 봉의 1087.84 를 그렸고, 분이 갈 때마다 1086.64 · 1088.66 으로
 * 움직였다. 목표 폭이 2.44점인데 기준가가 4점 넘게 흔들린 것이다 — 화면을 보고 건 주문과
 * 시스템이 본 값이 달라진다.
 *
 * 뒤 봉을 섞으면 **그 시점에 세울 수 없던 계획**이 된다(미래 참조). 그래서 자른다.
 */
export function planBaseAt(
  bars: readonly ChartBar[],
  barAt: string,
  params: PlanParams | null,
): { base: PlanBase | null; blocked: string | null } {
  if (!params) return { base: null, blocked: '계획 설정을 못 읽었습니다' }
  const index = bars.findIndex((b) => b.at === barAt)
  if (index < 0) return { base: null, blocked: '그 봉을 차트에서 못 찾았습니다' }
  // 그 봉까지만. 슬라이스 끝이 그 봉이라 뒤 봉은 지표에 안 들어간다
  return planBaseOf(bars.slice(0, index + 1), params)
}

export interface ChartSeries {
  bars: ChartBar[]
  marks: ChartMark[]
  /** 신호로는 안 나갔지만 기록된 판단들. 봉 구간 안의 것만 */
  calls: ChartCall[]
  /**
   * 가격 축 범위. **봉과 신호를 함께 담고 여유까지 더한 값**이라
   * 화면은 이 값을 그대로 축에 넘기면 된다 — 같은 셈을 화면에서 또 하지 않는다.
   *
   * 신호까지 담는 이유: 손절가가 축 밖이면 「손절가가 멀다」와 「손절가가 없다」가
   * 화면에서 똑같아 보인다.
   */
  domain: [number, number] | null
  /** 그릴 것이 없으면 왜 없나. 있으면 null */
  blocked: RunReasonLine | null
  /**
   * 마지막 봉이 시작한 시각 (ISO). 없으면 null.
   *
   * **화면이 「지금 무엇을 기다리는지」를 말하려면 이 값이 있어야 한다.**
   * 1분 봉이라 데이터는 1분에 한 번 바뀐다 — 30초마다 다시 읽는다는 말만으로는
   * 사람이 「그래서 지금 뭘 하고 있나」를 못 읽는다 (사용자 지적 2026-09-28).
   */
  lastBarAt: string | null
  /**
   * 처음 그릴 구간 (`bars` 의 자리 번호, 양끝 포함). 봉이 0건이면 null.
   *
   * **오늘 봉이 기본이다.** 지금까지는 180봉을 날 안 가리고 그렸고, 장이 막 열린
   * 아침에는 그중 넷만 오늘 것이라 새 봉이 들어와도 화면이 안 움직였다
   * (사용자 지적 2026-09-29 「실시간 시스템처럼 차트가 움직여야」).
   *
   * 어제 것을 **버리지는 않는다** — 구간 띠로 넓히면 그대로 나온다.
   */
  window: { startIndex: number; endIndex: number } | null
  /**
   * 날이 바뀌는 자리 (`bars` 의 자리 번호와 그 날짜). 첫 봉은 안 센다.
   *
   * 경계 없이 이으면 어제 15:34 다음 칸이 오늘 09:03 이 되어 **밤새 가격이
   * 안 움직인 것처럼** 읽힌다 — 실제로는 열일곱 시간이 비어 있다.
   */
  dayBreaks: { index: number; at: string; dateLabel: string }[]
  /** 마지막 봉에서 잰 계획 재료. 못 재면 null */
  planBase: PlanBase | null
  /** 계획을 못 세운 이유. 세웠으면 null — 빈 칸으로 두면 「계획 없음」으로 읽힌다 */
  planBlocked: string | null
}

/**
 * 밖에서 온 값이라 숫자가 아닐 수 있다. 아니면 그 봉을 안 그린다.
 *
 * `Number(null)` 도 `Number('')` 도 **0 이다** — 그대로 통과시키면 값이 없던 봉이
 * 0원짜리 봉으로 그려지고 차트에 없던 폭락이 생긴다. 빈 것은 먼저 걸러낸다.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (typeof value === 'boolean') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export interface SeriesInput {
  /** 판단 기록. 신호가 0건이어도 이쪽은 쌓인다 */
  judgments?: readonly {
    id: string
    barCloseAt: string
    judge: string
    status: string
    rawScore: Record<string, number> | null
  }[]
  /** 오래된 것부터. 표에서 읽은 그대로 넣어도 된다 */
  bars: readonly {
    startAt: Date | string
    open: unknown; high: unknown; low: unknown; close: unknown
    volume?: unknown
  }[]
  /** 이 구간의 신호. 봉 범위 밖의 것은 알아서 떨어진다 */
  signals: readonly {
    id: string
    direction: 'long' | 'short'
    barCloseAt: string
    referencePrice: number
    stopPrice: number
    targetPrice: number
    calibratedProb: number | null
    netExpectedValueR: number | null
  }[]
  /**
   * 가장 최근 실행이 남긴 사유. **화면이 따로 판정하지 않는다** —
   * 운영 화면과 같은 함수로 읽어야 두 화면이 같은 말을 한다
   */
  lastRunReason: string | null
  /**
   * 계획 설정. 안 주면 계획을 안 세운다 — 기본 배수를 여기서 지어내면
   * 설정 화면이 말하는 값과 현황이 말하는 값이 갈린다
   */
  plan?: PlanParams
}

export function buildSeries(input: SeriesInput): ChartSeries {
  const bars: ChartBar[] = []
  for (const row of input.bars) {
    const open = num(row.open), high = num(row.high), low = num(row.low), close = num(row.close)
    // 넷 중 하나라도 모르면 그 봉은 안 그린다. 0 으로 채우면 없던 폭락이 생긴다
    if (open === null || high === null || low === null || close === null) continue
    const at = row.startAt instanceof Date ? row.startAt.toISOString() : String(row.startAt)
    if (!Number.isFinite(Date.parse(at))) continue
    bars.push({ at, open, high, low, close, volume: num(row.volume) })
  }
  bars.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  if (bars.length === 0) {
    return {
      bars: [], marks: [], calls: [], domain: null, lastBarAt: null,
      blocked: blockedLine(input.lastRunReason),
      window: null, dayBreaks: [],
      planBase: null, planBlocked: '가격 봉이 아직 없습니다',
    }
  }

  const from = Date.parse(bars[0].at)
  const to = Date.parse(bars[bars.length - 1].at)
  const marks: ChartMark[] = input.signals
    .filter((s) => {
      const at = Date.parse(s.barCloseAt)
      return Number.isFinite(at) && at >= from && at <= to
    })
    .map((s) => ({
      signalId: s.id,
      at: s.barCloseAt,
      barAt: barUnder(bars, Date.parse(s.barCloseAt)),
      direction: s.direction,
      price: s.referencePrice,
      stopPrice: s.stopPrice,
      targetPrice: s.targetPrice,
      prob: s.calibratedProb,
      evR: s.netExpectedValueR,
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  /**
   * 판단 표식. 같은 봉에 판단기가 둘(규칙·AI)이면 **둘 다 남긴다** —
   * 어느 쪽이 무엇을 봤는지가 보여야 비교가 된다.
   */
  const calls: ChartCall[] = (input.judgments ?? [])
    .filter((j) => {
      if (j.status !== 'completed') return false
      const at = Date.parse(j.barCloseAt)
      return Number.isFinite(at) && at >= from && at <= to
    })
    .map((j) => {
      const leaning = leaningOf(j.rawScore)
      return leaning
        ? {
          judgmentId: j.id,
          at: j.barCloseAt,
          barAt: barUnder(bars, Date.parse(j.barCloseAt)),
          direction: leaning.direction,
          prob: leaning.prob,
          judge: j.judge,
        }
        : null
    })
    .filter((c): c is ChartCall => c !== null)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  const values = [
    ...bars.flatMap((b) => [b.high, b.low]),
    ...marks.flatMap((m) => [m.price, m.stopPrice, m.targetPrice].filter((v) => Number.isFinite(v))),
  ]
  const plan = planBaseOf(bars, input.plan)
  return {
    bars,
    marks,
    calls,
    domain: axisDomain(Math.min(...values), Math.max(...values)),
    lastBarAt: bars[bars.length - 1].at,
    blocked: null,
    window: defaultWindow(bars, input.plan ? requiredBarCount(input.plan) : 0),
    dayBreaks: dayBreaksOf(bars),
    planBase: plan.base,
    planBlocked: plan.blocked,
  }
}

/**
 * 그 답이 서는 봉. 판단 시각은 봉이 **닫힌** 때라 그 봉은 시작이 그보다 앞인 마지막 봉이다
 * (표식을 찍는 `barUnder` 와 같은 규칙 — 두 곳이 다른 봉을 고르면 표식과 계획이 어긋난다).
 */
function callBarAt(call: NowCall, chart: ChartSeries): string {
  if (chart.bars.length === 0) return ''
  const at = Date.parse(call.at)
  if (!Number.isFinite(at)) return chart.bars[chart.bars.length - 1].at
  return barUnder(chart.bars, at)
}

/** 시각 + 분. 못 읽는 시각이나 0 이하 분이면 null — 지어낸 마감을 그리지 않는다 */
function deadlineOf(atIso: string, minutes: number): string | null {
  const at = Date.parse(atIso)
  if (!Number.isFinite(at) || !Number.isFinite(minutes) || minutes <= 0) return null
  return new Date(at + minutes * 60_000).toISOString()
}

/**
 * 처음 그릴 구간 — **마지막 날부터**.
 *
 * 지표를 구할 만큼 안 모였으면 그만큼 앞으로 거슬러 채운다. 오늘 봉 넷만 그리면
 * 화면은 「가격이 거의 안 움직였다」로 읽히고, 그것은 오늘 장의 사실이 아니라
 * 우리가 넷만 그린 사실이다.
 */
export function defaultWindow(
  bars: readonly ChartBar[],
  atLeast: number,
): { startIndex: number; endIndex: number } | null {
  if (bars.length === 0) return null
  const endIndex = bars.length - 1
  const lastDay = kstDateKey(bars[endIndex].at)
  let start = endIndex
  while (start > 0 && kstDateKey(bars[start - 1].at) === lastDay) start -= 1
  // 그 날 봉이 모자라면 앞날까지 거슬러 채운다
  const need = Math.max(1, atLeast)
  if (endIndex - start + 1 < need) start = Math.max(0, endIndex - need + 1)
  return { startIndex: start, endIndex }
}

/** 날이 바뀌는 자리. 첫 봉은 경계가 아니다 — 그 앞이 없으므로 「바뀌었다」고 말할 수 없다 */
export function dayBreaksOf(
  bars: readonly ChartBar[],
): { index: number; at: string; dateLabel: string }[] {
  const out: { index: number; at: string; dateLabel: string }[] = []
  for (let i = 1; i < bars.length; i += 1) {
    const day = kstDateKey(bars[i].at)
    if (day !== kstDateKey(bars[i - 1].at)) {
      // 연도는 안 적는다 — 차트가 보는 구간은 길어야 며칠이고 연도는 자리만 먹는다
      out.push({ index: i, at: bars[i].at, dateLabel: day.slice(5).replace('-', '/') })
    }
  }
  return out
}

/**
 * 마지막 봉에서 계획 재료를 잰다 — **지표는 판단기와 같은 함수로 구한다.**
 *
 * 화면이 ATR 을 따로 세면 같은 순간에 판단기와 화면이 다른 손절가를 말하게 되고,
 * 그때 사람은 어느 쪽에 걸어야 하는지 모른다.
 */
function planBaseOf(
  bars: readonly ChartBar[],
  params: PlanParams | undefined,
): { base: PlanBase | null; blocked: string | null } {
  if (!params) return { base: null, blocked: '계획 설정을 못 읽었습니다' }
  const need = requiredBarCount(params)
  if (bars.length < need) {
    // 몇 개가 모자란지까지 말한다. 「계획 없음」만으로는 기다리면 되는지 알 수 없다
    return { base: null, blocked: `지표를 구하려면 봉이 ${need}개 필요합니다 (지금 ${bars.length}개)` }
  }
  const atrBars = bars.map((b) => ({
    startAt: new Date(b.at), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0,
  }))
  const indicators = computeIndicators(atrBars, params)
  // 반쪽 지표로 계획을 세우지 않는다. 0 으로 때우면 손절 거리가 0 이 되고 「즉시 손절」이 된다
  if (!indicators || !Number.isFinite(indicators.atr) || indicators.atr <= 0) {
    return { base: null, blocked: '지표를 구하지 못했습니다' }
  }
  const last = bars[bars.length - 1]
  return {
    base: { barAt: last.at, referencePrice: last.close, atr: indicators.atr, params },
    blocked: null,
  }
}

/**
 * 그 답대로 주문한다면 어떤 값이 되나.
 *
 * **기록이 있으면 기록이 이긴다.** 신호로 나간 것은 그때 그 값으로 나갔고,
 * 지금 다시 셈하면 그 사이 봉이 바뀌어 화면이 신호와 다른 숫자를 말한다.
 *
 * 방향이 관망이면 null 이다 — 주문할 것이 없는데 가격을 그리면 그림이 거짓말을 한다.
 */
export function planForCall(call: NowCall, chart: ChartSeries): CallPlan | null {
  if (call.direction !== 'long' && call.direction !== 'short') return null

  if (call.from === 'signal'
    && call.referencePrice !== null && call.stopPrice !== null && call.targetPrice !== null) {
    return {
      direction: call.direction,
      barAt: call.at,
      referencePrice: call.referencePrice,
      stopPrice: call.stopPrice,
      targetPrice: call.targetPrice,
      // 신호 행에 안 남는 값이다. 모르면 모른다고 둔다
      chaseLimitPrice: null,
      timeExitMinutes: chart.planBase?.params.timeExitMinutes ?? 0,
      sameDayExitAt: chart.planBase?.params.sameDayExitAt ?? null,
      validMinutes: chart.planBase?.params.validMinutes ?? 0,
      entryDeadlineAt: deadlineOf(call.at, chart.planBase?.params.validMinutes ?? 0),
      from: 'signal',
    }
  }

  /**
   * **판단이 난 봉으로 센다.** `chart.planBase` 는 마지막 봉의 것이라 분마다 바뀐다 —
   * 같은 판단인데 볼 때마다 다른 값을 말하면 그것은 예고가 아니라 잡음이다.
   */
  const anchored = planBaseAt(chart.bars, callBarAt(call, chart), chart.planBase?.params ?? null)
  const base = anchored.base
  if (!base) return null
  /**
   * 당일 청산 시각은 세션 캘린더가 정한다. `buildExitPlan` 은 받은 값을 그대로 돌려줄
   * 뿐이라 여기서는 **가격 넷만 읽고** 시각은 설정에서 온 것을 그대로 쓴다.
   */
  const prices = buildExitPlan(call.direction, base.referencePrice, base.atr, base.params, new Date(base.barAt))
  return {
    direction: call.direction,
    barAt: base.barAt,
    referencePrice: base.referencePrice,
    stopPrice: prices.stopPrice,
    targetPrice: prices.targetPrice,
    chaseLimitPrice: prices.chaseLimitPrice,
    timeExitMinutes: prices.timeExitMinutes,
    sameDayExitAt: base.params.sameDayExitAt,
    validMinutes: base.params.validMinutes,
    /**
     * 마감은 **판단이 난 때**부터 센다. 기준 봉(`base.barAt`)이 아니다 —
     * 판단이 09:58 것인데 봉이 10:03 이면 마감을 5분 늦게 잡게 된다.
     */
    entryDeadlineAt: deadlineOf(call.at, base.params.validMinutes),
    from: 'preview',
  }
}

/**
 * 그 시각을 담는 봉. 신호는 봉이 **닫힌** 때를 적으므로 그 봉은
 * 시작 시각이 그보다 **앞**인 마지막 봉이다.
 */
function barUnder(bars: readonly ChartBar[], at: number): string {
  let found = bars[0].at
  for (const b of bars) {
    if (Date.parse(b.at) > at) break
    found = b.at
  }
  return found
}

/**
 * 봉이 0건일 때 **무엇이 막혔는지**를 실행 기록에서 뽑는다.
 *
 * 화면이 따로 판정하지 않는 이유: 운영 화면과 현황이 같은 사유를 다르게 읽으면
 * 사람은 두 화면 중 어느 쪽을 믿을지 정해야 하고, 대개 덜 나쁜 쪽을 믿는다.
 */
function blockedLine(reason: string | null): RunReasonLine {
  const view = readRunReason(reason)
  const blocked = view.lines.find((l) => l.tone === 'blocked')
  if (blocked) return blocked
  if (view.headline) return view.headline
  return { text: '아직 한 번도 안 돌았습니다', tone: 'waiting' }
}

/**
 * 축에 여유를 둔다 — 봉이 위아래 선에 딱 붙으면 폭이 실제보다 커 보인다.
 * 값이 하나뿐인 날(봉 한 개)에도 범위가 0 이 되지 않게 최소 폭을 준다.
 */
export function axisDomain(low: number | null, high: number | null): [number, number] | null {
  if (low === null || high === null || !Number.isFinite(low) || !Number.isFinite(high)) return null
  const span = high - low
  const pad = span === 0 ? Math.max(Math.abs(high) * 0.001, 0.01) : span * 0.08
  return [low - pad, high + pad]
}

/**
 * 지금 화면 맨 위에 세울 답 하나를 고른다.
 *
 * **사용자 지적 2026-09-28**: 판단 기록에는 「AI 판단 숏 90%」가 줄줄이 있는데
 * 현황은 「아직 판단이 없습니다 · 판단이 한 번도 안 돌았습니다」라고 말하고 있었다.
 * 화면이 신호(`trading_signals`)만 보고 판단(`trading_judgments`)을 안 봤기 때문이다.
 * 신호는 안전 관문을 다 지나야 나오는데 그 관문이 닫혀 있어 88건 대 0건이었다.
 *
 * **없는 것과 안 보여 준 것은 다르다.** 있는 것을 먼저 보여 준다.
 */
export function pickNowCall(input: {
  signals: readonly {
    direction: 'long' | 'short'
    barCloseAt: string
    referencePrice: number
    stopPrice: number
    targetPrice: number
    calibratedProb: number | null
    netExpectedValueR: number | null
  }[]
  calls: readonly ChartCall[]
}): NowCall | null {
  // 신호가 있으면 신호가 이긴다 — 관문을 다 지난 것이라 판단보다 무겁다
  const signal = input.signals[0]
  if (signal) {
    return {
      from: 'signal',
      at: signal.barCloseAt,
      direction: signal.direction,
      prob: signal.calibratedProb,
      judge: null,
      referencePrice: signal.referencePrice,
      stopPrice: signal.stopPrice,
      targetPrice: signal.targetPrice,
      evR: signal.netExpectedValueR,
    }
  }

  /**
   * 신호가 없으면 **가장 최근 판단**이다. 같은 봉에 판단기가 둘이면 AI 쪽을 앞세운다 —
   * 규칙은 수식이고 AI 는 그 판의 답이라, 사람이 「지금 예측」으로 읽는 것은 뒤쪽이다.
   */
  const latest = [...input.calls].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  if (!latest) return null
  const sameBar = input.calls.filter((c) => c.at === latest.at)
  const pick = sameBar.find((c) => c.judge !== 'rule') ?? latest
  return {
    from: 'judgment',
    at: pick.at,
    direction: pick.direction,
    prob: pick.prob,
    judge: pick.judge,
    referencePrice: null,
    stopPrice: null,
    targetPrice: null,
    evR: null,
  }
}

/**
 * 「지금 예측」이 정말 지금 것인가 — **아니면 언제 것인지 말한다**
 *
 * 실측 2026-09-28 오후 7시42분: 화면이 「지금 예측 · 시각 오후 03:26」이라고 적고 있었다.
 * 시각만 있고 날짜도 경과도 없어서, 장이 끝난 지 네 시간이 지난 판단이 방금 난 것처럼 보였다.
 * 다음 날 아침에 열면 **어제 것이 오늘 것으로 읽힌다** — 같은 화면이 날마다 거짓말을 한다.
 *
 * ## 갓 나온 것은 안 적는다
 *
 * 늘 「1분 전」이 붙어 있으면 그 글자는 배경이 되고, 정작 네 시간 전일 때도 안 읽힌다.
 * 판단 봉이 1분이라 몇 분 안쪽은 「지금」이라고 불러도 거짓이 아니다.
 *
 * ## 서버가 아니라 화면이 잰다
 *
 * 서버에서 재서 글자로 내려보내면 그 글자는 **찍힌 순간에 멈춘다.** 탭을 열어 둔 채
 * 한 시간이 지나도 「1분 전」이다. 그리고 서버 시각으로 만든 글자를 처음 그리면
 * 화면이 다시 그릴 때 값이 달라져 하이드레이션이 어긋난다 —
 * 그래서 이 함수는 `now` 를 받고, 화면은 마운트한 뒤에 부른다.
 */
export const CALL_FRESH_MS = 3 * 60_000

export function callAgeLabel(atIso: string, now: Date): string | null {
  const at = new Date(atIso)
  if (Number.isNaN(at.getTime())) return null
  const elapsed = now.getTime() - at.getTime()
  // 앞선 시각은 시계가 어긋난 것이다. 「-3분 전」을 적느니 아무 말도 안 한다
  if (elapsed < CALL_FRESH_MS) return null
  return formatKstAgo(atIso, now)
}

/** 날이 바뀌었으면 시각만으로는 모자라다 — 어느 날 것인지 같이 적는다 */
export function isOtherDay(atIso: string, now: Date): boolean {
  return kstDateKey(atIso) !== kstDateKey(now.toISOString())
}

/**
 * 차트 제목 — **그리지 않은 것을 제목에 적지 않는다**
 *
 * 실측 2026-09-28: 신호가 0건인데 제목이 「가격과 신호」였다. 사람은 제목을 읽고
 * 신호를 찾다가 못 찾고, 그때 의심하는 것은 제목이 아니라 **차트가 고장났나**이다.
 * 제목은 화면에서 가장 먼저 읽히는 글자라 틀리면 그 아래 전부가 의심받는다.
 *
 * 판단은 매분 쌓이고 신호는 관문을 다 지나야 나간다. 지금처럼 판단만 있는 판이
 * 오래 가므로, 그동안 제목이 「판단」이라고 말해 주는 편이 정확하다.
 */
export function chartTitle(input: { signalCount: number; callCount: number }): string {
  /*
    **무슨 봉인지를 제목이 말한다.** 사용자 지적 2026-09-29 「1분 단위로 계속 바뀌나?
    이거 차트가? 내가 정확히 몰라서」 — 봉 하나가 1분인지 5분인지 모르면 같은 그림이
    전혀 다른 뜻이 된다. 화면 어디에도 그 말이 없었다.
  */
  if (input.signalCount > 0) return '1분봉 가격과 신호'
  if (input.callCount > 0) return '1분봉 가격과 판단'
  return '1분봉 가격'
}
