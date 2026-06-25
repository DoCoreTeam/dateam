// 통합입력 추출 결과 → 대상 테이블 라우팅 SSOT (축2). 모든 confirm 경로가 이 모듈만 호출(단일구현).
// 정책: 같은 연계가 필요하면 새로 짜지 말고 여기에 추가. 재고 쓰기는 recordAvailability(repository) 재사용.
// 축4 계약게이트: 추출 필드는 전부 INTAKE_FIELD_MAP에 저장대상이 선언돼야 함(없으면 테스트가 차단 → 증발 방지).
//
// 순수 계약/정규화(INTAKE_FIELD_MAP·resolveStatus·unmappedFields·타입)는 intake-routing-core.ts로 분리
//   (next/cache 결합 없이 회귀테스트가 로드). 여기선 그걸 re-export + DB 부수효과(routeAvailability)만 둔다.

import { recordAvailability } from './repository.ts'
import { num, resolveStatus, type IntakeContext, type RouteOutcome } from './intake-routing-core.ts'

export * from './intake-routing-core.ts'

// 재고 섹션 라우팅 — quantity 있으면 recordAvailability(SSOT) 재사용. 멱등: 같은 product×supplier 1건 current.
export async function routeAvailability(ctx: IntakeContext, quantity: unknown): Promise<RouteOutcome> {
  if (!quantity || typeof quantity !== 'object') {
    return { target: 'availability_responses', status: 'skipped', reason: 'quantity 없음' }
  }
  const q = quantity as Record<string, unknown>
  const respQty = num(q.resp_qty)
  const hasSignal = respQty != null || typeof q.status === 'string' || q.out_of_stock_explicit === true
  if (!hasSignal) {
    return { target: 'availability_responses', status: 'skipped', reason: 'resp_qty/status 없음(부분커밋)' }
  }
  const r = await recordAvailability(ctx.db, ctx.adminDb, {
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

// 통합입력 라우팅 진입점 — 가격(supply_quotes)은 confirm이 직접 처리하므로, 여기선 부가 연계(재고 등)만.
// 반환: 각 대상별 처리결과(부분커밋 — 한 섹션 실패가 전체를 막지 않음).
export async function routeIntakeExtras(ctx: IntakeContext, merged: Record<string, unknown>): Promise<RouteOutcome[]> {
  const outcomes: RouteOutcome[] = []
  outcomes.push(await routeAvailability(ctx, merged.quantity))
  return outcomes
}
