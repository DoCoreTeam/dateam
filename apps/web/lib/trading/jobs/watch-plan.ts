/**
 * 이번 분의 감시 계획 — **순서가 곧 규칙이다** (명세 §10.2)
 *
 * ## 왜 순서를 값으로 두나
 *
 * 「열린 포지션 위험 → 손절 보호 → 일일 한도 → 당일 청산 → 수익 목표 → 새 신호」.
 * 이 순서를 코드 흐름으로만 적으면, 한 줄을 위로 옮기는 일이 **아무 표시도 안 남기고**
 * 규칙을 바꾼다. 새 신호를 먼저 보게 되면 포지션이 위험한 분에 신호가 먼저 뜨고,
 * 사람은 위험을 늘리는 쪽으로 움직인다.
 *
 * ## 왜 남은 시간을 여기서 보나
 *
 * 크론 한 번은 50초 안에 끝나야 한다(§14.3). 넘으면 다음 분 실행과 겹치고,
 * 겹친 둘이 같은 판단을 두 번 부른다. 그래서 **남은 일을 다음 실행으로 미룬다** —
 * 미룬 사실을 사유에 남긴다, 조용히 안 하면 「했는데 아무 일 없었다」와 구별이 안 된다.
 *
 * 미룰 때도 **열린 포지션 감시는 안 미룬다.** 그것이 §10.2 의 「어떤 경우에도 안 멈춤」이다.
 */

import { WATCH_ORDER, watchTasks, type WatchTask, type WatchContext } from '../gate/safety.ts'

export type { WatchTask, WatchContext }
export { WATCH_ORDER, watchTasks }

/** 이 일은 시간이 모자라도 미루지 않는다 */
export const NEVER_DEFERRED: readonly WatchTask[] = ['open_position_risk', 'protection']

export interface BudgetInput {
  tasks: readonly WatchTask[]
  /** 이번 실행이 시작한 때부터 지난 밀리초 */
  elapsedMs: number
  /** 한 실행의 상한 (`RUN_BUDGET_MS`) */
  budgetMs: number
  /** 일 하나에 걸릴 것으로 보는 밀리초 */
  perTaskMs: number
}

export interface BudgetPlan {
  run: WatchTask[]
  deferred: WatchTask[]
}

/**
 * 남은 시간 안에 무엇까지 하나.
 *
 * 안 미루는 일은 먼저 자리를 잡고, 나머지가 남은 시간을 나눠 쓴다.
 * 시간이 이미 다 지났어도 안 미루는 일은 한다 — 늦게라도 보는 것이 안 보는 것보다 낫다.
 */
export function planWithinBudget(input: BudgetInput): BudgetPlan {
  const mustRun = input.tasks.filter((t) => NEVER_DEFERRED.includes(t))
  const rest = input.tasks.filter((t) => !NEVER_DEFERRED.includes(t))

  const remainingMs = input.budgetMs - input.elapsedMs - mustRun.length * input.perTaskMs
  const canRun = input.perTaskMs > 0 ? Math.max(0, Math.floor(remainingMs / input.perTaskMs)) : rest.length

  const run = [...mustRun, ...rest.slice(0, canRun)]
  const deferred = rest.slice(canRun)
  // 순서를 지켜 돌려준다 — 안 미루는 일을 앞으로 뽑았어도 §10.2 순서가 그것들을 앞에 둔다
  run.sort((a, b) => WATCH_ORDER.indexOf(a) - WATCH_ORDER.indexOf(b))
  return { run, deferred }
}

/** 실행 기록에 실을 한 줄. 무엇을 하고 무엇을 미뤘나 */
export function watchReason(plan: BudgetPlan): string {
  const ran = plan.run.length > 0 ? `watch=${plan.run.join('+')}` : 'watch=none'
  return plan.deferred.length > 0 ? `${ran},deferred=${plan.deferred.join('+')}` : ran
}
