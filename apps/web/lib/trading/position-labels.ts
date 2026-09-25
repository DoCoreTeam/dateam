/**
 * 포지션과 손익을 화면에 어떻게 적나 — **모름과 0 을 가른다**
 *
 * 이 규칙이 컴포넌트 안에 있으면 아무도 안 묻는다. 그래서 여기 두고 시험이 묻는다.
 *
 * ## 왜 가르나
 *
 * 실현 손익 0원은 「오늘 본전」이라는 **사실**이다. 못 쟀는데 0원이라고 쓰면
 * 사람은 오늘 아무 일도 없었다고 읽고 그대로 덮는다.
 * 손절가도 같다 — 빈 칸은 「손절 없음」으로도 「우리가 모름」으로도 읽힌다.
 */

/** 못 잰 값 자리에 쓰는 말. 한 군데서만 정한다 */
export const UNKNOWN_TEXT = '못 쟀습니다'
export const UNKNOWN_PRICE_TEXT = '모릅니다'

export function wonText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN_TEXT
  return `${value.toLocaleString('ko-KR')}원`
}

export function priceText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN_PRICE_TEXT
  return value.toFixed(2)
}

/** 시각을 못 읽으면 지어내지 않는다 */
export function seoulTimeText(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return UNKNOWN_PRICE_TEXT
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit',
  }).format(new Date(parsed))
}

/** 손절가를 모르는 자리는 빨갛게. 모른다는 것이 그냥 정보가 아니라 위험이다 */
export function isRiskyUnknown(stopPrice: number | null): boolean {
  return stopPrice === null
}
