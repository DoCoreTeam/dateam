/**
 * 지금 가격 한 줄 — **계획 값은 이 값이 있어야 읽힌다**
 *
 * 사용자 지적 2026-09-30: 「지금 롱인데 숏으로 예측하고 있고 어떻게 이용해야 하는건지를
 * 모르겠어」. 화면에는 진입 기준가 1084.22 가 있었고 그 순간 실제 가격은 1085.70 이었다.
 * 둘을 견줘야 「지금 들어가도 되나」가 나오는데, **화면에 지금 가격이 한 군데도 없었다**.
 *
 * 그래서 이 파일은 딱 한 가지를 한다 — 마지막으로 받은 현재가를 사람이 읽는 한 줄로 만든다.
 * 판단도 계획도 여기서 안 한다(그것은 `entry-window.ts` 와 `order-card.ts` 몫이다).
 */

import { seoulClockText, UNKNOWN_PRICE_TEXT } from '../position-labels.ts'
import { formatIndexPrice } from '../signal-labels.ts'

/** 이 자리가 쓰는 말. 화면 파일 안에 두지 않는다 */
export const NOW_PRICE_LABEL = {
  title: '지금 가격',
  /** 못 받았으면 0 을 안 그린다. 0 은 「값이 0」으로 읽히고 그것은 완전히 다른 사실이다 */
  missing: '현재가를 못 받았습니다',
  /** 오래된 값을 지금 값으로 읽으면 그 오차만큼 잘못 주문한다 */
  stale: '멈춘 값일 수 있습니다',
} as const

/**
 * 이 초 안이면 나이를 안 적는다. 현재가는 체결마다 오므로 몇 초 차이는 정상이고,
 * 정상인 것에 숫자를 붙이면 사람이 그것을 고장으로 읽는다.
 */
export const NOW_PRICE_FRESH_SECONDS = 60
/** 이 초를 넘으면 멈춘 값이라고 말한다 */
export const NOW_PRICE_STALE_SECONDS = 90

export interface NowPriceLine {
  /** 값 한 줄. 못 받았으면 null 이고 그때 `missing` 을 쓴다 */
  price: string | null
  /** 그 값을 받은 시각 (초까지). 못 받았으면 null */
  at: string | null
  /** 받은 지 몇 초인가. 정상 범위면 null — 멀쩡한 값에 숫자를 안 붙인다 */
  age: string | null
  /** 멈춘 값인가 */
  stale: boolean
  /** 못 받았을 때 쓸 말. 받았으면 null */
  missing: string | null
}

/**
 * 마지막으로 받은 현재가를 한 줄로.
 *
 * **시계를 밖에서 받는다.** 안에서 `new Date()` 를 부르면 서버가 그린 글자와
 * 화면이 그린 글자가 달라져 하이드레이션이 어긋난다. 그래서 `now` 는 없을 수도 있다 —
 * 서버 렌더에는 시계가 없고, 그때는 **값과 시각만 말하고 나이는 안 적는다**.
 */
export function nowPriceLine(
  last: { price: number; observedAt: string } | null,
  now: Date | null,
): NowPriceLine {
  const missing: NowPriceLine = {
    price: null, at: null, age: null, stale: false, missing: NOW_PRICE_LABEL.missing,
  }
  if (!last || !Number.isFinite(last.price)) return missing

  const observed = Date.parse(last.observedAt)
  if (!Number.isFinite(observed)) {
    // 값은 있는데 언제 것인지 모른다. 값을 버리지 않되 시각을 지어내지도 않는다
    return { price: formatIndexPrice(last.price), at: null, age: null, stale: false, missing: null }
  }

  const at = seoulClockText(new Date(observed))
  // 시계가 없으면 나이를 안 잰다. 서버가 잰 나이는 찍힌 순간에 멈춘 글자라 거짓이 된다
  if (!now || !Number.isFinite(now.getTime())) {
    return { price: formatIndexPrice(last.price), at, age: null, stale: false, missing: null }
  }
  const ageSec = Math.max(0, Math.floor((now.getTime() - observed) / 1000))
  return {
    price: formatIndexPrice(last.price),
    at,
    age: ageSec > NOW_PRICE_FRESH_SECONDS ? `${ageSec}초 전` : null,
    stale: ageSec > NOW_PRICE_STALE_SECONDS,
    missing: null,
  }
}

/** 지금 가격과 어떤 값의 거리. 부호를 살려 **위인지 아래인지**까지 말한다 */
export function gapFromNow(nowPrice: number | null, target: number | null): string | null {
  if (nowPrice === null || target === null) return null
  if (!Number.isFinite(nowPrice) || !Number.isFinite(target)) return null
  const gap = target - nowPrice
  if (Math.abs(gap) < 0.005) return '지금 가격과 같습니다'
  return `지금보다 ${Math.abs(gap).toFixed(2)}점 ${gap > 0 ? '위' : '아래'}`
}

/** 값이 아예 없는 자리에 쓸 글자. 표에서 자리가 안 흔들리게 한 곳에서 쓴다 */
export const NOW_PRICE_UNKNOWN = UNKNOWN_PRICE_TEXT
