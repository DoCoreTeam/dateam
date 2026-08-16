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
 * 예산 확인·차감은 T1-07(budget.service)에서 이 파일의 `beforeRun` 자리에 붙는다.
 * 지금 비워 두되 자리를 만들어 둔 이유: 나중에 호출부를 전부 찾아다니지 않기 위해서다.
 */

import type { CrmDb } from '../db/client.ts'
import { CrmError } from '../domain/errors.ts'

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
}

export interface RunResult<T> {
  output: T
  runId: string
}

/** 명세 3.1-8 "AI 파싱 2회 실패" — 한 번 더 묻고 끝낸다. 무한 재시도는 비용만 태운다 */
const MAX_ATTEMPTS = 2

export async function runAi<T>(opts: RunOptions<T>): Promise<RunResult<T>> {
  const { db, kind, prompt, input, inputRef, parse, adapter } = opts
  const startedAt = Date.now()

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

  throw new CrmError('AI_PARSE_FAILED',
    'AI 가 내용을 이해하지 못했습니다. 원문은 그대로 두었으니 다시 시도하거나 직접 입력해 주세요.')
}
