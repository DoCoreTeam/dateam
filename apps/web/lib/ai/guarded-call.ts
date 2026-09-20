/**
 * 개인정보가 밖으로 나가는 길에 두르는 한 겹 (기획서 4단계)
 *
 * ## 왜 관문을 그대로 안 쓰나
 *
 * `@ax/ai-gateway` 의 관문은 **모델 사슬과 등급 관문**까지 함께 가진다. 그 둘은
 * `rfp_ai_models` 와 문서 등급에 묶여 있어서, 등급이라는 개념이 없는 명함이나 일일업무가
 * 쓰려면 그쪽 세계를 통째로 들여와야 한다.
 *
 * 지금 급한 것은 사슬이 아니라 **가림과 기록**이다. 실측 2026-09-16: 개인정보가 지나는
 * 여덟 길이 전부 안 가리고 나가고 전송 기록도 없었다. 그래서 이 한 겹은 관문의
 * **가림과 기록만** 꺼내 기존 호출에 두른다. 호출처는 부르는 법을 안 바꾼다.
 *
 * ## 그림과 소리는 다르다
 *
 * 명함 사진과 회의 녹음은 글자가 아니라서 글자 가림이 애초에 안 닿는다. 그때는 가린 척
 * 하지 않는다. `media` 를 밝혀 두고 **나간 사실만** 원장에 남긴다. 안 가렸는데 가렸다고
 * 적힌 원장이 아무 기록도 없는 것보다 나쁘다.
 *
 * ## 받은 뒤에도 본다
 *
 * 가림은 나가는 쪽만 있고 들어오는 쪽이 없었다(기획서 12절 넷째). 전사처럼 **답에**
 * 개인정보가 실려 오는 길이 있어서, 돌아온 글자도 한 번 본다.
 */

import { maskPii, unmaskPii, hasUnmaskedPii, countByKind, type PiiHit } from '@ax/ai-gateway'
import { AI_CONTRACT_VERSION } from '@ax/ai-core'
import type { BudgetGate } from './budget-gate.ts'
import { BudgetDeniedError, decideBudget } from './budget.ts'

/*
  ## 예산 관문 (P0030 I08)

  가림과 기록이 지나는 이 자리가 **벤더로 나가기 직전의 마지막 공통 지점**이다.
  상한 확인을 창구마다 붙이면 언젠가 한 곳이 빠지고, 빠진 그 길로 예산 밖 호출이 나간다.

  실측 2026-09-20: 상한을 아는 자리가 0곳이라 하루 23,318건이 나갔다. 무료 등급 예산의
  38.9배이고, 그중 22,131건은 어차피 한도로 실패했다 — 보내 봐야 못 가는 호출이었다.

  ### 왜 창구를 갈아 끼울 수 있게 두나

  이 파일은 Supabase 를 안 끌어온다(끌어오면 순수 시험이 앱 별칭 설정을 요구한다).
  기본값은 **진짜로 세는 창구**이고, 안 주고 부를 수 있는 길이 곧 세는 길이 된다.
  원장(ledger.ts)이 기본값을 둔 것과 같은 이유다 — 안 주면 안 세는 길을 남기면
  이관이 절반에서 멈춘다.
*/
let gateOverride: BudgetGate | null = null

/** 테스트가 가짜 창구를 끼운다. 운영 경로에서는 부르지 않는다 */
export function setBudgetGateForTest(g: BudgetGate | null): void {
  gateOverride = g
  serverGate = null
}

let serverGate: Promise<BudgetGate> | null = null

/**
 * 예산을 물을 창구를 내어 준다. **벤더로 나가는 다른 길도 여기서 받아 간다** —
 * RFP 관문이 자기 창구를 따로 만들면 끼워 넣은 가짜가 한쪽에만 들어가고, 그 틈이
 * 곧 예산 밖으로 나가는 길이 된다.
 *
 * 세는 모듈을 못 불러오면 «항상 통과»를 준다. 세는 쪽은 서비스롤을 쓰느라
 * `server-only` 를 달고 있어서 서버 밖(단위 시험 같은 곳)에서는 아예 안 열린다.
 * 그때 막아 버리면 관측 장치가 새 단일 장애점이 된다 — 이 저장소가 이미 겪은 사고다.
 */
