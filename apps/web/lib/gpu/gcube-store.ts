import 'server-only'

// gcube 사이트 상품 저장과 연결 — 창구 셋(목록, 가져오기, 연결)이 이 파일만 지난다
// 쓰기는 서비스롤로 한다, 부르는 창구가 requireAdminApi 로 사람을 먼저 확인한다
// 사이트는 safe-fetch 로 받는다 (주소는 고정이지만 리다이렉트도 홉마다 다시 본다)

import { safeFetchText } from '@/lib/security/safe-fetch'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { GCUBE_PRICE_URL, parseGcubePricePage } from './gcube-site'
import { priceChanged, suggestLinks, type LinkProduct, type StoredListing } from './gcube-link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const FETCH_TIMEOUT_MS = 20_000
export const MAX_LINKS_PER_CALL = 200

export interface GcubeListingRow {
  ser: number
  gpu_name: string
  product_name: string | null
  product_code: string | null
  gpu_count: number
  vram_gb: number | null
  cpu: number | null
  memory_gb: number | null
  base_krw: number
  usage_krw: number
  max_krw: number
  listed: boolean
  product_id: string | null
  suggested_product_id: string | null
  fetched_at: string
  price_changed_at: string
}

export interface GcubeFetchResult {
  total: number
  changed: number
  added: number
  unlisted: number
  dropped: number
  suggested: number
}

export type GcubeFetchError = 'site_unreachable' | 'site_changed'

const LISTING_COLUMNS = 'ser, gpu_name, product_name, product_code, gpu_count, vram_gb, cpu, memory_gb, base_krw, usage_krw, max_krw, listed, product_id, suggested_product_id, fetched_at, price_changed_at'

function toNumbers(r: GcubeListingRow): GcubeListingRow {
  return { ...r, base_krw: Number(r.base_krw), usage_krw: Number(r.usage_krw), max_krw: Number(r.max_krw) }
}

export async function listGcubeListings(db: Db): Promise<GcubeListingRow[]> {
  const { data, error } = await db.from('gcube_listings').select(LISTING_COLUMNS).order('gpu_name').order('gpu_count').order('ser')
  if (error) throw error
  return ((data ?? []) as GcubeListingRow[]).map(toNumbers)
}

async function activeProducts(db: Db): Promise<LinkProduct[]> {
  const { data, error } = await db.from('gpu_products').select('id, model_name, memory, gpu_count').is('deleted_at', null).eq('is_active', true)
  if (error) throw error
  return (data ?? []) as LinkProduct[]
}

