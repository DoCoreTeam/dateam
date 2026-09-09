/**
 * 호스트 AI 공급자를 그대로 쓴다 (사용자 개입 iv_0020)
 *
 * ## 왜 RFP 가 자기 키 설정을 안 갖나
 *
 * AI 공급자는 **이미 관리자 설정에 한 벌 있다**(`lib/ai-chat/registry`, `org_content.META`).
 * 거기 Gemini·Claude·OpenAI·Groq·Grok 키가 들어 있고 사내 전체가 그것을 쓴다.
 * RFP 가 자기 키 폼을 또 만들면 ⓐ 같은 키를 두 군데 넣게 되고
 * ⓑ 한쪽만 바꿔 놓고 「왜 RFP 만 안 되지」를 겪는다.
 *
 * ## 그럼 RFP 표(`rfp_ai_models`)는 무엇인가
 *
 * **「이 모델에 어느 문서 등급까지 보낼 수 있나」의 목록**이다. AI 채팅에는 그런 개념이 없다.
 * 그리고 그 목록에 없는 모델은 분석에 안 쓴다 — 호스트의 기본 모델은 **채팅용**이고,
 * 채팅이 잘 도는 모델이 분석에도 맞다는 보장이 없다.
 *
 * 실제로 그래서 죽었다: 호스트 채팅 기본값이 `llama-3.3-70b-versatile`(폐기된 이름)이었고,
 * 분석 9번이 전부 404 로 실패했다(실측 2026-09-09).
 *
 * ## 벤더 이름이 두 벌이라는 함정
 *
 * 호스트는 `gemini`·`claude`·`grok` 이라 부르고 RFP 표는 `google`·`anthropic`·`xai` 라 부른다.
 * 이름이 안 맞으면 **정책이 한 번도 안 붙고** 전부 안전 기본값(공개 전용, 비용 0원)이 된다 —
 * 화면에는 「다 공개」로만 보여서 틀린 줄 모른다. 그래서 짝을 여기 한 곳에 둔다.
 */

import type { DocClass } from '../domain/doc-class.ts'
import type { AiModel } from './models.ts'

/** `lib/ai-chat/registry` 의 ProviderConfig 에서 우리가 쓰는 부분만 */
export interface HostProvider {
  id: string
  apiKey: string
  model: string
}

/**
 * 호스트 공급자 id → RFP 표의 vendor_id.
 *
 * 한쪽만 고치면 정책이 조용히 안 붙는다. 짝은 여기서만 정한다.
 */
export const VENDOR_ALIAS: Record<string, string> = {
  gemini: 'google',
  claude: 'anthropic',
  grok: 'xai',
  openai: 'openai',
  groq: 'groq',
}

/** 호스트 id 로 RFP 벤더 이름을 얻는다 — 짝이 없으면 그대로 쓴다 */
export function rfpVendorOf(hostId: string): string {
  return VENDOR_ALIAS[hostId] ?? hostId
}

/** RFP 벤더 이름으로 호스트 id 를 되찾는다 */
export function hostIdOf(rfpVendorId: string): string {
  const hit = Object.entries(VENDOR_ALIAS).find(([, v]) => v === rfpVendorId)
  return hit ? hit[0] : rfpVendorId
}

/** `rfp_ai_models` 한 행 — 「이 모델에 어느 등급까지」 */
export interface ModelPolicyRow {
  /** 표의 uuid. 호출 기록이 이 값을 가리킨다 */
  id: string
  vendorId: string
  /** 벤더가 아는 이름. 호출할 때 이 값을 보낸다 */
  modelName: string
  displayName: string
  allowedDocClasses: DocClass[]
  inputKrwPerMTok: number
  outputKrwPerMTok: number
  multimodal: boolean
  enabled: boolean
  sortOrder: number
}

