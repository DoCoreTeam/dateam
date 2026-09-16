/**
 * 정리 한 번에 AI 를 부를 때 쓸 **시간** — SSOT
 *
 * ## 왜 생겼나 (실측 2026-09-14)
 *
 * 「미팅 끝내기」는 정리와 5축 추출을 잇달아 돌리고, 라우트 상한은 300초다.
 * 그래서 끝내기는 정리에 170초만 준다(`finish/route.ts`). 그런데 정리는 그 예산을
 * **반만** 봤다 — 구간 압축 루프는 `budget.cap()` 을 쓰는데, 마지막 종합 호출은
 * `overallTimeoutMs: 240_000` 고정이었다.
 *
 * 결과: 압축이 잔여 65초까지 쓰고(≈105초), 종합이 자기 240초를 새로 써서 295초에 끝났다.
 * 5축은 시작하자마자 라우트가 죽었다 — `crm_ai_run` 에 행 하나 없이, `system_events` 에도
 * 없이 사라졌다(기록은 호출이 돌아온 뒤에 쓴다). 사용자는 정리가 됐다는 사실조차 못 봤다.
 *
 * ## 왜 순수 함수인가
 *
 * `digest-run.ts` 는 Supabase 와 Gemini 를 물고 있어 실브라우저 + 살아 있는 할당량
 * 말고는 밟을 수 없다(정책 E-6). 예산 산수만 떼어 두면 그 순간을 인자로 그대로 재현한다.
 * 같은 이유로 `finish-progress.ts` 도 컴포넌트 밖에 있다.
 */

/** 한 번의 AI 호출에 넘길 시간 두 가지 */
export interface CallBudget {
  /** 한 번의 시도에 허용하는 시간 */
  timeoutMs: number
  /** 재시도까지 포함해 이 호출 전체에 허용하는 시간 */
  overallTimeoutMs: number
}

/**
 * 남은 예산 안으로 상한을 깎는다.
 *
 * @param remainingMs 남은 예산. 예산이 없으면 `Infinity` 를 준다(정리 전용 라우트)
 * @param callMs   한 번의 시도 상한 (모듈 상수)
 * @param overallMs 이 호출 전체 상한 (모듈 상수)
 *
 * **최저 5초는 남긴다.** 0 을 넘기면 호출이 시작하자마자 끊겨,
 * 사용자에게는 「시간 초과」가 아니라 「네트워크 오류」로 보고된다.
 */
export function digestCallBudget(remainingMs: number, callMs: number, overallMs: number): CallBudget {
  const overallTimeoutMs = Number.isFinite(remainingMs)
    ? Math.max(MIN_CALL_MS, Math.min(overallMs, remainingMs))
    : overallMs
  return { timeoutMs: Math.min(callMs, overallTimeoutMs), overallTimeoutMs }
}

/** 예산이 바닥나도 이만큼은 준다 — 그 아래는 「네트워크 오류」로 둔갑한다 */
export const MIN_CALL_MS = 5_000