export async function resolveBudgetGate(): Promise<BudgetGate> {
  if (gateOverride) return gateOverride
  return await (serverGate ??= import('./budget-gate.ts')
    .then((m) => m.serverBudgetGate())
    .catch((e) => {
      console.error('[ai] 예산 창구를 못 열었다', e instanceof Error ? e.message : e)
      return { check: async () => decideBudget(null, EMPTY_USAGE) }
    }))
}

const EMPTY_USAGE = { usedToday: 0, usedLastMinute: 0, oldestInWindowIso: null }

/**
 * 보내도 되는지 묻고, 안 되면 **원장에 적고** 던진다.
 *
 * 거절도 사건이다. 안 적으면 「오늘 왜 아무 일도 안 일어났나」에 답할 수 없고,
 * 화면은 조용히 0건이 된다. 다만 전송 기록은 **안 적는다** — 나간 것이 없기 때문이다.
 * 나가지 않은 것을 나갔다고 적는 원장은 아무 기록도 없는 것보다 나쁘다.
 */
async function askBudget(ctx: GuardedCallContext, ledger: AiLedger): Promise<void> {
  const gate = await resolveBudgetGate()
  const decision = await gate.check(ctx.surface)
  if (decision.allowed) return

  const err = new BudgetDeniedError(decision)
  await ledger.recordCall({
    surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
    provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
    input_tokens: null, output_tokens: null, cost_krw: null, latency_ms: 0,
    ok: false, error: err.message.slice(0, 1000),
    contract_version: AI_CONTRACT_VERSION,
  })
  throw err
}

export type MediaKind = 'text' | 'image' | 'audio'

export interface GuardedCallContext {
  /** 어느 화면이 불렀나. 사고 대응이 여기서 시작한다 */
  surface: string
  /** 무엇을 하려고 불렀나 */
  purpose: string
  actorId?: string | null
  providerId?: string | null
  modelName?: string | null
  /** 글자가 아니면 글자 가림이 안 닿는다 */
  media?: MediaKind
  /**
   * 이 호출에 나올 수 있는 **아는 이름**.
   *
   * 이름은 개인정보인데 규칙으로는 안 잡힌다. 추측하지 않고 우리가 가진 이름을 준다 —
   * 주소록 인물, 회의 참석자, 프로필. 목록 밖 글자는 안 건드린다.
   *
   * 안 주면 전과 똑같이 동작한다. 목록을 못 읽었다고 호출을 막지 않는다 —
   * 가림은 더 좋아지는 것이지 문을 닫는 것이 아니다.
   */
  knownNames?: readonly string[]
  /**
   * **안 가리고 보내는 길**. 사유를 반드시 적는다.
   *
   * 왜 필요한가: 사용자가 AI 와 **직접 말하는** 화면이 있다. 거기서 사용자가 쓴 이름을
   * 가리면 «이 이름 영문으로 써 줘» 같은 부탁이 못 통한다 — 사용자가 일부러 보낸 것을
   * 우리가 가로채는 셈이다.
   *
   * 그럴 때 가린 척하지 않는다. 원장의 가린 셈은 **빈 것**으로 남는다 —
   * 그림과 소리에서 쓰는 것과 같은 표현이고, 「안 가렸다」를 한 가지 방법으로 말한다.
   */
  passthrough?: { reason: string }
}

export interface CallLogRow {
  surface: string
  purpose: string
  actor_id: string | null
  provider_id: string | null
  model_name: string | null
  input_tokens: number | null
  output_tokens: number | null
  cost_krw: number | null
  latency_ms: number
  ok: boolean
  error: string | null
  contract_version: number
}

export interface TransferLogRow {
  surface: string
  purpose: string
  actor_id: string | null
  provider_id: string | null
  model_name: string | null
  masked_counts: Record<string, number>
  media_kind: MediaKind
  bytes: number
  contract_version: number
}

/**
 * 원장 창구. 기본값을 안 둔다 —
 * 아무것도 안 하는 창구를 만들 수 있으면 원장은 조용히 0건이 된다
 */
