/**
 * 계획을 **주문 순서로** 쓴다
 *
 * 사용자 지시 2026-09-30: 「여기 점수로 이야기 하면 모르겠어 난, 젤 명확한게 얼마에 사고
 * 얼마에 팔아라 그리고 대충 얼마정도 유지해라 시간 정확히 보여주고 이게 핵심이야」.
 * 같은 날: 「어떻게 이용해야 하는건지를 모르겠어 쉽게 해야지 그게 중요해」.
 *
 * 전에는 화면이 「진입 기준가 · 진입 한계가 · 손절가 · 목표가」를 표로 세웠다.
 * 값은 다 있었지만 **순서가 주문하는 순서가 아니었고, 사는 건지 파는 건지를 안 말했다** —
 * 숏이면 먼저 팔고 나중에 되사는데 화면에는 「목표가」라고만 적혀 있었다.
 *
 * 그래서 이 파일은 같은 값을 **말**로 바꾼다. 값을 새로 셈하지 않는다 —
 * 식은 `buildExitPlan` 하나가 쥐고 있고(M4), 여기서 다시 적으면 화면이 말하는 전략과
 * 백테스트가 재는 전략이 갈린다.
 */

import type { CallPlan } from './series.ts'
import { gapFromNow } from './now-price.ts'
import { formatIndexPrice, deadlineLeftText } from '../signal-labels.ts'
import { seoulTimeText, UNKNOWN_TEXT } from '../position-labels.ts'

/**
 * 방향마다 말이 다르다. **롱은 사서 팔고 숏은 팔아서 되산다** —
 * 같은 「목표가」라도 하는 짓이 반대라 한 단어로 덮으면 사람이 반대로 주문한다.
 */
export const ORDER_ACTION: Record<'long' | 'short', {
  headline: string
  entry: string
  target: string
  stop: string
}> = {
  long: { headline: '먼저 삽니다', entry: '삽니다', target: '팝니다', stop: '끊습니다' },
  short: { headline: '먼저 팝니다', entry: '팝니다', target: '되삽니다', stop: '끊습니다' },
}

/** 줄 이름. 값 이름이 아니라 **질문**으로 적는다 — 사람이 머릿속으로 묻는 순서가 이것이다 */
export const ORDER_STEP_LABEL = {
  entry: '얼마에',
  target: '벌면 여기서',
  stop: '틀리면 여기서',
  entryBy: '언제까지 들어가나',
  hold: '얼마나 들고 있나',
  sessionExit: '늦어도 이때는',
} as const

export interface OrderStep {
  /** 줄 이름 */
  name: string
  /** 「1084.22 에 팝니다」 — 값과 할 일이 한 문장에 있다 */
  text: string
  /** 옆에 붙는 사실. 없으면 null */
  note: string | null
}

export interface OrderCard {
  /** 「먼저 팝니다」 — 방향을 이름이 아니라 **할 일**로 */
  headline: string
  /** 들어갈 때 · 벌 때 · 틀릴 때, 이 순서다 */
  steps: readonly OrderStep[]
  /** 시각 셋. 전부 시:분이고 길이가 아니다 */
  times: readonly OrderStep[]
}

/**
 * 계획 하나를 주문서로.
 *
 * **시계와 지금 가격을 밖에서 받는다.** 안에서 부르면 서버가 그린 글자와 화면이 그린
 * 글자가 달라져 하이드레이션이 어긋나고, 남은 시간은 찍힌 순간에 멈춘 거짓이 된다.
 */
export function buildOrderCard(input: {
  plan: CallPlan
  nowPrice: number | null
  now: Date | null
}): OrderCard {
  const { plan, nowPrice, now } = input
  const act = ORDER_ACTION[plan.direction]

  const steps: OrderStep[] = [
    {
      name: ORDER_STEP_LABEL.entry,
      text: `${formatIndexPrice(plan.referencePrice)} 에 ${act.entry}`,
      // 지금 가격과의 거리. 이것이 있어야 「지금 들어가도 되나」가 눈으로 읽힌다
      note: gapFromNow(nowPrice, plan.referencePrice),
    },
    {
      name: ORDER_STEP_LABEL.target,
      text: `${formatIndexPrice(plan.targetPrice)} 에 ${act.target}`,
      // 목표는 언제나 버는 쪽이다. 가격이 위인지 아래인지가 아니라 **몇 점 버나**를 적는다
      note: profitText(plan.referencePrice, plan.targetPrice),
    },
    {
      name: ORDER_STEP_LABEL.stop,
      text: `${formatIndexPrice(plan.stopPrice)} 에 ${act.stop}`,
      // 손절은 언제나 잃는 쪽이다. 부호를 빼면 목표와 구분이 안 된다
      note: lossText(plan.referencePrice, plan.stopPrice),
    },
  ]

  const times: OrderStep[] = [
    {
      name: ORDER_STEP_LABEL.entryBy,
      text: plan.entryDeadlineAt ? `${seoulTimeText(plan.entryDeadlineAt)} 까지` : UNKNOWN_TEXT,
      note: now ? deadlineLeftText(plan.entryDeadlineAt, now) || null : null,
    },
    {
      name: ORDER_STEP_LABEL.hold,
      /*
        **「대충 얼마정도 유지해라」가 이 줄이다** (사용자 지시 2026-09-30).
        길이를 먼저 말하고 시각을 옆에 둔다 — 「18분」이 먼저 와야 감이 잡히고,
        시각은 그 18분이 언제 끝나는지를 확인하는 값이다.
      */
      text: holdText(plan.timeExitMinutes),
      note: exitNote(plan.timeExitMinutes, now),
    },
    {
      name: ORDER_STEP_LABEL.sessionExit,
      text: plan.sameDayExitAt ? seoulTimeText(plan.sameDayExitAt) : UNKNOWN_TEXT,
      note: '그날 안에 정리합니다',
    },
  ]

  return { headline: act.headline, steps, times }
}

/** 목표까지 몇 점 버나. 0 이면 본전이 아니라 값이 이상한 것이므로 안 적는다 */
function profitText(reference: number, target: number): string | null {
  const gap = Math.abs(target - reference)
  if (!Number.isFinite(gap) || gap < 0.005) return null
  return `+${gap.toFixed(2)}점`
}

/** 손절까지 몇 점 잃나. 부호를 빼면 목표와 같은 글자가 된다 */
function lossText(reference: number, stop: number): string | null {
  const gap = Math.abs(stop - reference)
  if (!Number.isFinite(gap) || gap < 0.005) return null
  return `-${gap.toFixed(2)}점`
}

/** 들고 있는 길이. 「약」을 붙인다 — 이 값은 시간 청산 한도이지 약속이 아니다 */
function holdText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return UNKNOWN_TEXT
  return `약 ${Math.round(minutes)}분`
}

/**
 * 지금 들어간다고 볼 때 나올 시각.
 * 시계가 없으면 안 적는다 — 서버가 적으면 탭을 열어 둔 채 그 글자가 굳는다
 */
function exitNote(minutes: number, now: Date | null): string | null {
  if (!now || !Number.isFinite(minutes) || minutes <= 0) return null
  const at = new Date(now.getTime() + minutes * 60_000)
  return `지금 들어가면 ${seoulTimeText(at.toISOString())} 쯤`
}
