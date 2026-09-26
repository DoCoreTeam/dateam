/**
 * 확정 봉 재조회 — **같은 실행 안에서** (명세 §6.2 의사코드 `retryLater`)
 *
 * ## 왜 다음 분을 기다리면 안 되나
 *
 * 봉이 아직 안 왔을 때 그냥 돌아가면 다음 크론까지 **1분을 통째로 기다린다.**
 * 그 사이 그 봉은 도착해 있고, 우리는 1분 늦게 판단한다.
 * 1분 봉으로 판단하는 시스템에서 1분 지각은 한 판을 통째로 놓치는 것과 같다.
 *
 * 명세의 의사코드는 `retryLater()` 를 「같은 실행 안에서 몇 초 뒤 1~2회 재조회」로 적는다.
 *
 * ## 예산을 넘기면 안 한다
 *
 * 크론 한 판에 쓸 수 있는 시간이 정해져 있다(`RUN_BUDGET_MS`). 재조회가 그 예산을 먹으면
 * 뒤에 오는 일(감시·발행)이 밀리고, 밀린 일은 **다음 분에도 안 돌아온다** —
 * 그 분의 몫은 그 분에만 있다.
 */

export interface RetryPlanInput {
  /** 설정 `bar_retry_count`. 0 이면 다시 안 묻는다 */
  maxAttempts: number
  /** 설정 `bar_retry_delay_ms`. 0 이하면 다시 안 묻는다 */
  delayMs: number
  /** 이번 실행이 시작하고 지난 밀리초 */
  elapsedMs: number
  /** 이번 실행에 허락된 밀리초 */
  budgetMs: number
  /** 한 번 다시 묻는 데 드는 시간 어림값 */
  perAttemptMs: number
}

export interface RetryPlan {
  /** 실제로 몇 번 더 물을까 */
  attempts: number
  delayMs: number
  /** 왜 그 수인가. 실행 기록에 실린다 */
  reason: 'disabled' | 'no_budget' | 'budget_limited' | 'full'
}

/**
 * 남은 예산 안에서 몇 번 더 물을지 정한다.
 *
 * **모자라면 줄인다. 넘기지 않는다** — 넘기면 감시가 밀리고,
 * 감시가 밀린 분에는 열린 포지션을 아무도 안 본다.
 */
export function retryPlan(input: RetryPlanInput): RetryPlan {
  if (input.maxAttempts <= 0 || input.delayMs <= 0) {
    return { attempts: 0, delayMs: 0, reason: 'disabled' }
  }
  const remaining = input.budgetMs - input.elapsedMs
  const costPerAttempt = input.delayMs + Math.max(0, input.perAttemptMs)
  if (!Number.isFinite(remaining) || remaining <= costPerAttempt) {
    return { attempts: 0, delayMs: input.delayMs, reason: 'no_budget' }
  }
  const affordable = Math.floor(remaining / costPerAttempt)
  const attempts = Math.min(Math.floor(input.maxAttempts), affordable)
  return {
    attempts,
    delayMs: input.delayMs,
    reason: attempts < Math.floor(input.maxAttempts) ? 'budget_limited' : 'full',
  }
}

/** 실행 기록에 실을 한 줄. 몇 번 물어 몇 번째에 왔나 */
export function retryNote(plan: RetryPlan, used: number, confirmed: boolean): string {
  if (plan.attempts === 0) return `bar_retry=0(${plan.reason})`
  return `bar_retry=${used}/${plan.attempts}${confirmed ? ',confirmed' : ',still_missing'}`
}
