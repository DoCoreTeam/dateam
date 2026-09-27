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

/**
 * 부른 판단기 하나의 결과.
 *
 * 신호 발행이 이것을 본다 — 판단 ID 가 있어야 §14.3 의 유일 키 `(판단 ID, 규칙 판)` 를 만들고,
 * 원점수가 있어야 「관망이 가장 높은가」를 잰다. 이름과 개수만 돌려주면 그 둘을 다시 읽어야 하고,
 * 다시 읽으면 **그 사이에 바뀐 값**을 보게 된다.
 */
export interface JudgeRunRecord {
  judge: JudgeName
  judgmentId: string
  result: JudgeResult
}

export interface TickOutcome {
  /** 실제로 부른 판단기 */
  ran: JudgeName[]
  /** 남이 이미 잡고 있어 건너뛴 판단기 */
  skipped: JudgeName[]
  /** 시간이 모자라 다음 실행으로 넘긴 판단기 */
  deferred: JudgeName[]
  /** 부른 것들의 결과. 신호 발행이 여기서 판단 ID 와 원점수를 가져간다 */
  results: JudgeRunRecord[]
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
  const outcome: TickOutcome = { ran: [], skipped: [], deferred: [], results: [] }

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
    outcome.results.push({ judge: name, judgmentId: id, result })
  }

  return outcome
}

/** 예정 분. 초와 밀리초를 떨어뜨려야 같은 분이 한 값이 된다 */
export function scheduledMinuteOf(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000)
}

/* ── 지금 장이 어느 국면인가 ───────────────────────────── */

/**
 * 장이 어느 국면인가 — **「봉이 없다」가 고장인지 아닌지를 가르는 값**
 *
 * 사용자 지적 2026-09-28: 「장이 안 열렸다는 거 뻔히 아는데 봉을 못 불러왔다 무슨 뜻인지?」
 *
 * 실측 2026-09-28 08:00~08:19 KST 실행 기록이 전부
 * `bar_not_ready|bar_retry=2/2,still_missing|…|broker=failed` 였다. 접속매매는 08:45 에
 * 시작하므로 그 시간에 1분 봉이 없는 것은 **정상**인데, 크론은 봉을 물어 보고 두 번 더 묻고
 * 「안 들어왔다」를 남겼다. 봉 판정이 세션 판정보다 **앞**에 있어서 `not_continuous_trading`
 * 가지에는 구조적으로 못 닿았기 때문이다.
 *
 * 주말·휴장일은 창 자체가 안 만들어져 이미 `no_session` 으로 제대로 말한다(실측 09-26·09-27).
 * 구멍은 **평일 장 시작 전과 끝난 뒤**뿐이라 그 둘을 여기서 이름 붙인다.
 */
export type MarketPhase =
  /** 아직 단일가도 시작 안 했다 */
  | 'before_open'
  /** 단일가 구간. 모으기는 하고 판단은 안 한다 (§6.1 · D-40) */
  | 'auction'
  /** 접속매매 중 */
  | 'open'
  /** 그날 장이 끝났다 */
  | 'after_close'

export interface PhaseWindow {
  openAuctionStart: Date | null
  continuousStart: Date
  continuousEnd: Date
  closeAuctionEnd: Date | null
}

export function marketPhaseOf(window: PhaseWindow, at: Date): MarketPhase {
  const t = at.getTime()
  if (t >= window.continuousStart.getTime() && t < window.continuousEnd.getTime()) return 'open'
  /**
   * 단일가 시작이 안 적힌 세션(야간)은 접속매매 시작을 그 자리로 본다 —
   * 그러면 「단일가 없는 장」에 없는 구간이 생기지 않는다
   */
  const auctionStart = (window.openAuctionStart ?? window.continuousStart).getTime()
  if (t < auctionStart) return 'before_open'
  if (t < window.continuousStart.getTime()) return 'auction'
  const closeEnd = (window.closeAuctionEnd ?? window.continuousEnd).getTime()
  if (t < closeEnd) return 'auction'
  return 'after_close'
}

/**
 * 지금 봉을 물어야 하나.
 *
 * **안 물어야 할 때 묻는 것이 두 가지를 망친다.** 하나는 사람이 읽는 사유가 거짓 고장이 되는 것,
 * 다른 하나는 장 전 계좌 조회 실패가 **연속 실패로 쌓여**(실측 broker_fail=9) 정작 장이 열릴 때
 * 안전 게이트 SG-02 를 닫는 것이다.
 */
export function shouldAskForBars(input: { phase: MarketPhase; isNight: boolean }): boolean {
  if (input.isNight) return true
  return input.phase === 'open' || input.phase === 'auction'
}
