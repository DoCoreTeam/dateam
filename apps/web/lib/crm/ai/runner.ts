/**
 * AI 러너 (dacrm T1-05, 구현명세 §4)
 *
 * 모든 AI 호출이 지나는 한 곳이다. 여기 있어야 하는 이유는 셋이다.
 *
 *   1. **기록**. 무엇을 어떤 프롬프트·모델로 물었고 무엇이 나왔는지 CrmAiRun 에 남긴다.
 *      남기지 않으면 "AI 가 이상한 값을 넣었다"를 나중에 아무도 재현할 수 없다.
 *   2. **파싱 실패 처리**. 스키마에 안 맞으면 한 번 더 묻고, 그래도 안 되면 **레코드를 만들지 않고**
 *      AI_PARSE_FAILED 로 끝낸다(명세 3.1-8). 반쯤 파싱된 값으로 회사를 만들면 그게 더 나쁘다.
 *   3. **어댑터 경계**. 실제 모델을 붙이는 자리를 하나로 둔다.
 *      T1-09(HUMAN GATE)에서 키가 들어오기 전까지는 mock 어댑터가 고정 픽스처를 돌려준다 —
 *      키가 없다고 기능 개발이 멈추지 않게.
 *
 * **예산은 여기서만 확인한다**(T1-07). 호출부마다 확인하게 두면 언젠가 한 곳이 빠지고,
 * 빠진 그 경로로 예산 밖 호출이 나간다. 러너를 지나지 않는 AI 호출은 없어야 한다.
 */

import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'
import { reserveBudget, settleBudget } from '../services/budget.ts'

export type AiRunKind = 'MEETING_EXTRACT' | 'QUICK_CREATE' | 'ENRICH' | 'FIELD_FILL' | 'ASSISTANT'

export interface AiPrompt {
  /** 예: "quick_create@v1.0.0" — 기록에 남아 나중에 이 답이 어느 프롬프트에서 나왔는지 안다 */
  version: string
  build: (input: string) => string
}

export interface AiAdapter {
  /** 모델 별칭 — CrmAppSetting 에서 온다. 코드에 모델명을 하드코딩하지 않는다(명세 §351) */
  readonly model: string
  complete(prompt: string): Promise<{ text: string; tokensIn: number; tokensOut: number }>
}

export interface RunOptions<T> {
  db: CrmDb
  workspaceId: string
  kind: AiRunKind
  prompt: AiPrompt
  input: string
  /** 참조만 남긴다 — 원문을 복제하면 지워야 할 때 두 곳을 지워야 한다(명세 §492) */
  inputRef: Record<string, unknown>
  /** 파싱 + 검증. 실패하면 throw 하고, 러너가 한 번 더 묻는다 */
  parse: (text: string) => T
  adapter: AiAdapter
  /**
   * 이 호출의 예상 비용(센트). 안 주면 최소 1센트로 본다.
   *
   * 0 이 기본이면 안 되는 이유(실브라우저에서 잡음): 상한을 0 으로 둔 워크스페이스는
   * "AI 를 쓰지 않겠다"고 말한 것인데, 예상 0 짜리 호출은 그 선을 그냥 지나간다.
   * 비용을 모른다는 것이 공짜라는 뜻은 아니다 — 모르면 최소한으로 잡고 실제로 정산한다.
   */
  estimateMinorUsd?: bigint
  /** 실제 비용 계산 — 토큰 수를 받아 센트로. 없으면 정산하지 않는다 */
  costOf?: (tokensIn: number, tokensOut: number) => bigint
}

export interface RunResult<T> {
  output: T
  runId: string
}

/** 명세 3.1-8 "AI 파싱 2회 실패" — 한 번 더 묻고 끝낸다. 무한 재시도는 비용만 태운다 */
const MAX_ATTEMPTS = 2

/** 비용을 모르는 호출도 최소한 이만큼은 잡는다(센트) — 0 으로 두면 상한 0 을 뚫는다 */
const MIN_ESTIMATE_MINOR_USD = BigInt(1)

export async function runAi<T>(opts: RunOptions<T>): Promise<RunResult<T>> {
  const { db, workspaceId, kind, prompt, input, inputRef, parse, adapter } = opts
  const startedAt = Date.now()
  const estimate = opts.estimateMinorUsd ?? MIN_ESTIMATE_MINOR_USD

  // 예산 확인 + 예상 비용 선점. 차단이면 여기서 BUDGET_BLOCKED 로 끝난다 —
  // 호출한 뒤 정산하면 이미 돈이 나간 뒤다(명세 3.6-1).
  await reserveBudget(workspaceId, estimate)

  let lastError: unknown = null
  let tokensIn = 0
  let tokensOut = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let output: T
    try {
      const res = await adapter.complete(prompt.build(input))
      tokensIn += res.tokensIn
      tokensOut += res.tokensOut
      output = parse(res.text)
    } catch (e) {
      // 모델 호출·파싱 실패만 여기서 삼킨다 — 다시 물어볼 가치가 있는 실패다
      lastError = e
      continue
    }

    // 기록 실패는 **삼키지 않는다.**
    //
    // 처음엔 이 create 도 같은 try 안에 있었는데, enum 값 하나가 틀리자
    // "AI 가 내용을 이해하지 못했습니다"가 떴다. 답은 멀쩡했고 DB 가 거절한 것이었다.
    // 원인이 다른 실패를 같은 말로 덮으면 고칠 곳을 영영 못 찾는다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = await (db as any).crmAiRun.create({
      data: {
        kind, model: adapter.model, promptVersion: prompt.version,
        status: 'DONE', inputRef, outputJson: output as unknown,
        tokensIn, tokensOut, latencyMs: Date.now() - startedAt,
      },
      select: { id: true },
    })

    // 실제 비용으로 정산한다. 선점분과의 차액만 움직인다.
    // costOf 가 없으면 비용을 계산할 방법이 없다는 뜻이므로 선점분을 그대로 되돌린다 —
    // 안 그러면 mock 어댑터가 도는 것만으로 예산이 줄어든다.
    await settleBudget(workspaceId, estimate, opts.costOf ? opts.costOf(tokensIn, tokensOut) : BigInt(0))

    return { output, runId: run.id }
  }

  // 실패도 기록한다 — 실패가 안 남으면 "왜 안 됐지"를 사용자에게 물어보게 된다.
  // 이 기록마저 실패하면 원래 실패(AI_PARSE_FAILED)를 덮지 않도록 조용히 넘어간다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).crmAiRun.create({
    data: {
      kind, model: adapter.model, promptVersion: prompt.version,
      status: 'FAILED', inputRef, tokensIn, tokensOut,
      latencyMs: Date.now() - startedAt,
      error: lastError instanceof Error ? lastError.message.slice(0, 500) : String(lastError).slice(0, 500),
    },
  }).catch(() => undefined)

  // 실패해도 쓴 토큰만큼은 정산한다 — 실패한 호출도 돈이 나간다.
  // 선점분을 그대로 두면 실패가 쌓일수록 남은 예산이 실제보다 적게 보인다.
  await settleBudget(
    workspaceId, estimate, opts.costOf ? opts.costOf(tokensIn, tokensOut) : BigInt(0),
  ).catch(() => undefined)

  throw new CrmError('AI_PARSE_FAILED',
    'AI 가 내용을 이해하지 못했습니다. 원문은 그대로 두었으니 다시 시도하거나 직접 입력해 주세요.')
}
