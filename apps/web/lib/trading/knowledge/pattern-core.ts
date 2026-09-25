/**
 * 패턴 리포트 — **숫자는 코드가 세고, AI 는 말로 옮기기만 한다**
 *
 * ## 왜 숫자를 AI 에게 안 맡기나
 *
 * 「개장 30분의 승률이 62%였습니다」를 모델이 쓰면, 그 62가 실제로 센 값인지
 * 그럴듯한 값인지 화면에서는 구별이 안 된다. 그리고 그 숫자를 보고 사람이 설정을 바꾼다.
 * 그래서 셈은 여기 순수 함수가 하고, AI 에게는 **이미 센 숫자**를 주고 문장만 받는다.
 *
 * ## 왜 표본 하한이 있나
 *
 * 세 건으로 「패턴을 찾았다」고 말하면 그 말은 다음 달에 뒤집힌다. 그리고 뒤집혔다는
 * 사실은 아무 데도 안 적힌다. 하한에 못 미치면 리포트를 **안 만든다** —
 * 「표본이 모자랍니다」와 「패턴이 없습니다」는 다른 말이다.
 */

/** 리포트가 보는 거래 한 건 */
export interface PatternSample {
  tradeDate: string
  /** 세션 시작 후 몇 분에 난 신호인가 */
  minutesSinceOpen: number
  direction: 'long' | 'short'
  triggerId: string
  /** 순손익(R). 결과가 안 난 신호는 넣지 않는다 */
  netPnlR: number
}

export interface Bucket {
  key: string
  label: string
  count: number
  winRate: number
  meanR: number
}

export interface PatternMetrics {
  windowFrom: string
  windowTo: string
  sampleCount: number
  dayCount: number
  overallWinRate: number
  overallMeanR: number
  byHour: Bucket[]
  byTrigger: Bucket[]
  byDirection: Bucket[]
}

export type PatternRejection = { reason: string; userMessage: string }

/** 시간대 묶음. 개장 후 분을 30분 칸으로 */
export const HOUR_BUCKET_MINUTES = 30

function summarize(key: string, label: string, rows: readonly PatternSample[]): Bucket {
  const wins = rows.filter((r) => r.netPnlR > 0).length
  const sum = rows.reduce((acc, r) => acc + r.netPnlR, 0)
  return {
    key,
    label,
    count: rows.length,
    // 0 으로 나누지 않는다. 빈 묶음은 애초에 안 만들지만, 만들어지면 0 이 아니라 0 건이다
    winRate: rows.length === 0 ? 0 : wins / rows.length,
    meanR: rows.length === 0 ? 0 : sum / rows.length,
  }
}

function groupBy(
  rows: readonly PatternSample[],
  keyOf: (r: PatternSample) => string,
  labelOf: (key: string) => string,
  minCount: number,
): Bucket[] {
  const groups = new Map<string, PatternSample[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const list = groups.get(k)
    if (list) list.push(r)
    else groups.set(k, [r])
  }
  return [...groups.entries()]
    // 묶음마다도 하한을 건다. 두 건짜리 칸의 승률 100% 를 화면에 올리면 그것이 패턴처럼 보인다
    .filter(([, list]) => list.length >= minCount)
    .map(([k, list]) => summarize(k, labelOf(k), list))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export interface PatternInput {
  samples: readonly PatternSample[]
  /** 설정 `pattern_min_samples`. 전체가 이만큼은 돼야 리포트를 만든다 */
  minSamples: number
  /** 설정 `pattern_min_bucket`. 묶음 하나가 이만큼은 돼야 표에 올린다 */
  minBucketSamples: number
}

/**
 * 센다. **표본이 모자라면 안 만든다.**
 *
 * 거짓을 만들지 않는 방법은 하나뿐이다 — 셀 것이 없으면 안 세는 것.
 */
export function computePatterns(input: PatternInput): PatternMetrics | PatternRejection {
  const rows = input.samples
  if (rows.length < input.minSamples) {
    return {
      reason: `not_enough_samples:${rows.length}<${input.minSamples}`,
      userMessage: `표본이 ${rows.length}건입니다. ${input.minSamples}건이 모여야 패턴을 셉니다`,
    }
  }

  const days = [...new Set(rows.map((r) => r.tradeDate))].sort()
  const bucketKey = (r: PatternSample) => {
    const start = Math.floor(r.minutesSinceOpen / HOUR_BUCKET_MINUTES) * HOUR_BUCKET_MINUTES
    return String(start).padStart(4, '0')
  }

  return {
    windowFrom: days[0],
    windowTo: days[days.length - 1],
    sampleCount: rows.length,
    dayCount: days.length,
    overallWinRate: summarize('all', '전체', rows).winRate,
    overallMeanR: summarize('all', '전체', rows).meanR,
    byHour: groupBy(rows, bucketKey,
      (k) => `개장 후 ${Number(k)}~${Number(k) + HOUR_BUCKET_MINUTES}분`, input.minBucketSamples),
    byTrigger: groupBy(rows, (r) => r.triggerId, (k) => k, input.minBucketSamples),
    byDirection: groupBy(rows, (r) => r.direction,
      (k) => (k === 'long' ? '매수' : '매도'), input.minBucketSamples),
  }
}

export function isPatternRejection(v: PatternMetrics | PatternRejection): v is PatternRejection {
  return 'reason' in v
}

/** 표를 사람이 읽는 줄로. **AI 에게 이 줄들을 준다** — 원자료를 주면 AI 가 다시 센다 */
export function metricsToLines(m: PatternMetrics): string[] {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`
  const r = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`
  const line = (b: Bucket) => `${b.label}: ${b.count}건, 승률 ${pct(b.winRate)}, 평균 ${r(b.meanR)}`
  return [
    `구간 ${m.windowFrom} ~ ${m.windowTo}, ${m.dayCount}거래일 ${m.sampleCount}건`,
    `전체: 승률 ${pct(m.overallWinRate)}, 평균 ${r(m.overallMeanR)}`,
    ...m.byHour.map((b) => `시간대 ${line(b)}`),
    ...m.byTrigger.map((b) => `진입 조건 ${line(b)}`),
    ...m.byDirection.map((b) => `방향 ${line(b)}`),
  ]
}

/**
 * 프롬프트. **숫자를 주고 문장을 받는다.**
 *
 * 「원자료를 줄 테니 세어 보라」고 하지 않는다 — 그러면 AI 가 센 숫자가 화면에 뜨고,
 * 그 숫자가 맞는지 아무도 확인할 수 없다.
 */
export function buildPatternPrompt(lines: readonly string[]): string {
  return [
    '너는 선물 트레이딩 성과표를 읽고 사람에게 설명하는 사람이다.',
    '',
    '규칙',
    '- 아래 표에 **있는 숫자만** 쓴다. 새로 계산하지 않는다',
    '- 표에 없는 숫자를 쓰지 않는다',
    '- 예측하지 않는다. 「다음 달에는」 같은 말을 쓰지 않는다',
    '- 설정을 바꾸라고 말하지 않는다. 그것은 다른 자리에서 한다',
    '- 표본이 적은 칸은 적다고 말한다',
    '',
    '표',
    ...lines.map((l) => `- ${l}`),
    '',
    '세 문단 이내의 평문으로 답한다.',
  ].join('\n')
}
