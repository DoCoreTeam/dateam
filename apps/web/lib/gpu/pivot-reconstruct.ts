// 세로형 비교표(플랜=열, 속성=행) 재구성 SSOT (확정 기획 P5).
//   소프트뱅크류: 행이 サービス/月額/AIコンピューティングシステム(속성), 각 열이 플랜(H100/A100…).
//   전사(행 단위)는 이 구조에서 모델·가격을 각기 다른 행에 흩어 담는다 → 열 인덱스로 다시 묶어
//   "모델 + 원본 가격 + 장수"를 열마다 복원한다. 결정론(정규식·인덱스 매칭만, AI 없음).
import { looksLikeGpuModel } from './validate.ts'
import { resolveCurrency, resolvePeriod, resolveGpuCount } from './normalize-money.ts'

export interface TransRowLite { raw_label?: string; cells?: unknown[]; price_text?: string | null }

export interface PivotObservation {
  model_name: string
  amount: number | null        // 원본 금액(月額 열값)
  currency: string | null      // ISO(¥/円→JPY 등)
  pricing_unit: string | null  // 月→month 등
  gpu_count: number | null     // ×8 등
  provenance: string
}

// 셀에서 첫 GPU 모델 신호가 있는 문자열 반환(없으면 null).
function gpuCellOf(cells: string[]): string | null {
  for (const c of cells) if (looksLikeGpuModel(c)) return c
  return null
}
// 셀에서 가격형(통화기호+숫자) 첫 값 → {amount,currency}. 없으면 null.
function priceCellOf(cell: string): { amount: number; currency: string | null } | null {
  if (!/[¥￥$₩€]|円|원|krw|usd|jpy/i.test(cell)) return null
  const m = cell.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/)
  if (!m) return null
  const amount = parseFloat(m[0].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { amount, currency: resolveCurrency(cell) }
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/**
 * 전사 rows가 세로형 비교표인지 판정하고, 그렇다면 열별 관측을 복원한다.
 * 조건: (a) 모델 신호가 어떤 행의 cells에 있고 (b) 가격 신호가 다른 행의 cells에 있으며 (c) 두 행의 cells 길이가 같다(열 정렬).
 * 아니면 [] 반환(호출부가 기존 경로 유지).
 */
export function reconstructPivot(rows: TransRowLite[]): PivotObservation[] {
  if (!Array.isArray(rows)) return []
  const norm = rows.map((r) => ({
    label: asStr(r?.raw_label).trim(),
    cells: Array.isArray(r?.cells) ? r!.cells!.map(asStr) : [],
  }))
  // 모델 행(cells 중 GPU 신호 다수), 가격 행(cells 중 통화 신호 다수), 장수 행 후보 찾기.
  const modelRow = norm.find((r) => r.cells.filter((c) => looksLikeGpuModel(c)).length >= 1)
  const priceRow = norm.find((r) => r.cells.filter((c) => priceCellOf(c) != null).length >= 1)
  if (!modelRow || !priceRow) return []
  const width = Math.min(modelRow.cells.length, priceRow.cells.length)
  if (width < 1) return []
  // 장수 힌트 행(× N / N枚 있는 cells) — 하드웨어 스펙 행.
  const countRow = norm.find((r) => r !== priceRow && r.cells.some((c) => /[×x]\s*\d|枚|장/.test(c)))
  const priceLabel = priceRow.label // "月額" 등 → 기간 판정에 사용

  const out: PivotObservation[] = []
  for (let i = 0; i < width; i++) {
    const modelCell = gpuCellOf([modelRow.cells[i] ?? '', countRow?.cells[i] ?? ''].filter(Boolean))
    if (!modelCell) continue
    const p = priceCellOf(priceRow.cells[i] ?? '')
    const countCtx = `${countRow?.cells[i] ?? ''} ${modelRow.cells[i] ?? ''}`
    out.push({
      model_name: modelCell,
      amount: p?.amount ?? null,
      currency: p?.currency ?? null,
      pricing_unit: resolvePeriod(priceLabel) ?? resolvePeriod(priceRow.cells[i] ?? ''),
      gpu_count: resolveGpuCount(countCtx),
      provenance: `${modelRow.label}=${modelRow.cells[i]} | ${priceLabel}=${priceRow.cells[i]}`.slice(0, 200),
    })
  }
  return out
}