/** 사이트에서 전부 받아 ser 로 덮어쓴다, 금액이 바뀐 상품만 바뀐 때를 새로 적는다 */
export async function fetchGcubeListings(adminDb: Db, actor: string): Promise<GcubeFetchResult | GcubeFetchError> {
  const page = await safeFetchText(GCUBE_PRICE_URL, { timeoutMs: FETCH_TIMEOUT_MS })
  if (!page.ok) return 'site_unreachable'
  const parsed = parseGcubePricePage(page.text)
  if (!parsed || parsed.listings.length === 0) return 'site_changed'

  const { data: prevRows, error: prevErr } = await adminDb.from('gcube_listings').select('ser, base_krw, usage_krw, product_id')
  if (prevErr) throw prevErr
  const prev = new Map(((prevRows ?? []) as StoredListing[]).map((r) => [r.ser, r]))
  const nowIso = new Date().toISOString()

  const suggestions = suggestLinks(
    parsed.listings.map((l) => ({ ...l, product_id: prev.get(l.ser)?.product_id ?? null })),
    await activeProducts(adminDb),
  )

  let changed = 0
  const rows = parsed.listings.map((l) => {
    const before = prev.get(l.ser)
    const isChanged = priceChanged(before, l)
    if (isChanged && before) changed++
    const { max_krw: _max, ...stored } = l
    return {
      ...stored,
      listed: true,
      suggested_product_id: before?.product_id ? null : suggestions.get(l.ser) ?? null,
      fetched_at: nowIso,
      ...(isChanged ? { price_changed_at: nowIso } : {}),
    }
  })
  // price_changed_at 이 있는 줄과 없는 줄은 칸이 달라 나눠 쓴다 (없는 칸은 덮어쓰지 않게)
  for (const batch of [rows.filter((r) => 'price_changed_at' in r), rows.filter((r) => !('price_changed_at' in r))]) {
    if (batch.length === 0) continue
    const { error } = await adminDb.from('gcube_listings').upsert(batch, { onConflict: 'ser' })
    if (error) throw error
  }

  const seen = new Set(parsed.listings.map((l) => l.ser))
  const gone = [...prev.keys()].filter((ser) => !seen.has(ser))
  if (gone.length > 0) {
    const { error } = await adminDb.from('gcube_listings').update({ listed: false }).in('ser', gone)
    if (error) throw error
  }

  const result: GcubeFetchResult = {
    total: parsed.listings.length,
    changed,
    added: parsed.listings.filter((l) => !prev.has(l.ser)).length,
    unlisted: gone.length,
    dropped: parsed.dropped,
    suggested: suggestions.size,
  }
  await recordGpuAudit(adminDb, { actor, actionType: 'gcube_price_collected', detail: { ...result, source: GCUBE_PRICE_URL } })
  revalidateGpu()
  return result
}

export interface GcubeLinkInput {
  ser: number
  /** null 이면 연결 해제 */
  product_id: string | null
}

export type GcubeLinkError = 'not_found' | 'product_taken' | 'product_missing'

/** 사람이 확인한 연결을 쓴다, 모델 하나에 상품 하나 */
export async function linkGcubeListings(adminDb: Db, actor: string, actorId: string, links: GcubeLinkInput[]): Promise<{ updated: number } | GcubeLinkError> {
  const sers = links.map((l) => l.ser)
  const { data: found, error: findErr } = await adminDb.from('gcube_listings').select('ser, product_id').in('ser', sers)
  if (findErr) throw findErr
  if ((found ?? []).length !== new Set(sers).size) return 'not_found'

  const productIds = links.map((l) => l.product_id).filter((id): id is string => !!id)
  if (new Set(productIds).size !== productIds.length) return 'product_taken'
  if (productIds.length > 0) {
    const { data: products, error } = await adminDb.from('gpu_products').select('id').in('id', productIds).is('deleted_at', null)
    if (error) throw error
    if ((products ?? []).length !== productIds.length) return 'product_missing'
    const { data: taken, error: takenErr } = await adminDb.from('gcube_listings').select('ser, product_id').in('product_id', productIds)
    if (takenErr) throw takenErr
    const moving = new Set(sers)
    if ((taken ?? []).some((t: { ser: number }) => !moving.has(t.ser))) return 'product_taken'
  }

  const nowIso = new Date().toISOString()
  // 해제 먼저: 같은 요청에서 모델을 다른 상품으로 옮길 때 유일 인덱스에 안 걸리게
  const ordered = [...links].sort((a, b) => Number(a.product_id != null) - Number(b.product_id != null))
  for (const l of ordered) {
    const patch = l.product_id
      ? { product_id: l.product_id, suggested_product_id: null, linked_at: nowIso, linked_by: actorId }
      : { product_id: null, linked_at: null, linked_by: null }
    const { error } = await adminDb.from('gcube_listings').update(patch).eq('ser', l.ser)
    if (error) {
      if (error.code === '23505') return 'product_taken'
      throw error
    }
    await recordGpuAudit(adminDb, { actor, actionType: 'product_updated', productId: l.product_id, detail: { gcube_ser: l.ser, gcube_link: l.product_id ? 'linked' : 'unlinked' } })
  }
  revalidateGpu()
  return { updated: links.length }
}
