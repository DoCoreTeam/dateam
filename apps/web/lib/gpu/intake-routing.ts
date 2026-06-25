// 통합입력 추출 결과 → 대상 테이블 라우팅 SSOT (축2). 모든 confirm 경로가 이 모듈만 호출(단일구현).
// 정책: 같은 연계가 필요하면 새로 짜지 말고 여기에 추가. 재고 쓰기는 recordAvailability(repository) 재사용.
// 축4 계약게이트: 추출 필드는 전부 INTAKE_FIELD_MAP에 저장대상이 선언돼야 함(없으면 테스트가 차단 → 증발 방지).
//
// 순수 계약·라우팅 결정(routeAvailability 포함, recordAvailability 주입형)은 intake-routing-core.ts
//   (next/cache 결합 없이 테스트 로드). 여기선 실 recordAvailability를 주입 + re-export만 한다.

import { recordAvailability } from './repository.ts'
import { routeAvailability as routeAvailabilityCore, type IntakeContext, type RouteOutcome } from './intake-routing-core.ts'

export * from './intake-routing-core.ts'

// 재고 섹션 라우팅 — core에 실 recordAvailability(SSOT) 주입. 기존 호출처 시그니처 호환(ctx, quantity).
export function routeAvailability(ctx: IntakeContext, quantity: unknown): Promise<RouteOutcome> {
  return routeAvailabilityCore(ctx, quantity, recordAvailability)
}

// 통합입력 라우팅 진입점 — 가격(supply_quotes)은 confirm이 직접 처리하므로, 여기선 부가 연계(재고 등)만.
// 반환: 각 대상별 처리결과(부분커밋 — 한 섹션 실패가 전체를 막지 않음).
export async function routeIntakeExtras(ctx: IntakeContext, merged: Record<string, unknown>): Promise<RouteOutcome[]> {
  const outcomes: RouteOutcome[] = []
  outcomes.push(await routeAvailability(ctx, merged.quantity))
  return outcomes
}
