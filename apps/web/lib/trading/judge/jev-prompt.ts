/**
 * Jev 에게 묻는 말 — **절대 날짜도 뉴스도 이름도 안 실린다** (명세 §7.3)
 *
 * ## 왜 절대 날짜를 빼나
 *
 * 모델은 「2026년 9월 25일」을 알면 그날 무슨 일이 있었는지를 **기억에서** 꺼낸다.
 * 그것은 판단이 아니라 사후 지식이고, 백테스트에서만 잘 맞고 실전에서는 안 맞는다.
 * 그래서 시각은 「세션 시작 후 N분」으로, 가격은 ATR·전일 종가 대비로만 말한다.
 *
 * ## 왜 가격도 상대값인가
 *
 * 1,100pt 라는 절대 수준을 주면 모델이 「그 무렵 지수」를 떠올린다. 같은 이유다.
 * 상대값만 주면 2020년 장이든 2026년 장이든 같은 질문이 된다 — 그래야 과거로 시험한
 * 성적이 앞으로도 뜻을 갖는다.
 *
 * ## 무엇을 묻나 (§7.3)
 *
 *   · `direction` — 롱 / 숏 / 관망
 *   · `enter_now` — 1~3분 늦게 들어가도 유효한가, 이미 추격 구간은 아닌가
 */

import type { JudgeInput, RawScore } from './types.ts'

export const JEV_PROMPT_VERSION = 'jev-prompt-v1'

/** 답으로 받을 꼴. 모델이 산문을 쓰면 읽을 수 없고, 읽을 수 없으면 기권이다 */
export const JEV_RESPONSE_SHAPE = '{"p_long":0.0,"p_short":0.0,"p_hold":0.0,"enter_now":0.0}'

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * 봉들을 ATR 배수로 바꾼다. 마지막 봉의 종가를 0 으로 두고 그 앞을 상대로 적는다.
 *
 * ATR 이 0 이면 나눌 수 없다 — 그때는 조립하지 않는다(부르는 쪽이 이미 기권한다).
 */
export function relativeCloses(input: JudgeInput, count: number): number[] {
  const atrValue = input.indicators.atr
  if (!(atrValue > 0)) return []
  const bars = input.bars.slice(Math.max(0, input.bars.length - count))
  const anchor = bars[bars.length - 1]?.close ?? 0
  return bars.map((b) => round((b.close - anchor) / atrValue))
}

export interface JevPromptInput {
  /** 조립된 질문 */
  text: string
  /** 같은 입력에 같은 답이 나오는지 나중에 확인할 자리(§14.5 state_hash 의 재료) */
  fingerprint: string
}

export function buildJevPrompt(input: JudgeInput): JevPromptInput {
  const closes = relativeCloses(input, 20)
  const atrValue = input.indicators.atr
  const last = input.bars[input.bars.length - 1]
  const spread = (value: number) => round((value - (last?.close ?? 0)) / atrValue)

  const facts = [
    `세션 시작 후 ${input.minutesSinceOpen}분`,
    `판단 봉 ${input.decisionTf}`,
    `걸린 진입 조건 ${input.trigger.id} (${input.trigger.direction})`,
    `최근 종가 흐름(ATR 배수, 마지막 봉 기준 0) ${closes.join(' ')}`,
    `단기 이동평균 ${spread(input.indicators.smaFast)} · 장기 이동평균 ${spread(input.indicators.smaSlow)}`,
    `최근 고가 ${spread(input.indicators.recentHigh)} · 최근 저가 ${spread(input.indicators.recentLow)}`,
  ]

  const text = [
    '지수선물 데이 트레이딩의 진입 방향을 판단한다.',
    '',
    '알려 주는 값은 전부 ATR 배수 상대값이고, 시각은 세션 시작 이후 경과 분이다.',
    '절대 날짜나 지수 수준은 주지 않는다 — 기억이 아니라 지금 주어진 값만으로 판단한다.',
    '',
    ...facts.map((f) => `- ${f}`),
    '',
    '판단 기준',
    '- long: 위쪽으로 이어질 가능성이 높다',
    '- short: 아래쪽으로 이어질 가능성이 높다',
    '- hold: 어느 쪽도 아니다. 애매하면 hold 를 높인다',
    '- enter_now: 지금부터 1~3분 늦게 들어가도 유효한가(0~1). 이미 추격 구간이면 낮춘다',
    '',
    `아래 꼴의 JSON 만 답한다. 설명을 붙이지 않는다.`,
    JEV_RESPONSE_SHAPE,
    'p_long + p_short + p_hold = 1 이어야 한다.',
  ].join('\n')

  return { text, fingerprint: `${JEV_PROMPT_VERSION}|${facts.join('|')}` }
}

export type JevParse =
  | { ok: true; rawScore: RawScore }
  | { ok: false; reason: string }

/** 확률 셋의 합이 이만큼까지는 어긋나도 받아 준다. 모델이 소수 둘째 자리에서 반올림한다 */
const SUM_TOLERANCE = 0.02

/**
 * 답을 읽는다.
 *
 * **합이 안 맞으면 고쳐서 쓰지 않는다.** 정규화해서 받아 주면 모델이 무엇을 말했는지
 * 알 수 없게 되고, 보정 단계가 「모델이 준 확률」이 아니라 「우리가 고친 숫자」를 배운다.
 */
export function parseJevResponse(text: string): JevParse {
  const matched = text.match(/\{[\s\S]*\}/)
  if (!matched) return { ok: false, reason: 'not_json' }

  let parsed: unknown
  try {
    parsed = JSON.parse(matched[0])
  } catch {
    return { ok: false, reason: 'json_broken' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'not_object' }

  const row = parsed as Record<string, unknown>
  const fields = ['p_long', 'p_short', 'p_hold', 'enter_now'] as const
  const values: Record<string, number> = {}
  for (const field of fields) {
    const value = row[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, reason: `missing_field:${field}` }
    }
    if (value < 0 || value > 1) return { ok: false, reason: `out_of_range:${field}` }
    values[field] = value
  }

  const sum = values.p_long + values.p_short + values.p_hold
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    return { ok: false, reason: `sum_not_one:${round(sum)}` }
  }

  return {
    ok: true,
    rawScore: {
      p_long: values.p_long,
      p_short: values.p_short,
      p_hold: values.p_hold,
      enter_now: values.enter_now,
    },
  }
}