export interface AiLedger {
  recordCall(row: CallLogRow): Promise<void>
  recordTransfer(row: TransferLogRow): Promise<void>
}

export interface GuardedTextResult {
  text: string
  inputTokens?: number | null
  outputTokens?: number | null
  costKrw?: number | null
}

export class PiiNotMaskedError extends Error {
  constructor(surface: string) {
    super(`가린 뒤에도 개인정보가 남아 있어 보내지 않았다: ${surface}`)
    this.name = 'PiiNotMaskedError'
  }
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 글자를 보내는 길.
 *
 * 보내기 전에 가리고, 남아 있으면 안 보내고, 받은 답에서 자리표를 되돌린다.
 * 왕복이 원문을 잃지 않는 것이 이 함수의 계약이다.
 */
export async function guardedText(
  prompt: string,
  ctx: GuardedCallContext,
  ledger: AiLedger,
  call: (maskedPrompt: string) => Promise<GuardedTextResult>,
  now: () => number = () => Date.now(),
): Promise<GuardedTextResult> {
  const names = { knownNames: ctx.knownNames }
  const masked = maskPii(prompt, names)
  if (hasUnmaskedPii(masked.text, names)) throw new PiiNotMaskedError(ctx.surface)

  // 보내도 되는지 먼저 묻는다. 거절은 아래 catch 가 아니라 askBudget 이 직접 적는다
  await askBudget(ctx, ledger)

  const started = now()
  try {
    const raw = await call(masked.text)
    const latencyMs = now() - started

    await ledger.recordCall({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      input_tokens: raw.inputTokens ?? null, output_tokens: raw.outputTokens ?? null,
      cost_krw: raw.costKrw ?? null, latency_ms: latencyMs, ok: true, error: null,
      contract_version: AI_CONTRACT_VERSION,
    })
    await ledger.recordTransfer({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      masked_counts: countByKind(masked.hits), media_kind: 'text',
      bytes: byteLength(masked.text), contract_version: AI_CONTRACT_VERSION,
    })

    return { ...raw, text: unmaskPii(raw.text, masked.hits) }
  } catch (e) {
    await ledger.recordCall({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      input_tokens: null, output_tokens: null, cost_krw: null,
      latency_ms: now() - started, ok: false, error: describe(e).slice(0, 1000),
      contract_version: AI_CONTRACT_VERSION,
    })
    throw e
  }
}

/**
 * 그림이나 소리를 보내는 길.
 *
 * 가린 척하지 않는다. 글자 가림이 안 닿는다는 사실을 원장에 밝혀 두고, 돌아온 글자에
 * 개인정보가 실려 있으면 **그때** 가린다. 전사가 정확히 그 모양이다.
 */
export async function guardedMedia(
  bytes: number,
  ctx: GuardedCallContext & { media: 'image' | 'audio' },
  ledger: AiLedger,
  call: () => Promise<GuardedTextResult>,
  now: () => number = () => Date.now(),
): Promise<GuardedTextResult & { maskedOnReturn: Record<string, number> }> {
  // 전송을 적기 **전에** 묻는다. 거절되면 나간 것이 없으므로 전송 기록도 없어야 한다
  await askBudget(ctx, ledger)

  const started = now()
  await ledger.recordTransfer({
    surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
    provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
    // 안 가렸다. 가린 척하는 원장은 아무 기록도 없는 것보다 나쁘다
    masked_counts: {}, media_kind: ctx.media, bytes,
    contract_version: AI_CONTRACT_VERSION,
  })

  try {
    const raw = await call()
    // 소리와 그림은 나가는 쪽 가림이 안 닿는다. 답에 실려 온 것을 여기서 셈한다
    const back = maskPii(raw.text, { knownNames: ctx.knownNames })
    await ledger.recordCall({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      input_tokens: raw.inputTokens ?? null, output_tokens: raw.outputTokens ?? null,
      cost_krw: raw.costKrw ?? null, latency_ms: now() - started, ok: true, error: null,
      contract_version: AI_CONTRACT_VERSION,
    })
    // 답에 실려 온 개인정보를 셈해 돌려준다. 지우지는 않는다 —
    // 전사에서 말한 사람 이름을 지우면 회의록이 못 읽을 것이 된다
    return { ...raw, maskedOnReturn: countByKind(back.hits) }
  } catch (e) {
    await ledger.recordCall({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      input_tokens: null, output_tokens: null, cost_krw: null,
      latency_ms: now() - started, ok: false, error: describe(e).slice(0, 1000),
      contract_version: AI_CONTRACT_VERSION,
    })
    throw e
  }
}

export interface GuardedVectorResult<T> {
  value: T
  tokens?: number | null
}

/**
 * 글자를 보내되 **글자가 안 돌아오는** 길 — 임베딩이 그 모양이다.
 *
 * 보내는 쪽은 글자라서 가림이 그대로 닿는다. 돌아오는 것은 숫자라서 되돌릴 것이 없다.
 * `guardedText` 를 빈 글자로 흉내 내면 원장에 «답 0자» 가 남아 무슨 일이 있었는지
 * 안 보인다. 그래서 길을 따로 둔다.
 *
 * 가린 글자를 임베딩해도 뜻은 거의 그대로다 — 전화번호와 메일 주소는 문장의 의미를
 * 거의 지지 않는다. 반대로 안 가리고 보내면 **벡터로 바뀌어 남의 서버에 남는다.**
 */
export async function guardedVector<T>(
  text: string,
  ctx: GuardedCallContext,
  ledger: AiLedger,
  call: (maskedText: string) => Promise<GuardedVectorResult<T> | null>,
  now: () => number = () => Date.now(),
): Promise<GuardedVectorResult<T> | null> {
  const names = { knownNames: ctx.knownNames }
  const masked = maskPii(text, names)
  if (hasUnmaskedPii(masked.text, names)) throw new PiiNotMaskedError(ctx.surface)

  // 임베딩도 같은 키의 같은 한도를 쓴다. 실측 2026-09-20: 분당 110회로 한도 100 을 넘겼다
  await askBudget(ctx, ledger)

  const started = now()
  try {
    const out = await call(masked.text)
    await ledger.recordCall({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      input_tokens: out?.tokens ?? null, output_tokens: 0, cost_krw: null,
      latency_ms: now() - started, ok: out !== null,
      error: out === null ? 'empty' : null,
      contract_version: AI_CONTRACT_VERSION,
    })
    await ledger.recordTransfer({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      masked_counts: countByKind(masked.hits), media_kind: 'text',
      bytes: byteLength(masked.text), contract_version: AI_CONTRACT_VERSION,
    })
    return out
  } catch (e) {
    await ledger.recordCall({
      surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
      provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
      input_tokens: null, output_tokens: null, cost_krw: null,
      latency_ms: now() - started, ok: false, error: describe(e).slice(0, 1000),
      contract_version: AI_CONTRACT_VERSION,
    })
    throw e
  }
}


/**
 * 조각 경계에서 잘려도 안전한 되돌리기.
 *
 * 흐르는 글자를 그때그때 화면에 붙이는 길이 있다. 자리표 `⟦PII_3⟧` 가 아직 반만 왔을 때
 * 되돌리면 `⟦PII_` 가 그대로 사람 눈에 보이고, 다음 조각에서 고쳐 써도 **이미 본 글자는
 * 안 사라진다.** 그래서 반쪽 자리표가 시작되는 자리에서 끊고, 그 앞까지만 돌려준다.
 */
export function unmaskStreaming(text: string, hits: readonly PiiHit[]): string {
  const open = text.lastIndexOf('⟦')
  const safe = open !== -1 && text.indexOf('⟧', open) === -1 ? text.slice(0, open) : text
  return unmaskPii(safe, hits)
}

/**
 * 여러 토막을 **한 번에** 가린다 — 주고받은 대화처럼 토막이 나뉘어 있을 때.
 *
 * 토막마다 따로 가리면 같은 이름이 토막마다 다른 번호를 받아, 모델이 「⟦PII_1⟧ 과
 * ⟦PII_1⟧ 은 다른 사람인가」를 묻게 된다. 그래서 이어 붙여 한 번 가리고 도로 나눈다.
 * 이음쇠는 널 문자다 — 가림 규칙이 만들지도 먹지도 않는 글자여서 경계가 안 흔들린다.
 */
const PART_SEP = '\u0000'

export interface GuardedCallHandle {
  /** 가린 글자. 이것을 벤더에 보낸다 (토막을 줬으면 첫 토막) */
  prompt: string
  /** 토막을 줬을 때 가려진 토막들. 번호는 토막 사이에서 이어진다 */
  parts: string[]
  /** 흘러온 글자에서 자리표를 되돌린다. 조각이 아니라 **모인 글자**에 쓴다 */
  unmask(text: string): string
  /** 흐르는 중에 화면에 붙일 때. 반쪽 자리표 앞에서 끊는다 */
  unmaskStreaming(text: string): string
  /** 흐름이 끝났을 때 한 번 부른다. 안 부르면 호출 기록이 안 남는다 */
  done(o: {
    ok: boolean
    inputTokens?: number | null
    outputTokens?: number | null
    costKrw?: number | null
    error?: string | null
  }): Promise<void>
}

/**
 * **두 토막으로 나뉜** 길.
 *
 * 흐름은 끝을 기다릴 수 없고, 그림이 섞인 호출은 가림이 글자에만 닿는다.
 * 둘 다 «부르고 받고 적는다» 를 한 덩어리로 못 싼다. 그래서 나가기 전에 가리고
 * 전송을 적어 두고, 끝났을 때 호출을 적는다.
 *
 * 자리표 되돌리기를 **조각마다** 하지 않는 이유: `⟦PII_3⟧` 이 조각 경계에 걸리면
 * 반쪽만 바뀌어 글자가 깨진다. 모인 글자에 한 번 쓰는 것이 안전하다.
 */
export async function beginGuardedCall(
  prompt: string | readonly string[],
  ctx: GuardedCallContext,
  ledger: AiLedger,
  /** 글자가 아닌 것이 같이 나갈 때 그 크기 — 그림이 몇 바이트 나갔는지가 원장에 남는다 */
  extraBytes: number = 0,
  now: () => number = () => Date.now(),
): Promise<GuardedCallHandle> {
  const names = { knownNames: ctx.knownNames }
  const parts = typeof prompt === 'string' ? [prompt] : prompt
  const joined = parts.join(PART_SEP)
  // 안 가리는 길은 자리표가 없으니 되돌릴 것도 없다. 「안 가렸다」는 빈 셈으로 남는다
  const masked = ctx.passthrough
    ? { text: joined, hits: [] as PiiHit[] }
    : maskPii(joined, names)
  if (!ctx.passthrough && hasUnmaskedPii(masked.text, names)) {
    throw new PiiNotMaskedError(ctx.surface)
  }

  // 전송을 적기 **전에** 묻는다. 여기서 던지면 handle 이 안 나가고 done() 도 안 불리므로
  // 거절 기록은 askBudget 이 직접 적는다
  await askBudget(ctx, ledger)

  await ledger.recordTransfer({
    surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
    provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
    masked_counts: countByKind(masked.hits), media_kind: ctx.media ?? 'text',
    bytes: (extraBytes ?? 0) + byteLength(masked.text),
    contract_version: AI_CONTRACT_VERSION,
  })

  const started = now()
  let closed = false
  return {
    prompt: masked.text.split(PART_SEP)[0],
    parts: masked.text.split(PART_SEP),
    unmask: (text: string) => unmaskPii(text, masked.hits),
    unmaskStreaming: (text: string) => unmaskStreaming(text, masked.hits),
    async done(o) {
      // 두 번 적으면 원장이 실제보다 많아 보인다
      if (closed) return
      closed = true
      await ledger.recordCall({
        surface: ctx.surface, purpose: ctx.purpose, actor_id: ctx.actorId ?? null,
        provider_id: ctx.providerId ?? null, model_name: ctx.modelName ?? null,
        input_tokens: o.inputTokens ?? null, output_tokens: o.outputTokens ?? null,
        cost_krw: o.costKrw ?? null, latency_ms: now() - started,
        ok: o.ok, error: o.error ? String(o.error).slice(0, 1000) : null,
        contract_version: AI_CONTRACT_VERSION,
      })
    },
  }
}
