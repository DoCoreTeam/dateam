// L1 — GPU 단일 쓰기 서비스 (docs 05 §6)
//
// supply_quotes / availability_responses / suppliers 변경의 단일 통로.
// 라우트는 raw insert/update 대신 이 함수들을 호출한다 → per-card 환산·dedup·
// supplier 가드·캐시 무효화가 한 곳에 집약되어 "한 번 고치면 전 경로 반영".
//
// 모든 변경 함수는 성공 시 revalidateGpu()로 4개 메뉴 캐시를 원자 무효화한다.

import { revalidateGpu } from './revalidate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** 이름으로 공급사 find-or-create (단일 경로) */
export async function findOrCreateSupplier(
  db: Db,
  adminDb: Db,
  name: string | null | undefined
): Promise<string | null> {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return null
  const { data: existing } = await db
    .from('suppliers')
    .select('id')
    .ilike('name', trimmed)
    .limit(1)
  if (existing?.[0]?.id) return existing[0].id
  const { data: created } = await adminDb
    .from('suppliers')
    .insert({ name: trimmed })
    .select('id')
    .single()
  return created?.id ?? null
}

/** 공급사 미지정 견적에 공급사 지정 (docs 01 §4) */
export async function assignSupplierToQuote(
  db: Db,
  adminDb: Db,
  quoteId: string,
  opts: { supplierId?: string | null; supplierName?: string | null }
): Promise<{ ok: true; supplier_id: string } | { ok: false; error: string }> {
  let supplierId = opts.supplierId ?? null
  if (!supplierId && opts.supplierName) {
    supplierId = await findOrCreateSupplier(db, adminDb, opts.supplierName)
  }
  if (!supplierId) return { ok: false, error: '공급사를 지정해야 합니다' }

  const { error } = await adminDb
    .from('supply_quotes')
    .update({ supplier_id: supplierId })
    .eq('id', quoteId)
  if (error) return { ok: false, error: error.message }

  revalidateGpu()
  return { ok: true, supplier_id: supplierId }
}

/** 가용량(재고 수량) 응답 기록 — 같은 product×supplier의 이전 current는 비활성화 */
export async function recordAvailability(
  db: Db,
  adminDb: Db,
  input: {
    productId: string
    supplierId: string | null
    status: string
    respQty: number | null
    isTotalCapacity?: boolean
    unitPriceUsd?: number | null
    actor: string
    isTest?: boolean
    freshnessHours?: number
  }
): Promise<{ ok: true; record: unknown } | { ok: false; error: string }> {
  const receivedAt = new Date().toISOString()
  const expiresAt = new Date(receivedAt)
  expiresAt.setHours(expiresAt.getHours() + (input.freshnessHours ?? 72))

  // 이전 current 비활성화 (같은 product×supplier)
  let deactivate = db
    .from('availability_responses')
    .update({ is_current: false })
    .eq('product_id', input.productId)
    .eq('is_current', true)
  deactivate = input.supplierId
    ? deactivate.eq('supplier_id', input.supplierId)
    : deactivate.is('supplier_id', null)
  await deactivate

  const { data: record, error } = await db
    .from('availability_responses')
    .insert({
      product_id: input.productId,
      supplier_id: input.supplierId,
      status: input.status,
      resp_qty: input.respQty != null ? Math.max(0, input.respQty) : null,
      is_total_capacity: input.isTotalCapacity === true,
      unit_price_usd: input.unitPriceUsd ?? null,
      channel: 'own',
      received_at: receivedAt,
      expires_at: expiresAt.toISOString(),
      is_current: true,
      confirmed_by: input.actor,
      confirmed_at: receivedAt,
      is_test: input.isTest === true,
    })
    .select()
    .single()

  if (error) return { ok: false, error: error.message }

  await adminDb.from('gpu_audit_logs').insert({
    actor: input.actor,
    action_type: 'availability_registered',
    product_id: input.productId,
    detail: { status: input.status, resp_qty: input.respQty, supplier_id: input.supplierId, is_test: input.isTest === true },
  })

  revalidateGpu()
  return { ok: true, record }
}
