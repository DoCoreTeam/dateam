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
// 프로바이더 실패 → 사람이 읽을 문장. 호스트에 이미 있는 SSOT 를 그대로 쓴다
// (재사용·단일구현 정책 — CRM 이 같은 표를 따로 만들면 언젠가 한쪽만 갱신된다)
import { classifyProviderError } from '../../ai-chat/provider-errors.ts'
// 갈아탄 사실을 말하는 문장 — AI 채팅이 쓰는 그 한 줄을 그대로 쓴다
import { formatFallbackNotice } from '../../ai-chat/model-chain.ts'
/*
  **한 겹**(가림 · 호출 원장 · 전송 원장). `@ax/ai-gateway` 를 앱에 붙인 자리다.

  왜 러너가 지나야 하나: CRM AI 열둘이 전부 여기를 지난다. 서비스마다 붙이면
  언젠가 한 곳이 빠지고, 빠진 그 길로 **회사명과 사람 이름과 연락처가 맨몸으로 나간다**.
  실제로 그랬다 — 등재부(`lib/policy/pii-gateway-guard.test.ts`) 열 줄에 CRM 러너가 없었고,
  명함·딜 메모·회의 내용이 가림도 기록도 없이 벤더로 갔다(실측 2026-09-19).
*/
import {
  guardedText, guardedMedia, PiiNotMaskedError,
  type AiLedger, type GuardedCallContext,
} from '../../ai/guarded-call.ts'
import { serverAiLedger } from '../../ai/ledger.ts'

export type AiRunKind = 'MEETING_EXTRACT' | 'QUICK_CREATE' | 'ENRICH' | 'FIELD_FILL' | 'ASSISTANT'

export interface AiPrompt {
  /** 예: "quick_create@v1.0.0" — 기록에 남아 나중에 이 답이 어느 프롬프트에서 나왔는지 안다 */
  version: string
  build: (input: string) => string
}

/**
 * 웹 검색으로 답을 만들었을 때의 **출처**.
 *
 * 붙여넣기 경로는 근거가 원문 인용이었다(enrich 규칙 ③). 그런데 웹 경로에는
 * 인용할 원문이 없다 — 대신 **어느 페이지에서 읽었는지**가 근거다.
 * 근거가 없으면 사람은 제안을 수락할지 판단할 수 없고, 판단할 수 없는 제안은
 * 인박스를 안 보게 만든다.
 */
export interface AiSource {
  url: string
  title: string
}

export interface AiAdapter {
  /** 모델 별칭 — CrmAppSetting 에서 온다. 코드에 모델명을 하드코딩하지 않는다(명세 §351) */
  readonly model: string
  /**
   * 그림이나 소리를 함께 보내나.
   *
   * **글자 가림이 안 닿는 갈래**다. 있으면 러너가 매체 길로 간다 — 가린 척하지 않고
   * 나간 사실과 크기만 원장에 남기고, 답에 실려 온 개인정보를 그때 셈한다.
   */
  readonly media?: { kind: 'image' | 'audio'; bytes: number }
  /**
   * 웹 검색을 켜고 부르는 어댑터인가.
   *
   * 실패를 기록할 때 이 값이 필요하다 — 웹 검색 한도는 일반 한도와 **다른 바구니**라
   * 관리자에게 줄 답도 다르다("모델을 바꾸세요"는 웹 검색 한도에는 안 먹힌다).
   */
  readonly webSearch?: boolean
  complete(prompt: string): Promise<{
    text: string
    tokensIn: number
    tokensOut: number
    /** 웹 검색을 켠 어댑터만 채운다. 안 켰으면 undefined — "출처 없음"과 "검색 안 함"은 다르다 */
    sources?: AiSource[]
    /**
     * **실제로 답한** 공급자·모델. 고른 것과 다를 수 있다 — 한도에 걸리면 갈아타기 때문이다.
     *
     * 안 주는 어댑터(mock·옛 구현)도 있으므로 선택이다. 안 주면 러너가 `adapter.model` 을 쓴다.
     * 주면 **그 값이 기록에 남는다** — 고른 것을 적으면 사용량 집계가 거짓이 된다.
     */
    usedProvider?: string
    usedModel?: string
  }>
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
  /**
   * 이 호출에 나올 수 있는 **아는 이름**. 규칙으로는 이름이 안 잡힌다.
   *
   * 기본은 안 주는 것이다 — 목록을 읽는 것이 호출마다 질의 한 번이고, 이름을 가리면
   * 그 이름을 놓고 판단하는 기능(회사 보강 따위)의 답이 달라질 수 있다.
   * 필요한 서비스가 스스로 준다. 안 줘도 이메일·전화·사업자번호는 그대로 가려진다.
   */
  knownNames?: readonly string[]
  /** 원장. 안 주면 서버 기본값이 진짜로 적는다 */
  ledger?: AiLedger
}

