// 표의 모델 목록을 고르기 목록으로 — 연결 창과 입력 창이 같이 쓴다
// 모델은 늘어나는 목록이라 드롭다운 대신 찾아 고르는 창(RecordPickerField)에 넣는다

import type { Board } from '@/lib/gpu/board'
import type { EntryProduct } from '@/lib/gpu/entry'
import type { RecordOption, RecordSearch } from '@/components/ui/RecordPicker'

export interface ProductOption extends EntryProduct {
  label: string
}

export function productOptions(board: Board | undefined): ProductOption[] {
  if (!board) return []
  return board.rows.flatMap((r) => r.products.map((p) => ({
    id: p.id,
    model_name: r.model,
    memory: r.memory_per_gpu_gb == null ? null : `${r.memory_per_gpu_gb * p.gpu_count}GB`,
    gpu_count: p.gpu_count,
    label: `${r.model}${r.memory_per_gpu_gb == null ? '' : ` ${r.memory_per_gpu_gb}GB`} × ${p.gpu_count}`,
  }))).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
}

/** 검색은 화면에 이미 있는 목록에서, 띄어쓰기 무시 */
export function searchOf(options: ProductOption[]): RecordSearch {
  return async (query) => {
    const q = query.toLowerCase().replace(/\s+/g, '')
    return options
      .filter((o) => !q || o.label.toLowerCase().replace(/\s+/g, '').includes(q))
      .map((o): RecordOption => ({ id: o.id, name: o.label }))
  }
}
