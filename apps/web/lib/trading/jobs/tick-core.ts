/**
 * 1분마다 하는 일 — **선점한 것만 밖으로 나간다**
 *
 * ## 왜 창구를 주입받나
 *
 * 여기서 잠그려는 것은 「진 실행이 Jev 를 **안 부른다**」이다. 안 부르는 것은
 * 실제 DB 와 실제 벤더를 붙여 두면 셀 수 없다. 창구를 주입받으면 호출 수를 셀 수 있고,
 * 셀 수 있어야 규칙이 지켜지는지 안다.
 *
 * ## 왜 50초에서 멈추나
 *
 * 이 실행은 1분 안에 끝나야 한다(§14.3). Jev 대기만 10초이고 월물이 둘이면 더 걸린다.
 * 넘길 수 있는 일을 붙잡고 있다가 함수가 통째로 죽으면 **그 분의 기록이 아예 안 남는다** —
 * 남은 일을 다음 실행으로 넘기고, 넘긴 사실을 사유로 적는다.
 */

import type { JudgeName, JudgeResult, JudgeInput, Judge } from '../judge/types.ts'

/** 한 실행이 쓸 수 있는 시간. 넘으면 남은 판단기는 다음 실행 몫이다 */
export const RUN_BUDGET_MS = 50_000

export interface TickPorts {
  /** 선점. 성공하면 판단 행 id, 남이 잡았으면 null */
  claim(judge: JudgeName): Promise<string | null>
  /** 오래 멈춘 선점 이어받기 */
  takeOver(judge: JudgeName): Promise<string | null>
  /** 판단기 하나 부르기 */
  judges: ReadonlyMap<JudgeName, Judge>
  /** 결과 저장. 밖으로 나간 판단기는 요청·응답 시각이 함께 온다 */
  finish(id: string, judge: JudgeName, result: JudgeResult, at: Date, timing: JudgeTiming): Promise<void>
  now(): Date
}

/**
 * 밖으로 나간 시각. 안 나간 판단기는 둘 다 null 이다(§14.2).
 *
 * 이 둘이 비어 있으면 「봉 마감 → 판단」 지연을 서버·AI·사람으로 가를 수 없다 —
 * 실측 2026-09-26: 칼럼도 인자도 있었는데 아무도 안 넘겨서 전부 null 이었다.
 */
export interface JudgeTiming {
  aiRequestAt: Date | null
  aiResponseAt: Date | null
}

export interface TickOutcome {
  /** 실제로 부른 판단기 */
  ran: JudgeName[]
  /** 남이 이미 잡고 있어 건너뛴 판단기 */
  skipped: JudgeName[]
  /** 시간이 모자라 다음 실행으로 넘긴 판단기 */
  deferred: JudgeName[]
}

/**
 * 판단기들을 차례로 부른다.
 *
 * 선점은 판단기마다 따로다(유일 키에 `judge` 가 들어 있다). 그래야 Jev 가 늦은 분에도
 * `rule` 기록은 남는다 — 둘을 한 덩어리로 묶으면 느린 쪽이 빠른 쪽을 끌고 내려간다.
 */
export async function runJudges(
  order: readonly JudgeName[],
  input: JudgeInput,
  ports: TickPorts,
  startedAt: Date,
): Promise<TickOutcome> {
  const outcome: TickOutcome = { ran: [], skipped: [], deferred: [] }

  for (const name of order) {
    if (ports.now().getTime() - startedAt.getTime() >= RUN_BUDGET_MS) {
      // 여기서 멈춘다. 남은 것은 다음 실행이 같은 선점 규칙으로 집는다
      outcome.deferred.push(name)
      continue
    }

    const judge = ports.judges.get(name)
    if (!judge) { outcome.skipped.push(name); continue }

    let id = await ports.claim(name)
    if (!id) {
      // 남이 잡았다. 죽은 선점일 수도 있으니 이어받기를 한 번 물어본다
      id = await ports.takeOver(name)
    }
    if (!id) {
      /**
       * 남이 처리 중이다. **여기서 판단기를 부르지 않는다** — 이 한 줄이
       * 「돈이 두 번 나가고 알림이 두 번 가는 것」을 막는 전부다.
       */
      outcome.skipped.push(name)
      continue
    }

    const requestAt = judge.external ? ports.now() : null
    const result = await judge.judge(input)
    const responseAt = judge.external ? ports.now() : null
    await ports.finish(id, name, result, ports.now(), {
      aiRequestAt: requestAt,
      aiResponseAt: responseAt,
    })
    outcome.ran.push(name)
  }

  return outcome
}

/** 예정 분. 초와 밀리초를 떨어뜨려야 같은 분이 한 값이 된다 */
export function scheduledMinuteOf(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000)
}
