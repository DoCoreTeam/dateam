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
  return {
    bars,
    marks,
    calls,
    domain: axisDomain(Math.min(...values), Math.max(...values)),
    lastBarAt: bars[bars.length - 1].at,
    blocked: null,
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
