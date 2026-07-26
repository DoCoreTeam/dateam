// lib/gpu/impact.ts — 삭제/변경 영향 프리뷰
//
// 엔티티 삭제 전 연결된 참조 건수를 산출하여 UI에 영향 범위를 노출한다.
// ?force=true 없이 영향 있는 행을 삭제하려 하면 차단 또는 경고 근거로 사용.

export type ImpactEntity =
  | 'gpu_product'
  | 'supply_quote'
  | 'direct_price'
  | 'availability_response'
  | 'pool_stock'
  | 'market_price'

export interface ImpactResult {
  /** 삭제/변경으로 영향 받는 총 참조 건수 */
  total: number
  /** 엔티티별 상세 */
  detail: Partial<Record<string, number>>
}

/**
 * 지정 엔티티 행의 삭제가 영향을 주는 참조 건수를 산출한다.
 *
 * @param db      service_role(adminClient) Supabase 클라이언트
 * @param entity  대상 엔티티 종류
 * @param id      대상 행의 UUID
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function countImpact(db: any, entity: ImpactEntity, id: string): Promise<ImpactResult> {
  const detail: Partial<Record<string, number>> = {}

  switch (entity) {
    case 'gpu_product': {
      const r = await countProductRefs(db, [id])
      Object.assign(detail, r)
      break
    }
    case 'supply_quote': {
      // supply_quote 자체는 자식 참조 없음 — is_selected 상태를 체크
      const { data } = await db.from('supply_quotes').select('is_selected, product_id').eq('id', id).single()
      detail['is_selected'] = data?.is_selected ? 1 : 0
      break
    }
    case 'direct_price': {
      // direct_price는 product 참조만 — 현행(is_current) 여부를 영향으로 간주
      const { data } = await db.from('direct_prices').select('is_current').eq('id', id).single()
      detail['is_current'] = data?.is_current ? 1 : 0
      break
    }
    case 'availability_response': {
      // 현행(is_current) 여부
      const { data } = await db.from('availability_responses').select('is_current').eq('id', id).single()
      detail['is_current'] = data?.is_current ? 1 : 0
      break
    }
    case 'pool_stock': {
      // 현행(is_current) 여부
      const { data } = await db.from('direct_pool_stock').select('is_current').eq('id', id).single()
      detail['is_current'] = data?.is_current ? 1 : 0
      break
    }
    case 'market_price': {
      // market_price는 자식 없음
      detail['references'] = 0
      break
    }
  }

  const total = Object.values(detail).reduce<number>((sum, v) => sum + (v ?? 0), 0)
  return { total, detail }
}

// product_id(또는 gpu_product_id)로 gpu_products를 참조하는 자식 테이블들의 참조 건수.
//  병합 RPC(174_gpu_products_merge_rpc.sql)가 열거한 FK 목록을 기준으로 삭제 영향 범위를 산출한다.
//  일부 테이블은 deleted_at 컬럼이 없으므로(직접 참조), 알려진 3개에만 소프트삭제 필터를 적용한다.
//  best-effort — 테이블/컬럼 부재 시 count는 null→0으로 무시(프리뷰 목적, 비치명적).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countProductRefs(db: any, ids: string[]): Promise<Partial<Record<string, number>>> {
  const detail: Partial<Record<string, number>> = {}
  if (ids.length === 0) return detail
  const byProduct = (table: string, softDelete = false) => {
    let q = db.from(table).select('id', { count: 'exact', head: true }).in('product_id', ids)
    if (softDelete) q = q.is('deleted_at', null)
    return q
  }
  const [q, dp, ar, ps, gc, tp, cm] = await Promise.all([
    byProduct('supply_quotes', true),
    byProduct('direct_prices', true),
    byProduct('availability_responses', true),
    byProduct('direct_pool_stock'),
    byProduct('gcube_price_checks'),
    byProduct('gpu_product_term_prices'),
    db.from('competitor_product_mapping').select('id', { count: 'exact', head: true }).in('gpu_product_id', ids),
  ])
  detail['supply_quotes'] = q.count ?? 0
  detail['direct_prices'] = dp.count ?? 0
  detail['availability_responses'] = ar.count ?? 0
  detail['pool_stock'] = ps.count ?? 0
  detail['gcube_price_checks'] = gc.count ?? 0
  detail['term_prices'] = tp.count ?? 0
  detail['competitor_mapping'] = cm.count ?? 0
  return detail
}

/**
 * 모델(구성 여러 개) 일괄 삭제의 영향 범위 — 주어진 gpu_products id 배열 전체를 참조하는 자식 건수 합계.
 * 스펙관리 '모델 삭제'(base 모델 = 폼팩터·장수 구성 여러 개 일괄)에서 사용.
 *
 * @param db          service_role(adminClient) Supabase 클라이언트
 * @param productIds  삭제 대상 gpu_products id 배열
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function countModelImpact(db: any, productIds: string[]): Promise<ImpactResult> {
  const detail = await countProductRefs(db, productIds)
  const total = Object.values(detail).reduce<number>((sum, v) => sum + (v ?? 0), 0)
  return { total, detail }
}
