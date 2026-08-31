// lib/forms/submit-guard.ts — 「사용자를 막는 제출」의 단일 구현(SSOT)
//
// ## 왜 필요한가 (실측 2026-08-31)
//
// 주간보고 저장이 프로덕션에서 실패했을 때 버튼이 **영원히 「저장 중…」**이었다.
// 원인은 서버가 아니라 화면의 모양이었다:
//
//   setLoading(true)
//   const res = await fetch(...)
//   const data = await res.json()          // ← 500 이 HTML 을 주면 여기서 던진다
//   if (!res.ok) { setError(...); setLoading(false); return }
//   ...
//                                          // ← 던지면 setLoading(false) 에 영영 못 온다
//
// 던지는 순간 진행 표시를 끄는 줄에 **도달하지 못한다**. 화면에는 오류도 안 뜬다.
// 사용자는 눌렀는데 아무 일도 안 일어나는 버튼을 몇 번이고 다시 누른다.
//
// 전수 조사 결과 같은 모양이 화면 20곳에 있었다. 그래서 각자 고치지 않고 **한 벌**로 모은다.
//
// 규칙은 셋이다 — 하나라도 빠지면 같은 일이 다시 난다.
//   ① **시간 제한**: 서버가 아무 응답도 안 주면 화면은 영원히 기다린다
//   ② **try/catch**: 던져도 사용자에게 읽을 수 있는 말이 뜬다
//   ③ **finally**: 어떤 경로로 끝나든 진행 표시를 되돌린다
//
// 가드: lib/forms/submit-guard.test.ts · lib/ui/deploy-fragile.test.ts

/**
 * 이보다 오래 걸리면 실패로 본다.
 * 정상 저장은 실측 0.3~1.5초라 15초는 넉넉하다 — 넉넉해야 느린 회선을 실패로 만들지 않는다.
 */
export const SUBMIT_TIMEOUT_MS = 15_000

/** 시간 초과로 끊었을 때 붙이는 표시 — 문구 판정에 쓴다(사용자에게는 안 보인다) */
export class SubmitTimeoutError extends Error {
  constructor() {
    super('SUBMIT_TIMEOUT')
    this.name = 'SubmitTimeoutError'
  }
}

/**
 * 실패를 **사용자가 읽을 수 있는 말**로 바꾼다.
 *
 * 「오류가 발생했습니다」는 아무것도 알려 주지 않는다. 무엇이 어긋났는지와
 * **지금 무엇을 하면 되는지**를 함께 준다. 그리고 쓴 글이 남아 있다는 것을 반드시 말한다 —
 * 사용자가 가장 먼저 걱정하는 것이 그것이다.
 */
export function submitFailureMessage(err: unknown): string {
  if (err instanceof SubmitTimeoutError) {
    return '제시간에 끝나지 않았습니다. 쓰신 내용은 그대로 있으니 다시 시도해 주세요.'
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return '요청이 중단됐습니다. 쓰신 내용은 그대로 있으니 다시 시도해 주세요.'
  }
  return '처리하지 못했습니다. 연결을 확인하고 다시 시도해 주세요. 쓰신 내용은 그대로 있습니다.'
}

interface SubmitGuardHandlers {
  /** 사용자에게 보일 실패 문구 — 화면의 오류 상태에 그대로 넣는다 */
  onError: (message: string) => void
  /** 성공·실패·시간초과 **무엇으로 끝나든** 불린다. 진행 표시를 여기서 되돌린다 */
  onDone: () => void
}

/**
 * 제출 본문을 감싼다. 어떤 경로로 끝나든 `onDone` 이 불린다.
 *
 * `signal` 을 fetch 에 넘기면 시간 초과 때 요청 자체가 끊긴다 —
 * 안 넘겨도 화면은 풀리지만, 넘기면 서버로 나간 요청도 함께 정리된다.
 *
 * @returns 본문이 정상으로 끝났으면 true — 성공했을 때만 할 일(임시저장 비우기 등)을 가른다
 */
export async function withSubmitGuard(
  run: (signal: AbortSignal) => Promise<void>,
  handlers: SubmitGuardHandlers,
  timeoutMs: number = SUBMIT_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)

  try {
    await run(controller.signal)
    return true
  } catch (err) {
    handlers.onError(submitFailureMessage(timedOut ? new SubmitTimeoutError() : err))
    return false
  } finally {
    clearTimeout(timer)
    handlers.onDone()
  }
}
