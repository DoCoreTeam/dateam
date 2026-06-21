// 만료 상태 계산(자기완결, 외부 import 없음 → node:test 대상)
//   유효기간(YYYY-MM-DD 또는 ISO)과 기준 시각(ms) → 상태/남은 일수.
//   라벨/색조는 호출처가 GPU_TERMS로 매핑. now를 인자로 받아 결정적(테스트 가능).
// ⚠️ v0.7.226부터 가격 게이팅·UI 배지에서 분리됨(만료 비활성 정책) — 현재 소비처 없음(미사용).
//   테스트와 함께 보존(비파괴) — 만료 개념 재도입 시 재사용 대상.

export type ExpiryKind = 'expired' | 'soon' | 'ok' | 'none'

export interface ExpiryState {
  kind: ExpiryKind
  /** 남은 일수(올림). expired면 음수, none이면 null. */
  days: number | null
}

const SOON_DAYS = 7
const MS_PER_DAY = 1000 * 60 * 60 * 24

/** validUntil 없거나 파싱 불가 → none. 지났으면 expired, 7일 이내 soon, 그 외 ok. */
export function expiryState(validUntil: string | null, nowMs: number): ExpiryState {
  if (!validUntil) return { kind: 'none', days: null }
  const due = new Date(validUntil).getTime()
  if (Number.isNaN(due)) return { kind: 'none', days: null }
  const days = Math.ceil((due - nowMs) / MS_PER_DAY)
  if (days < 0) return { kind: 'expired', days }
  if (days <= SOON_DAYS) return { kind: 'soon', days }
  return { kind: 'ok', days }
}
