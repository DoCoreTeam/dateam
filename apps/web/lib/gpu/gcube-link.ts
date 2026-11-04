// gcube 사이트 상품과 우리 모델을 잇는 규칙 — 제안만 하고 잇는 것은 사람이 한다
//
// 이름만으로 잇지 않는다: 같은 이름 같은 장수 같은 메모리에 등급만 다른 상품이 여럿이다 (T4 1장 16GB 셋)
// 그래서 모델명, 장수, 장당 메모리가 맞는 짝이 양쪽 모두 하나일 때만 제안한다
// 금액 바뀜은 값 비교로만 본다: 같은 ser 의 기본요금이나 이용요금이 달라지면 바뀐 것

import type { GcubeListing } from './gcube-site.ts'

export interface LinkProduct {
  id: string
  model_name: string
  memory: string | null
  gpu_count: number | null
}

export interface StoredListing {
  ser: number
  base_krw: number | string
  usage_krw: number | string
  product_id: string | null
}

/** 모델명 비교 열쇠 — 「RTX4070TIS」와 「RTX 4070 Ti Super」, 「NVIDIA RTX A5000」과 「RTX A5000」을 같게 본다 */
export function gpuNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/nvidia|tesla|blackwell|geforce/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/super$/, 's')
}

function memPerGpu(memory: string | null, gpuCount: number | null): number | null {
  const total = parseFloat((memory ?? '').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.round(total / Math.max(1, Number(gpuCount) || 1))
}

/** 이 사이트 상품과 이 우리 모델이 같은 구성인가 */
export function sameConfig(l: Pick<GcubeListing, 'gpu_name' | 'gpu_count' | 'vram_gb'>, p: LinkProduct): boolean {
  if (gpuNameKey(l.gpu_name) !== gpuNameKey(p.model_name)) return false
  if (l.gpu_count !== Math.max(1, Number(p.gpu_count) || 1)) return false
  const mem = memPerGpu(p.memory, p.gpu_count)
  return mem == null || l.vram_gb == null || mem === l.vram_gb
}

/**
 * 연결 제안 — ser 마다 제안할 모델 id
 * 이미 이어진 상품과 모델은 빼고, 짝이 양쪽 모두 하나일 때만 넣는다
 */
export function suggestLinks(
  listings: Array<Pick<GcubeListing, 'ser' | 'gpu_name' | 'gpu_count' | 'vram_gb'> & { product_id?: string | null }>,
  products: LinkProduct[],
): Map<number, string> {
  const linkedProducts = new Set(listings.map((l) => l.product_id).filter((id): id is string => !!id))
  const openListings = listings.filter((l) => !l.product_id)
  const openProducts = products.filter((p) => !linkedProducts.has(p.id))

  const productsOf = new Map<number, LinkProduct[]>()
  const listingsOf = new Map<string, number>()
  for (const l of openListings) {
    const hits = openProducts.filter((p) => sameConfig(l, p))
    productsOf.set(l.ser, hits)
    for (const p of hits) listingsOf.set(p.id, (listingsOf.get(p.id) ?? 0) + 1)
  }

  const out = new Map<number, string>()
  for (const [ser, hits] of productsOf) {
    if (hits.length === 1 && listingsOf.get(hits[0].id) === 1) out.set(ser, hits[0].id)
  }
  return out
}

/** 금액이 바뀌었나 — 처음 보는 상품도 바뀐 것으로 본다 */
export function priceChanged(prev: StoredListing | undefined, next: Pick<GcubeListing, 'base_krw' | 'usage_krw'>): boolean {
  if (!prev) return true
  return Number(prev.base_krw) !== next.base_krw || Number(prev.usage_krw) !== next.usage_krw
}
