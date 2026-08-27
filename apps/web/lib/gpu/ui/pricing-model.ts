/**
 * 과금 방식의 말 — SSOT
 *
 * **왜 생겼나**: 같은 표가 두 곳에 복붙돼 있었다(실측 v0.7.597) —
 * `app/(member)/pricing/gpu/tabs/MarketTab.tsx:147` 과
 * `components/pricing/gpu/MarketPriceEditModal.tsx:24`.
 * 목록과 그 목록에서 여는 모달이라 **항상 같이 보이는 자리**인데도 표가 둘이었다.
 * 한쪽만 고치면 목록과 모달이 같은 값을 다르게 부른다.
 *
 * `pricing_model` 컬럼 값을 사람 말로 옮기는 것뿐이라 상태색은 없다
 * (상태가 아니라 분류다 — `StatusKey` 를 억지로 붙이지 않는다).
 */

export const PRICING_MODEL_LABEL: Record<string, string> = {
  on_demand: 'On-Demand',
  reserved_1y: '1년 약정',
  reserved_3y: '3년 약정',
  spot: 'Spot',
  committed: '커밋',
}

/** 모르는 값이 오면 원문을 그대로 — 빈칸보다 낫다(무엇이 들어왔는지 사람이 볼 수 있어야 한다) */
export function pricingModelLabel(value: string | null | undefined): string {
  if (!value) return '-'
  return PRICING_MODEL_LABEL[value] ?? value
}
