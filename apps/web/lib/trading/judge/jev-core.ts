/**
 * Jev 판단기 — **기다리다 못 받으면 기권한다**
 *
 * ## 왜 벤더 호출을 주입받나
 *
 * 「10초를 넘기면 기권한다」 「예산이 막히면 기권한다」는 **안 일어나는 일**이라
 * 실제 호출을 붙여 두면 시험할 수 없다. 못 시험하는 규칙은 지켜지는지 알 수 없고,
 * 이 규칙이 안 지켜지면 변동이 큰 순간(응답이 느려지는 때)에만 판단이 멈춘다 —
 * 하필 기회가 있는 순간만 골라 빠지는 편향이 된다(D-41).
 *
 * ## 기권은 실패가 아니다
 *
 * 기권도 기록한다(`status='abstain'`). 기권률을 변동성 구간별로 세어 봐야
 * 위 편향이 실제로 생겼는지 알 수 있다.
 */

import { buildJevPrompt, parseJevResponse, JEV_PROMPT_VERSION } from './jev-prompt.ts'
import type { Judge, JudgeInput, JudgeResult } from './types.ts'

/** 벤더까지 가는 길. 서버 배선(`jev.ts`)이 진짜 것을 끼워 준다 */
export type JevCaller = (prompt: string) => Promise<string>

export class JevBudgetDeniedError extends Error {
  readonly code = 'JEV_BUDGET_DENIED'
  constructor(reason: string) {
    super(reason)
    this.name = 'JevBudgetDeniedError'
  }
}

export interface JevOptions {
  call: JevCaller
  /** 설정 `jev_timeout_seconds`. 기본 10초 */
  timeoutMs: number
  modelVersion: string
  /** 시험이 시계를 밀 수 있게. 실제로는 setTimeout */
  delay?: (ms: number) => Promise<void>
}

const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 제한 시간이 이겼다는 표시. 문자열로 두면 모델이 그 글자를 답할 수 있다 */
const TIMED_OUT = Symbol('jev_timeout')
type TimedOut = typeof TIMED_OUT

export function createJevJudge(options: JevOptions): Judge {
  const delay = options.delay ?? defaultDelay

  return {
    name: 'jev',
    modelVersion: options.modelVersion,
    promptVersion: JEV_PROMPT_VERSION,

    async judge(input: JudgeInput): Promise<JudgeResult> {
      if (!(input.indicators.atr > 0)) {
        // 상대값을 만들 수 없다. 절대값을 대신 보내면 §7.3 의 규칙이 그 자리에서 깨진다
        return { status: 'abstain', abstainReason: 'atr_zero' }
      }

      const prompt = buildJevPrompt(input)

      /**
       * 제한 시간과 경주한다. 진 쪽은 버린다 —
       * 늦게 온 답으로 판단을 다시 하면 사람이 이미 못 쓰는 시점에 나온다.
       */
      let text: string | TimedOut
      try {
        text = await Promise.race<string | TimedOut>([
          options.call(prompt.text),
          delay(options.timeoutMs).then(() => TIMED_OUT),
        ])
      } catch (error) {
        if (error instanceof JevBudgetDeniedError) {
          return { status: 'abstain', abstainReason: `budget_denied:${error.message}` }
        }
        return {
          status: 'failed',
          abstainReason: `call_failed:${error instanceof Error ? error.message : 'unknown'}`,
        }
      }

      if (text === TIMED_OUT) {
        return { status: 'abstain', abstainReason: `timeout:${options.timeoutMs}ms` }
      }

      const parsed = parseJevResponse(text)
      if (!parsed.ok) return { status: 'abstain', abstainReason: `unreadable:${parsed.reason}` }

      // 원점수를 그대로 돌려준다. 보정도 신호 판단도 여기서 하지 않는다(M3)
      return { status: 'completed', rawScore: parsed.rawScore }
    },
  }
}

export { buildJevPrompt, JEV_PROMPT_VERSION }
