/**
 * 포지션과 손익을 화면에 어떻게 적나 — **모름과 0 을 가른다**
 *
 * 이 규칙이 컴포넌트 안에 있으면 아무도 안 묻는다. 그래서 여기 두고 시험이 묻는다.
 *
 * ## 왜 가르나
 *
 * 실현 손익 0원은 「오늘 본전」이라는 **사실**이다. 안 쟀는데 0원이라고 쓰면
 * 사람은 오늘 아무 일도 없었다고 읽고 그대로 덮는다.
 * 손절가도 같다 — 빈 칸은 「손절 없음」으로도 「우리가 모름」으로도 읽힌다.
 */

import { fmtNumOr } from '../ui/number-format.ts'
import { NOT_MEASURED } from '../terms/index.ts'

/** 안 잰 값 자리에 쓰는 말. 용어집이 정한다 — 여기서 또 적지 않는다 */
export const UNKNOWN_TEXT = NOT_MEASURED
export const UNKNOWN_PRICE_TEXT = '모릅니다'

export function wonText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN_TEXT
  return `${value.toLocaleString('ko-KR')}원`
}

export function priceText(value: number | null): string {
  return fmtNumOr(value, UNKNOWN_PRICE_TEXT, 2)
}

/** 시각을 못 읽으면 지어내지 않는다 */
export function seoulTimeText(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return UNKNOWN_PRICE_TEXT
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit',
  }).format(new Date(parsed))
}

/** 지금 줄어드는 마감·청산 시각만 초까지 쓴다. 이력 시각은 `seoulTimeText` 그대로다. */
export function seoulTimeSecText(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return UNKNOWN_PRICE_TEXT
  return seoulClockText(new Date(parsed))
}

/**
 * 지금 시각을 **초까지**. 화면이 1초마다 다시 그리는 자리에 쓴다.
 *
 * 사용자 지적 2026-09-29: 「초나 시간이 실시간으로 흐르는것도 봤으면 좋겠어 지금은
 * 분까지만 있고 이게 변하고 있는지를 모르겠거든」 — 분까지만 있으면 60초 동안
 * 같은 글자라, 멈춘 화면과 도는 화면이 똑같아 보인다.
 */
export function seoulClockText(at: Date): string {
  if (!Number.isFinite(at.getTime())) return UNKNOWN_PRICE_TEXT
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(at)
}

/** 손절가를 모르는 자리는 빨갛게. 모른다는 것이 그냥 정보가 아니라 위험이다 */
export function isRiskyUnknown(stopPrice: number | null): boolean {
  return stopPrice === null
}

/**
 * 「지금 들고 있는 것」 한 카드가 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 세 블록의 뜻이 서로 다르다. 내가 적은 것과 증권사가 준 것을 섞어 읽으면
 * 대조가 무의미해지므로, 소제목이 그 차이를 말한다.
 */
export const HOLDING_PANEL_LABEL = {
  title: '지금 들고 있는 것',
  /** 증권사가 준 체결에서 접은 우리 기록 */
  fromBroker: '증권사가 준 체결',
} as const
