/**
 * **지금 들어가도 되나** — 화면이 대신 판정한다
 *
 * 사용자 지시 2026-09-30: 「지금 롱인데 숏으로 예측하고 있고 어떻게 이용해야 하는건지를
 * 모르겠어 쉽게 해야지 그게 중요해」.
 *
 * 그 순간 화면에는 「진입 한계가 1083.93 · 여기를 넘으면 안 따라갑니다」가 있었다.
 * 규칙은 맞다. 다만 **그 규칙을 사람이 지금 가격과 매번 손으로 견줘야 했다** —
 * 그 뺄셈은 기계가 할 일이다.
 *
 * 마감을 먼저 본다. 시간이 지난 계획은 가격이 아무리 좋아도 못 들어가는 계획이고,
 * 가격부터 보면 「들어가도 됩니다」 다음에 「그런데 시간이 지났습니다」가 붙는다.
 */

import { fmtNum } from '../../ui/number-format.ts'
import type { CallPlan } from './series.ts'
import { formatIndexPrice } from '../signal-labels.ts'

export type EntryVerdict =
  /** 지금 들어가도 된다 */
  | 'ok'
  /** 마감 시각이 지났다 */
  | 'too_late'
  /** 한계가를 넘었다 — 따라가면 안 된다 */
  | 'beyond_chase'
  /** 판단에 필요한 값이 없다. 「된다」로 때우지 않는다 */
  | 'unknown'

export const ENTRY_VERDICT_TEXT: Record<EntryVerdict, string> = {
  ok: '지금 들어가도 됩니다',
  too_late: '시간이 지났습니다',
  beyond_chase: '지금은 따라가지 마세요',
  unknown: '지금 들어가도 되는지 판단할 수 없습니다',
}

export interface EntryWindow {
  verdict: EntryVerdict
  /** 판정 한 줄 */
  text: string
  /** 왜 그런가. 없으면 null */
  note: string | null
}

/**
 * 지금 들어가도 되는지.
 *
 * **시계와 지금 가격을 밖에서 받는다** — 안에서 부르면 서버가 그린 글자와 화면이 그린
 * 글자가 달라진다. 값이 없으면 `unknown` 이고, 그때 「됩니다」라고 말하지 않는다.
 */
export function entryWindowNow(input: {
  plan: CallPlan
  nowPrice: number | null
  now: Date | null
}): EntryWindow {
  const { plan, nowPrice, now } = input

  // 1 마감이 먼저다. 시간이 지난 계획은 가격이 좋아도 못 들어간다
  if (now && plan.entryDeadlineAt) {
    const deadline = Date.parse(plan.entryDeadlineAt)
    if (Number.isFinite(deadline) && now.getTime() >= deadline) {
      return verdict('too_late', '다음 판단을 기다리세요')
    }
  }

  // 2 판단에 필요한 값이 없으면 모른다고 말한다. 모르는 것을 「됩니다」로 때우지 않는다
  if (nowPrice === null || !Number.isFinite(nowPrice)) {
    return verdict('unknown', '지금 가격을 못 받았습니다')
  }
  if (plan.chaseLimitPrice === null || !Number.isFinite(plan.chaseLimitPrice)) {
    return verdict('unknown', '이 계획에는 진입 한계가가 없습니다')
  }
  if (!now) return verdict('unknown', null)

  // 3 한계가를 넘었나. 롱은 위로, 숏은 아래로 넘는 것이 「따라가는 것」이다
  const limit = plan.chaseLimitPrice
  const beyond = plan.direction === 'long' ? nowPrice > limit : nowPrice < limit
  if (beyond) {
    const over = fmtNum(Math.abs(nowPrice - limit), 2)
    return verdict(
      'beyond_chase',
      `한계가 ${formatIndexPrice(limit)} 를 ${over}점 ${plan.direction === 'long' ? '넘었습니다' : '밑돕니다'}`,
    )
  }

  // 4 아직 괜찮다. 기준가와 얼마나 떨어져 있는지를 같이 말한다
  const gap = fmtNum(Math.abs(nowPrice - plan.referencePrice), 2)
  return verdict('ok', `기준가 ${formatIndexPrice(plan.referencePrice)} 와 ${gap}점 차이입니다`)
}

function verdict(v: EntryVerdict, note: string | null): EntryWindow {
  return { verdict: v, text: ENTRY_VERDICT_TEXT[v], note }
}
