// 재고 상태 코드(자기완결, 외부 import 없음 → node:test 대상)
//   가용 수량·결품 공급사 수 → 코드. 라벨링(GPU_TERMS)은 호출처가 담당.

export type StockCode = 'full' | 'partial' | 'out'

/** qty<=0 → out, 결품 공급사 있으면 partial, 그 외 full. */
export function stockCode(qty: number, oosSupplierCount: number): StockCode {
  if (qty <= 0) return 'out'
  if (oosSupplierCount > 0) return 'partial'
  return 'full'
}
