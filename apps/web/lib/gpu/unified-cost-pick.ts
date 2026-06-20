// 통합 표 — 공급원가/공급사 선택 규칙(자기완결, 외부 import 없음 → node:test 대상).
//
// 어댑터(cockpit-to-unified)가 쓰는 순수 결정 로직만 분리(unified-price-pick.ts와 동일 정책).
// 실제 사고(v0.7.218~219) 회귀 차단:
//   - 가격결정 기준 공급원가 = 지정/실효(cost_basis) 우선, 없으면 절대최저(cost_min) 폴백.
//   - 리스트 라벨/검색/정렬 공급사 = 지정/실효 공급사 우선, 없으면 최저가 공급사 폴백.
//   - 상세 패널 기준 공급사 = 지정/실효 우선, 전파(is_propagated)면 폴백 금지(자기참조 라벨 방지).

/** 가격결정 기준 공급원가(KRW). 지정/실효(cost_basis) 우선, 없으면 절대최저(cost_min) 폴백. 둘 다 없으면 null. */
export function pickSupplyCostKrw(costBasisKrw: number | null | undefined, costMinKrw: number | null): number | null {
  return costBasisKrw ?? costMinKrw ?? null
}

/** 리스트 라벨/검색/정렬용 공급사명. 지정/실효 공급사 우선, 없으면 최저가 공급사(cost_suppliers[0]) 폴백. */
export function pickListSupplierName(
  effectiveSupplier: string | null | undefined,
  cheapestSupplier: string | null,
): string | null {
  return effectiveSupplier ?? cheapestSupplier
}

/** 상세 패널 기준 공급사명. 지정/실효 우선. 전파면 원본 미상 시 현재 공급사로 폴백하지 않음(자기참조 라벨 방지). */
export function pickCostSupplierName(
  effectiveSupplier: string | null | undefined,
  isPropagated: boolean,
  cheapestSupplier: string | null,
): string | null {
  return effectiveSupplier ?? (isPropagated ? null : cheapestSupplier)
}
