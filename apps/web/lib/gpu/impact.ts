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
      // gpu_product 삭제 시 연결된 supply_quotes / direct_prices / availability_responses 카운트
      const [qRes, dpRes, arRes] = await Promise.all([
        db.from('supply_quotes').select('id', { count: 'exact', head: true }).eq('product_id', id).is('deleted_at', null),
        db.from('direct_prices').select('id', { count: 'exact', head: true }).eq('product_id', id).is('deleted_at', null),
        db.from('availability_responses').select('id', { count: 'exact', head: true }).eq('product_id', id).is('deleted_at', null),
      ])
      detail['supply_quotes'] = qRes.count ?? 0
      detail['direct_prices'] = dpRes.count ?? 0
      detail['availability_responses'] = arRes.count ?? 0
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
