import type { ChatProvider, ProviderId } from './provider.ts'
import { geminiProvider } from './providers/gemini.ts'
import { claudeProvider } from './providers/claude.ts'
import { openaiProvider } from './providers/openai.ts'
import { groqProvider } from './providers/groq.ts'
import { grokProvider } from './providers/grok.ts'
import { DEFAULT_GEMINI_MODEL } from '../ai/gemini-model.ts'
import {
  AI_PROVIDERS,
  deriveMetaKeys,
  deriveDefaultModels,
  deriveOrder,
} from '../ai/provider-catalog.ts'

// META 기반 프로바이더 가용성·설정 (순수 함수 — 단위테스트 대상, 04 §7)
// META 조회 자체는 호출측(route/action)에서 createAdminClient()로 읽어 전달.
//
// 목록의 원본은 lib/ai/provider-catalog.ts 다. 아래 셋은 전부 그 명세에서 파생된다 —
// 예전엔 여기에 손으로 적혀 있어서 공급자를 늘릴 때마다 세 곳을 따로 고쳐야 했다.

export const META_KEYS = deriveMetaKeys(AI_PROVIDERS)

export const META_DEFAULT_PROVIDER_KEY = 'ai_chat_default_provider'

/** 폴백 순서(META `ai_chat_provider_order`). 저장값이 없으면 명세 순서를 쓴다 */
export const META_PROVIDER_ORDER_KEY = 'ai_chat_provider_order'

// 모델 미설정 시 폴백. 명세에서 오되, gemini 만 기존 SSOT(lib/ai/gemini-model)를 따른다 —
// 그 파일이 JSON 모드 지원 여부까지 함께 관리하므로 기본값을 두 곳에 적으면 갈린다.
export const DEFAULT_MODELS: Record<ProviderId, string | null> = {
  ...deriveDefaultModels(AI_PROVIDERS),
  gemini: DEFAULT_GEMINI_MODEL,
}

const PROVIDER_ORDER: ProviderId[] = deriveOrder(AI_PROVIDERS)

/**
 * 명세에 등록됐지만 어댑터가 아직 배선되지 않은 공급자는 여기 없다.
 * 후보 판정이 이 표를 보므로, 반쯤 등록된 공급자는 사용자에게 닿지 않는다 —
 * 명세만 넓히고 어댑터를 미루면 저장된 키가 후보에 들어와 호출에서 터진다.
 */
const PROVIDER_IMPL: Partial<Record<ProviderId, ChatProvider>> = {
  gemini: geminiProvider,
  claude: claudeProvider,
  openai: openaiProvider,
  groq: groqProvider,
  grok: grokProvider,
}

export interface ProviderConfig {
  id: ProviderId
  apiKey: string
  model: string
}

function readString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** 어댑터가 배선된 공급자인가 */
export function isWired(id: ProviderId): boolean {
  return PROVIDER_IMPL[id] !== undefined
}

/** 특정 프로바이더 설정. 키·모델 미충족 또는 어댑터 미배선이면 null */
export function getProviderConfig(
  meta: Record<string, unknown>,
  id: ProviderId,
): ProviderConfig | null {
  if (!isWired(id)) return null

  const keys = META_KEYS[id]
  if (!keys) return null
  const apiKey = readString(meta, keys.apiKey)
  if (!apiKey) return null

  const model = readString(meta, keys.model) || (DEFAULT_MODELS[id] ?? '')
  if (!model) return null // 기본 모델이 없는 공급자(openai)는 관리자가 고르기 전까지 제외

  return { id, apiKey, model }
}

/**
 * 조직이 정한 폴백 순서. 저장값에 없는 공급자는 명세 순서대로 뒤에 붙는다 —
 * 새 공급자를 더했을 때 순서에서 조용히 빠지지 않게 한다.
 */
export function getProviderOrder(meta: Record<string, unknown>): ProviderId[] {
  const raw = meta[META_PROVIDER_ORDER_KEY]
  const saved = Array.isArray(raw)
    ? raw.filter((v): v is ProviderId => typeof v === 'string' && PROVIDER_ORDER.includes(v as ProviderId))
    : []
  const seen = new Set(saved)
  return [...saved, ...PROVIDER_ORDER.filter((id) => !seen.has(id))]
}

/** META에서 사용 가능한 프로바이더 목록 (조직 순서 → 없으면 명세 순서). */
export function getAvailableProviders(meta: Record<string, unknown>): ProviderConfig[] {
  const out: ProviderConfig[] = []
  for (const id of getProviderOrder(meta)) {
    const cfg = getProviderConfig(meta, id)
    if (cfg) out.push(cfg)
  }
  return out
}

/** 신규 대화 기본 프로바이더(META `ai_chat_default_provider`, 04 §7).
 *  설정값이 available이면 그 설정, 미설정/미가용이면 첫 available, available 0개면 null. */
export function getDefaultProvider(meta: Record<string, unknown>): ProviderConfig | null {
  const available = getAvailableProviders(meta)
  if (available.length === 0) return null

  const preferred = readString(meta, META_DEFAULT_PROVIDER_KEY)
  if (preferred) {
    const match = available.find((c) => c.id === preferred)
    if (match) return match
  }
  return available[0]
}

/** 프로바이더 인스턴스. 배선되지 않은 id 는 조용히 넘기지 않는다 */
export function getProvider(id: ProviderId): ChatProvider {
  const impl = PROVIDER_IMPL[id]
  if (!impl) throw new Error(`어댑터가 배선되지 않은 AI 공급자: ${id}`)
  return impl
}