/** DB 행 → 정책. 칸 이름이 바뀌면 여기 한 곳만 고친다 */
export function toPolicy(row: Record<string, unknown>): ModelPolicyRow {
  return {
    id: String(row.id ?? ''),
    vendorId: String(row.vendor_id ?? ''),
    // ⚠️ 표의 `model_id` 는 uuid 가 아니라 **벤더가 아는 모델 이름**이다(gemini-flash-latest)
    modelName: String(row.model_id ?? ''),
    displayName: String(row.display_name ?? row.model_id ?? ''),
    allowedDocClasses: (row.allowed_doc_classes as DocClass[] | null) ?? ['public'],
    inputKrwPerMTok: Number(row.price_input_per_1m ?? 0),
    outputKrwPerMTok: Number(row.price_output_per_1m ?? 0),
    multimodal: Boolean(row.supports_image_input),
    enabled: row.enabled === undefined ? true : Boolean(row.enabled),
    sortOrder: Number(row.avg_latency_ms ?? 1000),
  }
}

/** 정책이 없는 공급자의 기본값 — 공개 문서만 */
export const SAFE_DEFAULT = {
  allowedDocClasses: ['public'] as DocClass[],
  inputKrwPerMTok: 0,
  outputKrwPerMTok: 0,
  multimodal: false,
  sortOrder: 9000,
}

/**
 * 호스트 키 + RFP 모델 목록 → 게이트웨이가 아는 모델 사슬.
 *
 * **키가 없는 벤더의 모델은 아예 안 나온다** — 화면이 「쓸 수 있다」고 말해 놓고
 * 호출에서 터지는 것이 가장 나쁘다.
 *
 * RFP 표에 한 줄도 없는 벤더는 호스트의 기본 모델을 공개 전용으로만 쓴다 —
 * 아무것도 못 쓰는 것보다는 낫고, 등급을 모르는 모델에 비공개 문서를 보내지도 않는다.
 */
export function toModels(
  providers: readonly HostProvider[],
  policies: readonly ModelPolicyRow[],
): AiModel[] {
  const keyByVendor = new Map(
    providers.filter((p) => p.apiKey).map((p) => [rfpVendorOf(p.id), p]),
  )

  const fromPolicies: AiModel[] = policies
    .filter((p) => p.enabled && p.modelName && keyByVendor.has(p.vendorId))
    .map((p) => ({
      id: p.id,
      // 호출부는 이 값으로 키를 찾는다 — 호스트 쪽 이름이어야 한다
      vendorId: hostIdOf(p.vendorId),
      modelName: p.modelName,
      displayName: p.displayName,
      allowedDocClasses: p.allowedDocClasses,
      internal: false,
      retention: { noTraining: false, retentionDays: 30, zeroRetention: false },
      inputKrwPerMTok: p.inputKrwPerMTok,
      outputKrwPerMTok: p.outputKrwPerMTok,
      multimodal: p.multimodal,
      enabled: true,
      sortOrder: p.sortOrder,
    }))

  // 표에 한 줄도 없는 벤더 — 호스트 기본 모델을 공개 전용으로
  const covered = new Set(fromPolicies.map((m) => m.vendorId))
  const fallback: AiModel[] = providers
    .filter((p) => p.apiKey && p.model && !covered.has(p.id))
    .map((p) => ({
      id: p.id,
      vendorId: p.id,
      modelName: p.model,
      displayName: p.id,
      allowedDocClasses: SAFE_DEFAULT.allowedDocClasses,
      internal: false,
      retention: { noTraining: false, retentionDays: 30, zeroRetention: false },
      inputKrwPerMTok: SAFE_DEFAULT.inputKrwPerMTok,
      outputKrwPerMTok: SAFE_DEFAULT.outputKrwPerMTok,
      multimodal: SAFE_DEFAULT.multimodal,
      enabled: true,
      sortOrder: SAFE_DEFAULT.sortOrder,
    }))

  return [...fromPolicies, ...fallback].sort((a, b) => a.sortOrder - b.sortOrder)
}

/** 기록에 쓸 모델 uuid — 호스트 폴백 모델은 표에 없으므로 null 이다 */
export function modelUuid(model: AiModel): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(model.id)
    ? model.id : null
}

/** 관리자 설정으로 가는 길 — RFP 화면은 여기로 보낸다 */
export const HOST_AI_SETTINGS_HREF = '/admin/settings'