export interface RunResult<T> {
  output: T
  runId: string
  /** 웹 검색을 썼다면 출처 — 이 값이 제안의 근거로 그대로 넘어간다 */
  sources?: AiSource[]
  /**
   * 고른 모델이 막혀 **다른 것이 답했을 때** 그 사실을 알리는 한 줄.
   *
   * **조용히 바꾸지 않는다.** 비용과 품질이 달라지는 일이라 모르고 지나가면 안 된다.
   * 안 갈아탔으면 undefined 다 — 「그대로 썼다」는 말할 필요가 없다.
   */
  switchedNote?: string
}

/** 명세 3.1-8 "AI 파싱 2회 실패" — 한 번 더 묻고 끝낸다. 무한 재시도는 비용만 태운다 */
const MAX_ATTEMPTS = 2

/** 비용을 모르는 호출도 최소한 이만큼은 잡는다(센트) — 0 으로 두면 상한 0 을 뚫는다 */
const MIN_ESTIMATE_MINOR_USD = BigInt(1)

export async function runAi<T>(opts: RunOptions<T>): Promise<RunResult<T>> {
  const { db, workspaceId, kind, prompt, input, inputRef, parse, adapter } = opts
  const startedAt = Date.now()
  const estimate = opts.estimateMinorUsd ?? MIN_ESTIMATE_MINOR_USD

  /**
   * 한 겹에 넘기는 맥락.
   *
   * **`let` 이 아니라 고정 객체다.** 호출 중에 `modelName`·`providerId` 가 채워지고
   * 한 겹이 호출 뒤에 그 값을 읽는다 — 그래서 같은 객체여야 한다.
   */
  const ctx: GuardedCallContext = {
    surface: `crm/${kind.toLowerCase()}`,
    purpose: kind,
    modelName: adapter.model,
    providerId: null,
    media: adapter.media?.kind,
    knownNames: opts.knownNames,
  }
  type MediaContext = GuardedCallContext & { media: 'image' | 'audio' }
  const ledger = opts.ledger ?? serverAiLedger()

  /**
   * 갈아탔으면 한 줄로. 문장은 `formatFallbackNotice` 한 곳에서 온다 —
   * 같은 사실을 화면마다 다르게 적으면 사용자가 같은 일을 다른 일로 읽는다.
   */
  const switchedNote = (): string | undefined => {
    if (usedModel === adapter.model) return undefined
    return formatFallbackNotice({
      fromLabel: '설정 모델', fromModel: adapter.model,
      toLabel: usedProvider ?? '다른 공급자', toModel: usedModel,
    })
  }

  // 예산 확인 + 예상 비용 선점. 차단이면 여기서 BUDGET_BLOCKED 로 끝난다 —
  // 호출한 뒤 정산하면 이미 돈이 나간 뒤다(명세 3.6-1).
  await reserveBudget(workspaceId, estimate)

  let lastError: unknown = null
  let tokensIn = 0
  let tokensOut = 0
  let sources: AiSource[] | undefined

  /**
   * 마지막 실패가 **모델에 닿지 못한** 실패였나(키 없음·할당량 소진·시간 초과),
   * 아니면 답은 왔는데 **못 읽은** 실패였나.
   *
   * 둘을 구분하지 않으면 어느 쪽이든 "AI 가 내용을 이해하지 못했습니다"로 끝난다.
   * 실측(2026-08-21): Gemini 가 429(할당량 소진)를 줬는데 화면에는 그 문구가 떴다 —
   * 읽은 사람은 프롬프트나 입력을 의심하며 **원인이 아닌 곳을 고친다.**
   * 이 파일은 DB 쓰기 실패에 대해 이미 같은 경고를 적어 뒀는데(아래), 정작 모델 호출 쪽이 안 막혀 있었다.
   */
  let transportFailed = false

  /**
   * **실제로 답한** 공급자·모델. 어댑터가 알려 주면 그 값이 기록에 남는다.
   *
   * 안 알려 주는 어댑터(mock·옛 구현)도 있으므로 기본은 고른 모델이다.
   * 이 구분이 없으면 한도에 걸려 갈아탄 뒤에도 기록은 고른 모델을 가리키고,
   * 사용량 집계가 «쓰지 않은 모델» 에 쌓인다.
   */
  let usedModel: string = adapter.model
  let usedProvider: string | null = null

  /** 실패로 끝낼 때 남길 것 — 기록과 정산은 어느 실패든 똑같이 해야 한다 */
  const recordFailure = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).crmAiRun.create({
      data: {
        kind, model: usedModel, promptVersion: prompt.version,
        status: 'FAILED', inputRef, tokensIn, tokensOut,
        latencyMs: Date.now() - startedAt,
        error: lastError instanceof Error ? lastError.message.slice(0, 500) : String(lastError).slice(0, 500),
      },
    }).catch(() => undefined)

    /**
     * 관리자가 읽는 곳에도 남긴다.
     *
     * `crm_ai_run` 은 실패를 제대로 쌓고 있었는데 **읽는 화면이 0개**였다(C-3).
     * 표에 있는 것과 사람이 보는 것은 다른 문제다 — 아무도 안 보면 없는 것과 같다.
     */
    const { recordSystemEventAsync } = await import('../../system-log/record.ts')
    await recordSystemEventAsync({
      source: 'crm_ai', error: lastError, feature: kind, blocksUser: true,
      workspaceId, hint: usedModel,
      // webSearch 를 실어 보낸다 — 해결책이 이 값으로 갈린다(playbook.ts)
      context: { kind, promptVersion: prompt.version, tokensIn, tokensOut, webSearch: adapter.webSearch === true },
    })

    // 실패해도 쓴 토큰만큼은 정산한다 — 실패한 호출도 돈이 나간다.
    // 선점분을 그대로 두면 실패가 쌓일수록 남은 예산이 실제보다 적게 보인다.
    await settleBudget(
      workspaceId, estimate, opts.costOf ? opts.costOf(tokensIn, tokensOut) : BigInt(0),
    ).catch(() => undefined)
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let text: string
    try {
      /**
       * 벤더에 닿는 일은 **한 겹을 지나서** 한다 — 가리고, 적고, 되돌린다.
       *
       * `ctx` 를 **복사하지 않고 그대로 넘긴다.** 한 겹은 호출이 끝난 뒤에 이 값을 읽어
       * 원장을 적는데, 실제로 답한 모델은 그 호출 안에서야 정해지기 때문이다.
       * 스프레드로 복사하면 원장에 «고른 모델» 이 남고 집계가 거짓이 된다.
       */
      const send = async (masked: string) => {
        const r = await adapter.complete(masked)
        // 출처는 파싱보다 **먼저** 잡는다 — 파싱이 실패해 한 번 더 물었을 때
        // 첫 시도에서 본 페이지가 사라지면 근거 없는 제안이 된다.
        if (r.sources && r.sources.length > 0) sources = r.sources
        if (r.usedModel) { usedModel = r.usedModel; ctx.modelName = r.usedModel }
        if (r.usedProvider) { usedProvider = r.usedProvider; ctx.providerId = r.usedProvider }
        return { text: r.text, inputTokens: r.tokensIn, outputTokens: r.tokensOut }
      }

      const built = prompt.build(input)
      const res = adapter.media
        // 그림·소리는 **가린 척하지 않는다.** 나간 사실과 크기만 남기고,
        // 답에 실려 온 개인정보는 돌아온 뒤에 셈한다
        ? await guardedMedia(adapter.media.bytes, ctx as MediaContext, ledger, () => send(built))
        : await guardedText(built, ctx, ledger, send)

      tokensIn += res.inputTokens ?? 0
      tokensOut += res.outputTokens ?? 0
      text = res.text
    } catch (e) {
      lastError = e
      transportFailed = true
      /**
       * 어댑터가 **사람에게 할 말을 이미 만들어 놨으면**(CrmError) 그대로 올린다.
       * "키가 없다"·"이 AI 는 웹 검색을 못 한다"는 다시 물어도 같은 결과라
       * 재시도가 시간만 쓰고, 우리가 다시 쓴 문구는 원래 문구보다 반드시 덜 구체적이다.
       */
      if (e instanceof CrmError) {
        await recordFailure()
        throw e
      }
      /**
       * **가린 뒤에도 개인정보가 남아 보내지 않은 것**은 다시 물어도 같다.
       *
       * 그대로 재시도하면 같은 자리에서 또 막히고, 끝에 가서는
       * 「AI 가 내용을 이해하지 못했습니다」로 끝난다 — 원인과 정반대의 말이다.
       */
      if (e instanceof PiiNotMaskedError) {
        await recordFailure()
        throw new CrmError('VALIDATION_FAILED',
          '개인정보가 들어 있어 AI 에 보내지 않았습니다. 주민등록번호·카드번호를 빼고 다시 시도해 주세요.')
      }
      continue
    }

    let output: T
    try {
      output = parse(text)
    } catch (e) {
      // 답은 왔는데 못 읽었다 — 이건 다시 물어볼 값어치가 있는 실패다
      lastError = e
      transportFailed = false
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
        kind, model: usedModel, promptVersion: prompt.version,
        status: 'DONE', inputRef, outputJson: output as unknown,
        tokensIn, tokensOut, latencyMs: Date.now() - startedAt,
      },
      select: { id: true },
    })

    // 실제 비용으로 정산한다. 선점분과의 차액만 움직인다.
    // costOf 가 없으면 비용을 계산할 방법이 없다는 뜻이므로 선점분을 그대로 되돌린다 —
    // 안 그러면 mock 어댑터가 도는 것만으로 예산이 줄어든다.
    await settleBudget(workspaceId, estimate, opts.costOf ? opts.costOf(tokensIn, tokensOut) : BigInt(0))

    return { output, runId: run.id, sources, switchedNote: switchedNote() }
  }

  // 실패도 기록한다 — 실패가 안 남으면 "왜 안 됐지"를 사용자에게 물어보게 된다.
  await recordFailure()

  /**
   * **모델에 닿지 못한** 실패는 그렇게 말한다.
   *
   * 프로바이더가 준 사유(429 할당량 소진, 5xx 등)를 짧게 실어 보낸다 —
   * 그게 없으면 사용자도 다음 사람도 어디를 봐야 할지 모른다.
   */
  if (transportFailed) {
    /**
     * 원문을 그대로 올리지 않는다.
     *
     * 실측(2026-08-21): 화면에 `Gemini API 오류 (429): { "error": { "code": 429, "message":
     * "You exceeded your current quota..."` 가 통째로 떴다. 원인은 맞았지만 **읽을 수 있는 말이 아니다** —
     * 사용자는 무엇을 해야 하는지 알 수 없다.
     */
    const provider = classifyProviderError(lastError)
    /**
     * **한도·모델 사용불가는 다른 코드로 던진다**(v0.7.574).
     *
     * 예전엔 전부 `VALIDATION_FAILED`(400) 였다. 그래서 두 가지가 동시에 잘못됐다:
     *   ① 화면에 "입력값을 확인해 주세요" 계열로 나갔다 — 입력은 멀쩡했다
     *   ② 여러 건을 도는 호출부의 **중단 조건에 안 걸렸다** — 한도가 소진됐는데도
     *      20곳을 끝까지 돌아 회사당 2회 재시도, **최대 40번의 확정된 실패 호출**이 나갔다.
     *
     * `availability` 가 있다는 것은 프로바이더가 "지금은 이 모델을 못 쓴다"고 말했다는 뜻이다
     * (`limited` = 한도 초과 · `unavailable` = 요금제에서 사용 불가). 다시 물어도 결과가 같다.
     */
    throw new CrmError(
      provider.availability ? 'PROVIDER_QUOTA' : 'VALIDATION_FAILED',
      provider.message,
    )
  }

  throw new CrmError('AI_PARSE_FAILED',
    'AI 가 내용을 이해하지 못했습니다. 원문은 그대로 두었으니 다시 시도하거나 직접 입력해 주세요.')
}
