// 어댑터: /api/pricing/gpu/inventory 응답을 UnifiedRow에 병합(재고 보기 축)
//   가격은 cockpit이 주관. 본 모듈은 재고 수량·상태만 product_id로 합친다. 계산 없음(상태는 카운트 매핑).

import { GPU_TERMS } from './terms.ts'
import { stockCode } from './stock-status.ts'
import type { UnifiedRow } from './unified-row.ts'

interface InventoryApiItem {
  id: string
  fresh_available_qty?: number
  oos_supplier_count?: number
  effective_supplier?: { name?: string | null } | null
}
export interface InventoryApiResponse {
  inventory: InventoryApiItem[]
}

const STOCK_LABEL = { out: GPU_TERMS.stockOut, partial: GPU_TERMS.stockPartial, full: GPU_TERMS.stockFull } as const

/** 가용 수량·결품 공급사 수로 재고 상태 라벨 도출(코드는 stock-status SSOT, 라벨은 GPU_TERMS). */
function stockStatusLabel(qty: number, oos: number): string {
  return STOCK_LABEL[stockCode(qty, oos)]
}

/** UnifiedRow[]에 재고 축(available_qty·stock_status·supplier_name)을 product_id로 병합. 불변(새 배열). */
export function mergeInventory(rows: UnifiedRow[], res: InventoryApiResponse | undefined): UnifiedRow[] {
  if (!res?.inventory) return rows
  const byId = new Map<string, InventoryApiItem>()
  for (const it of res.inventory) byId.set(it.id, it)

  return rows.map((row): UnifiedRow => {
    const inv = byId.get(row.id)
    if (!inv) return row
    const qty = inv.fresh_available_qty ?? 0
    const oos = inv.oos_supplier_count ?? 0
    return {
      ...row,
      available_qty: qty,
      stock_status: stockStatusLabel(qty, oos),
      supplier_name: row.supplier_name ?? inv.effective_supplier?.name ?? null,
    }
  })
}
