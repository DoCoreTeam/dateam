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

import { maskPii, unmaskPii, hasUnmaskedPii, countByKind } from '@ax/ai-gateway'
import { AI_CONTRACT_VERSION } from '@ax/ai-core'

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
