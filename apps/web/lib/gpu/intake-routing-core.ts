// 통합입력 라우팅 — 순수 계약/정규화 SSOT(외부 import 없음 → node:test 단위검증).
//  DB 부수효과(routeAvailability→repository→next/cache)는 intake-routing.ts. 라우트는 intake-routing.ts 사용.
//  분리 이유: 순수 계약(INTAKE_FIELD_MAP·resolveStatus)을 회귀테스트(golden-eval 등)가 next/cache 결합 없이 로드.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// ── 추출 필드 → 저장 대상 계약(SSOT). 새 추출 필드는 반드시 여기 등록(축4 게이트가 강제) ──
export const INTAKE_FIELD_MAP: Record<string, string> = {
  // 가격 → supply_quotes (confirm이 직접 INSERT)
  model_name: 'gpu_products.model_name',
  memory: 'gpu_products.memory',
  unit_price_usd: 'supply_quotes.unit_price_usd',
  original_price: 'supply_quotes.original_price',
  original_currency: 'supply_quotes.original_currency',
  original_unit: 'supply_quotes.original_unit',
  term: 'supply_quotes.term',
  term_months: 'supply_quotes.term_months',
  min_qty: 'supply_quotes.min_qty',
  valid_until: 'supply_quotes.valid_until',
  gpu_count: 'supply_quotes.gpu_count',
  supplier: 'suppliers.name',
  tier: 'gpu_products.tier',
  tier_suggestion: 'gpu_products.tier(advisory)',
  tier_reason: 'gpu_audit_logs(advisory)',
  // 재고 → availability_responses (recordAvailability 재사용)
  quantity: 'availability_responses',
  has_quantity_info: 'availability_responses(flag)',
}

export interface IntakeContext {
  db: Db
  adminDb: Db
  productId: string
  supplierId: string | null
  actor: string
  isTest: boolean
}

export interface RouteOutcome {
  target: string
  status: 'written' | 'skipped' | 'error'
  reason?: string
}

export function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
  return Number.isFinite(n) ? n : null
}

// 추출 quantity 객체 → 재고 status 정규화 (availability_responses_status_check enum에 정확히 매핑).
// 허용값: available_full · available_partial · out_of_stock · declined · pending
export function resolveStatus(q: Record<string, unknown>): string {
  if (q.out_of_stock_explicit === true) return 'out_of_stock'
  const respQty = num(q.resp_qty)
  if (respQty != null && respQty <= 0) return 'out_of_stock'
  if (respQty != null) return q.is_total_capacity === true ? 'available_full' : 'available_partial'
  const s = typeof q.status === 'string' ? q.status.toLowerCase() : ''
  if (/out|소진|없|declin|거절/.test(s)) return s.includes('declin') || s.includes('거절') ? 'declined' : 'out_of_stock'
  if (/full|전체|총/.test(s)) return 'available_full'
  if (/partial|일부|부분/.test(s)) return 'available_partial'
  return 'pending'
}

// 축4 계약게이트 헬퍼 — 추출 항목의 모든 키가 INTAKE_FIELD_MAP에 저장대상을 가지는지 검사.
// 매핑 없는 키 = 증발 위험 → 호출측(테스트)이 실패시킴.
export function unmappedFields(extractedKeys: string[]): string[] {
  return extractedKeys.filter((k) => !(k in INTAKE_FIELD_MAP))
}

// recordAvailability(재고 SSOT writer) 시그니처 — 주입용. 실구현은 repository.ts, 테스트는 fake.
export type RecordAvailabilityFn = (
  db: Db, adminDb: Db,
  args: { productId: string; supplierId: string | null; status: string; respQty: number | null; isTotalCapacity: boolean; actor: string; isTest: boolean },
) => Promise<{ ok: boolean; error?: string }>

// 재고 섹션 라우팅(순수 결정 + 주입된 writer). intake-routing.ts가 실 recordAvailability 주입,
//  테스트는 fake 주입(모듈모킹·next/cache 결합 불필요). 멱등: 같은 product×supplier 1건 current.
export async function routeAvailability(
  ctx: IntakeContext,
  quantity: unknown,
  record: RecordAvailabilityFn,
): Promise<RouteOutcome> {
  if (!quantity || typeof quantity !== 'object') {
    return { target: 'availability_responses', status: 'skipped', reason: 'quantity 없음' }
  }
  const q = quantity as Record<string, unknown>
  const respQty = num(q.resp_qty)
  const hasSignal = respQty != null || typeof q.status === 'string' || q.out_of_stock_explicit === true
  if (!hasSignal) {
    return { target: 'availability_responses', status: 'skipped', reason: 'resp_qty/status 없음(부분커밋)' }
  }
  const r = await record(ctx.db, ctx.adminDb, {
    productId: ctx.productId,
    supplierId: ctx.supplierId,
    status: resolveStatus(q),
    respQty,
    isTotalCapacity: q.is_total_capacity === true,
    actor: ctx.actor,
    isTest: ctx.isTest,
  })
  return r.ok
    ? { target: 'availability_responses', status: 'written' }
    : { target: 'availability_responses', status: 'error', reason: r.error }
}
