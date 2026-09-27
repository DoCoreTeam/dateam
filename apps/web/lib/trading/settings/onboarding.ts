/**
 * 세 문항으로 시작하기 — **답한 셋으로 나머지를 채운다** (설계서 §12)
 *
 * ## 왜 필요했나
 *
 * 설정이 92개다. 처음 여는 사람에게 92개를 내놓는 것은 설정이 아니라 시험이다
 * (사용자 지적 2026-09-27 「도저히 나같은 수준에서는 쓸 수가 없이 복잡하고」).
 * 설계서 §12 에 세 문항 화면이 이미 그려져 있었고 안 만들었을 뿐이다.
 *
 * ## 규정을 안 비켜 간다
 *
 *   · 채우는 값은 **레지스트리에 등재된 키**뿐이다. 없는 키는 채우지 않는다
 *   · 명세 §15.3 금지 목록에 걸리는 키는 **사람이 답했다는 표가 붙는다** —
 *     금지된 것은 AI 가 바꾸는 것이고, 사람이 직접 답하는 이 자리는 허용이다.
 *     둘을 코드가 갈라 알아야 하므로 줄마다 표시를 남긴다
 *   · 저장은 기존 창구를 지나 **다음 거래일부터** 듣는다 (M7)
 *   · 한 번의 위험을 돈으로 환산해 **한도 안인지 같은 화면에서** 말한다 (M6)
 *
 * 이 파일에 DB 도 AI 도 없다. 답을 값으로 바꾸는 셈만 한다.
 */

import { TRADING_SETTINGS, type TradingSettingValue } from './registry.ts'
import { aiMayPropose } from '../knowledge/proposal-policy.ts'

/** 얼마나 조심스럽게 갈까요 */
export const STANCES = ['careful', 'normal', 'bold'] as const
export type Stance = (typeof STANCES)[number]

export interface Answers {
  stance: Stance
  /** 하루에 목표하는 수익(원) */
  targetKrw: number
  /** 하루에 감당할 수 있는 손실(원) */
  lossLimitKrw: number
}

export interface FilledValue {
  key: string
  label: string
  value: TradingSettingValue
  /**
   * 명세 §15.3 이 AI 에게 막아 둔 키인가.
   *
   * **막힌 것이 아니라 사람이 답해야 하는 것**이다. 화면이 그 줄에 확인 표를 붙이고,
   * 저장할 때도 사람이 답한 값이라는 사실이 기록에 남는다.
   */
  needsPerson: boolean
}

/**
 * 답 셋에서 채울 값들.
 *
 * **답이 정하는 것만 채운다.** 답과 상관없는 값을 함께 밀어 넣으면 「세 문항에 답했더니
 * 내가 고쳐 둔 값이 사라졌다」가 된다.
 *
 * 성향은 신호를 얼마나 까다롭게 고를지만 바꾼다. 기본값 대비 한 걸음이고,
 * 그 배수는 규칙이지 「이만큼이 보수적이다」라는 판정이 아니다.
 */
export function fillFrom(answers: Answers): FilledValue[] {
  const step = answers.stance === 'careful' ? 'less' : answers.stance === 'bold' ? 'more' : 'same'
  const scale = (base: number, dir: 'up' | 'down'): number => {
    if (step === 'same') return base
    const strict = (step === 'less') === (dir === 'up')
    return Math.round(base * (strict ? 1.5 : 0.5) * 100) / 100
  }

  const want: { key: string; value: TradingSettingValue }[] = [
    { key: 'daily_target_krw', value: Math.max(0, Math.round(answers.targetKrw)) },
    { key: 'daily_loss_limit_krw', value: Math.max(0, Math.round(answers.lossLimitKrw)) },
  ]

  // 성향이 바꾸는 것 넷. 값이 올라가면 까다로워지는 것과 반대인 것을 나눠 적는다
  const byStance: [string, 'up' | 'down'][] = [
    ['signal_min_net_ev_r', 'up'],
    ['signal_min_enter_now_prob', 'up'],
    ['signal_max_per_day', 'down'],
    ['signal_cooldown_minutes', 'up'],
  ]
  for (const [key, dir] of byStance) {
    const spec = TRADING_SETTINGS.find((s) => s.key === key)
    if (!spec || typeof spec.defaultValue !== 'number') continue
    const raw = scale(spec.defaultValue, dir)
    const lo = spec.min ?? Number.NEGATIVE_INFINITY
    const hi = spec.max ?? Number.POSITIVE_INFINITY
    const clamped = Math.min(hi, Math.max(lo, raw))
    want.push({ key, value: Number.isInteger(spec.defaultValue) ? Math.round(clamped) : clamped })
  }

  const out: FilledValue[] = []
  for (const { key, value } of want) {
    const spec = TRADING_SETTINGS.find((s) => s.key === key)
    // 등재 안 된 키는 안 채운다. 지어낸 키가 저장 창구까지 가지 않게
    if (!spec) continue
    out.push({ key, label: spec.label, value, needsPerson: aiMayPropose(key) !== null })
  }
  return out
}

/** 한 번에 얼마를 잃을 수 있나. 화면이 한도와 견줘 보여 준다 (M6) */
export interface RiskView {
  onceKrw: number
  limitKrw: number
  /** 한도가 한 번의 위험보다 작으면 어떤 신호도 못 나간다 */
  fits: boolean
  /** 한도가 한 번의 위험 몇 번분인가 */
  times: number
}

export function riskView(onceKrw: number, limitKrw: number): RiskView {
  const once = Math.max(0, Math.round(onceKrw))
  const limit = Math.max(0, Math.round(limitKrw))
  return {
    onceKrw: once,
    limitKrw: limit,
    fits: once > 0 && limit >= once,
    times: once > 0 ? Math.floor(limit / once) : 0,
  }
}

/** 손실 한도를 올리는 답인가. 올리면 화면이 무엇을 잃을 수 있는지 보이고 확인을 받는다 */
export function raisesLossLimit(next: number, current: TradingSettingValue): boolean {
  return typeof current === 'number' && next > current
}
