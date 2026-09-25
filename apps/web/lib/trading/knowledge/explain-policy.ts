/**
 * 신호 설명 — **알림 뒤에 붙는다** (명세 §12)
 *
 * ## 왜 알림이 설명을 안 기다리나
 *
 * 「알림은 Gemini 를 기다리지 않는다」. 설명을 만드는 데 몇 초가 걸리는데,
 * 사람이 알림을 보고 주문하기까지가 1~3분이다. 몇 초가 큰가 하면 —
 * **AI 가 죽은 날 알림이 통째로 안 나간다.** 곁가지가 본 일을 죽이는 자리가 그것이다.
 *
 * ## 왜 입력을 신호 기록으로 한정하나
 *
 * 설명이 신호 기록에 없는 것을 말하면, 그 설명은 신호를 설명한 것이 아니다.
 * 「최근 시장이 불안정해서」 같은 문장은 어디서도 안 나온 말이고, 사람은 그것을
 * 시스템이 본 무언가로 읽는다. 그래서 프롬프트에 넣는 값을 여기서 만든다.
 */

export interface SignalFacts {
  direction: 'long' | 'short'
  referencePrice: number
  stopPrice: number
  targetPrice: number
  /** 보정 확률. 없으면 「없음」으로 적는다 — 0% 로 적으면 계산한 값처럼 보인다 */
  calibratedProb: number | null
  netExpectedValueR: number | null
  riskPerTradeKrw: number
  /** 어떤 진입 조건이 걸렸나 */
  triggerId: string | null
  /** 세션 시작 후 몇 분 */
  minutesSinceOpen: number
}

/** 설명이 볼 수 있는 값의 이름들. **여기 없는 것은 프롬프트에 안 들어간다** */
export const ALLOWED_FACT_KEYS: readonly (keyof SignalFacts)[] = [
  'direction', 'referencePrice', 'stopPrice', 'targetPrice',
  'calibratedProb', 'netExpectedValueR', 'riskPerTradeKrw', 'triggerId', 'minutesSinceOpen',
]

export const MAX_EXPLANATION_LENGTH = 1200

/** 잘랐다는 표시. 길이를 셈에 쓰므로 상수로 둔다 — 눈대중으로 빼면 상한과 안 맞는다 */
export const TRUNCATION_MARK = '… (잘림)'

export type ExplainRejection = { reason: string; userMessage: string }

/** 사람이 읽을 사실 줄. AI 에게 이 줄들만 준다 */
export function factLines(f: SignalFacts): string[] {
  const price = (v: number) => v.toFixed(2)
  const prob = (v: number | null) => (v === null ? '없음' : `${(v * 100).toFixed(0)}%`)
  const r = (v: number | null) => (v === null ? '없음' : `${v.toFixed(2)}R`)
  return [
    `방향: ${f.direction === 'long' ? '매수' : '매도'}`,
    `기준가 ${price(f.referencePrice)} · 손절 ${price(f.stopPrice)} · 목표 ${price(f.targetPrice)}`,
    `보정 확률: ${prob(f.calibratedProb)}`,
    `순기대값: ${r(f.netExpectedValueR)}`,
    `1회 위험: ${Math.round(f.riskPerTradeKrw).toLocaleString('ko-KR')}원`,
    `진입 조건: ${f.triggerId ?? '없음'}`,
    `개장 후 ${f.minutesSinceOpen}분`,
  ]
}

/**
 * 프롬프트.
 *
 * 「지어내지 말라」를 적고, 그것만으로 안 끝낸다 — 입력 자체에 신호 기록 밖의 값이
 * 없으므로 지어낼 재료가 없다. 재료를 주고 쓰지 말라고 하는 것보다 안 주는 것이 낫다.
 */
/**
 * 넘길 값에 목록 밖의 것이 섞였나.
 *
 * 형이 맞아도 값 객체에 칸이 더 붙어 올 수 있다(DB 행을 그대로 넘기는 경우).
 * 그 칸이 프롬프트로 새면 「신호 기록만 본다」가 깨진다.
 */
export function checkFactKeys(f: Record<string, unknown>): ExplainRejection | null {
  const allowed = new Set<string>(ALLOWED_FACT_KEYS as readonly string[])
  const extra = Object.keys(f).filter((k) => !allowed.has(k))
  if (extra.length > 0) {
    return {
      reason: `extra_facts:${extra.join(',')}`.slice(0, 200),
      userMessage: '신호 기록 밖의 값이 섞여 설명을 만들지 않았습니다',
    }
  }
  return null
}

export function buildExplainPrompt(f: SignalFacts): string {
  return [
    '너는 방금 나간 트레이딩 신호를 사람에게 설명하는 사람이다.',
    '',
    '규칙',
    '- 아래 「신호 기록」에 **있는 것만** 쓴다. 시장 상황·뉴스·전망을 쓰지 않는다',
    '- 권하지 않는다. 「들어가세요」 「좋아 보입니다」 같은 말을 쓰지 않는다',
    '- 확률을 단정으로 바꾸지 않는다. 60% 는 「오른다」가 아니다',
    '- 보정 확률이 「없음」이면 그 사실을 말한다. 추정하지 않는다',
    '- 세 문장 이내로 쓴다',
    '',
    '신호 기록',
    ...factLines(f).map((l) => `- ${l}`),
  ].join('\n')
}

/** 지어낸 말이 섞였나. 넣지 않은 재료를 말하면 그 설명은 신호를 설명한 것이 아니다 */
export const BANNED_PHRASES: readonly string[] = [
  '뉴스', '전망', '시장 분위기', '들어가세요', '추천', '매수하세요', '매도하세요',
  '확실', '틀림없', '보장',
]

export function checkExplanation(text: string): ExplainRejection | null {
  const body = text.trim()
  if (body === '') {
    return { reason: 'empty', userMessage: 'AI 가 설명을 내지 못했습니다' }
  }
  const hit = BANNED_PHRASES.find((p) => body.includes(p))
  if (hit) {
    return {
      reason: `banned_phrase:${hit}`,
      userMessage: '설명에 권하는 말이나 신호 기록 밖의 말이 있어 싣지 않았습니다',
    }
  }
  return null
}

export function normalizeExplanation(text: string): string {
  const body = text.trim().replace(/\n{3,}/g, '\n\n')
  if (body.length <= MAX_EXPLANATION_LENGTH) return body
  return body.slice(0, MAX_EXPLANATION_LENGTH - TRUNCATION_MARK.length) + TRUNCATION_MARK
}
