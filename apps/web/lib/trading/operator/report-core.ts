/**
 * 기간 리포트 셈 — **표본이 없으면 「없다」고 말한다**
 *
 * ## 왜 0 으로 안 채우나
 *
 * 「평균 지연 0.0초」와 「잰 것이 없음」이 화면에서 같아 보이면, 사람은 앞의 것으로 읽는다.
 * 그리고 「우리 시스템은 빠르다」는 결론이 표본 0건에서 나온다.
 *
 * ## 무엇을 한 장에 모으나
 *
 * 신호가 몇 번 나갔고 사람이 몇 번 따랐나, 어디가 얼마나 늦었나, 점검이 며칠 빨갰나.
 * 셋은 서로를 설명한다 — 신호를 안 따랐다면 늦어서인지 안 봤는지를 지연이 답하고,
 * 지연이 컸다면 그날 점검이 빨갰는지를 본다.
 */

export interface ReportInput {
  from: string
  to: string
  /** 신호 결과별 건수 */
  signalsTotal: number
  followed: number
  late: number
  skipped: number
  expired: number
  /** 네 구간 중앙값(초). 못 쟀으면 null */
  medianServerSec: number | null
  medianToOpenSec: number | null
  medianToOrderSec: number | null
  medianToFillSec: number | null
  /** 점검이 빨갰던 날 수와 본 날 수 */
  daysWithFail: number
  daysChecked: number
  /** AI 가 한 조치와 사람에게 넘긴 것 */
  actionsApplied: number
  actionsHandedOff: number
}

export interface ReportMetrics extends ReportInput {
  /** 신호를 따른 비율. 표본이 0이면 **null** */
  followRate: number | null
  /** 점검이 빨갰던 날 비율. 본 날이 0이면 null */
  failDayRate: number | null
  /** 잰 구간 수. 0 이면 지연 이야기를 안 한다 */
  measuredSegments: number
}

export type ReportRejection = { reason: string; userMessage: string }

export function computeReport(input: ReportInput): ReportMetrics | ReportRejection {
  if (input.from > input.to) {
    return { reason: 'period_reversed', userMessage: '기간이 거꾸로입니다' }
  }
  const segments = [
    input.medianServerSec, input.medianToOpenSec, input.medianToOrderSec, input.medianToFillSec,
  ]
  return {
    ...input,
    // 0 으로 안 나눈다. 표본이 없으면 비율이 없다
    followRate: input.signalsTotal === 0 ? null : (input.followed + input.late) / input.signalsTotal,
    failDayRate: input.daysChecked === 0 ? null : input.daysWithFail / input.daysChecked,
    measuredSegments: segments.filter((s) => s !== null).length,
  }
}

export function isReportRejection(v: ReportMetrics | ReportRejection): v is ReportRejection {
  return 'reason' in v
}

function pct(v: number | null): string {
  return v === null ? '잰 것 없음' : `${(v * 100).toFixed(0)}%`
}
function sec(v: number | null): string {
  return v === null ? '못 잼' : `${v.toFixed(1)}초`
}

/** 사람이 읽을 줄. **AI 에게 이 줄들을 준다** */
export function reportLines(m: ReportMetrics): string[] {
  return [
    `기간 ${m.from} ~ ${m.to}`,
    `신호 ${m.signalsTotal}건 — 따름 ${m.followed}, 늦게 따름 ${m.late}, 건너뜀 ${m.skipped}, 만료 ${m.expired}`,
    `따른 비율: ${pct(m.followRate)}`,
    m.measuredSegments === 0
      ? '지연: 잰 구간이 없습니다'
      : `지연 중앙값 — 서버 ${sec(m.medianServerSec)}, 사람 보기 ${sec(m.medianToOpenSec)},`
        + ` 사람 판단 ${sec(m.medianToOrderSec)}, 시장 ${sec(m.medianToFillSec)}`,
    m.daysChecked === 0
      ? '점검: 본 날이 없습니다'
      : `점검: ${m.daysChecked}일 중 ${m.daysWithFail}일 빨감 (${pct(m.failDayRate)})`,
    `조치: AI ${m.actionsApplied}건, 사람에게 넘김 ${m.actionsHandedOff}건`,
  ]
}

export function buildReportPrompt(lines: readonly string[]): string {
  return [
    '너는 기간 성과표를 읽고 사람에게 설명하는 사람이다.',
    '',
    '규칙',
    '- 아래 표에 **있는 숫자만** 쓴다. 새로 계산하지 않는다',
    '- 「잰 것 없음」·「못 잼」을 0 으로 바꿔 말하지 않는다',
    '- 예측하지 않고 설정을 바꾸라고 말하지 않는다',
    '- 네 문단 이내',
    '',
    '표',
    ...lines.map((l) => `- ${l}`),
  ].join('\n')
}
