/**
 * GPU 이용 줄의 정상가 — GPU 가격표의 판매가(전략가가 있으면 전략가)에서 (순수 함수)
 *
 * 판매가는 GPU 가격표 한 곳(`lib/gpu/pricing.ts` 의 `strategic_krw`)에서만 정해진다.
 * 여기서는 다시 세지 않고, 견적 글의 모델 이름을 그 가격표의 구성 하나에 맞추기만 한다.
 *
 * 한 모델에 구성이 여럿이다(1장, 2장, 8장, 메모리 다름). 고르는 순서는
 *   1장 구성 → 1장당 시간당 판매가가 가장 낮은 구성.
 * 견적은 「몇 대」를 따로 곱하므로 1장 구성이 가장 그대로 읽힌다.
 * 숨긴 구성, 지운 구성, 판매가가 없는 구성은 고르지 않는다 — 없으면 「가격표에 없음」이다.
 */

import { coreModelKey } from '../../gpu/canonical-model.ts'
import type { GpuPriceRef } from '../domain/pricebook/basis-lines.ts'

/** 가격표 구성에서 쓰는 칸만 */
export interface GpuConfigRow {
  model_name: string
  gpu_count: number | null
  strategic_krw: number | null
  is_active: boolean | null
  deleted_at?: string | null
}

export function buildGpuPriceLookup(rows: readonly GpuConfigRow[]): (model: string) => GpuPriceRef | null {
  const best = new Map<string, GpuPriceRef>()
  for (const r of rows) {
    const count = Number(r.gpu_count ?? 0)
    const krw = r.strategic_krw
    if (r.is_active === false || r.deleted_at || !(count > 0) || krw === null || !(krw > 0)) continue
    const key = coreModelKey(r.model_name)
    if (!key) continue
    const ref: GpuPriceRef = { model: r.model_name, hourlyKrw: krw, gpuCount: count }
    const cur = best.get(key)
    if (!cur || better(ref, cur)) best.set(key, ref)
  }
  return (model: string) => best.get(coreModelKey(model)) ?? null
}

function better(a: GpuPriceRef, b: GpuPriceRef): boolean {
  if ((a.gpuCount === 1) !== (b.gpuCount === 1)) return a.gpuCount === 1
  return (a.hourlyKrw ?? 0) / a.gpuCount < (b.hourlyKrw ?? 0) / b.gpuCount
}
