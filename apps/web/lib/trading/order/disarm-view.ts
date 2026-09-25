/**
 * 화면이 무장을 **묻기만** 하는 자리 — 순수
 *
 * `order-job.ts` 는 `server-only` 라 시험과 화면이 import 할 수 없다.
 * 그리고 그 파일은 무장을 **푼다** — 화면이 그것을 부르면 화면을 여는 것만으로 풀린다.
 * 묻는 일과 푸는 일을 파일로 갈라 둔다.
 */

import { mustDisarm, disarmCancelsOrders, type DisarmContext } from './disarm.ts'

/** 지금 크론이 돌면 풀리나. **풀지는 않는다** */
export function wouldDisarm(ctx: DisarmContext): boolean {
  return mustDisarm(ctx)
}

/** 해제가 주문을 남기나. 화면이 이 사실을 말한다 (설계 §6) */
export function disarmLeavesOrders(): boolean {
  return !disarmCancelsOrders()
}
