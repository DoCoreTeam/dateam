import type { ChatProvider, ProviderId } from './provider.ts'
import { geminiProvider } from './providers/gemini.ts'
import { claudeProvider } from './providers/claude.ts'
import { openaiProvider } from './providers/openai.ts'

// META 기반 프로바이더 가용성/설정 (순수 함수 — 단위테스트 대상, 04 §7)
// META 조회 자체는 호출측(route/action)에서 createAdminClient()로 읽어 전달.

export const META_KEYS = {
  gemini: { apiKey: 'gemini_api_key', model: 'gemini_model' },
  claude: { apiKey: 'claude_api_key', model: 'claude_model' },
  openai: { apiKey: 'openai_api_key', model: 'openai_model' },
} as const

export const META_DEFAULT_PROVIDER_KEY = 'ai_chat_default_provider'

// 모델 미설정 시 폴백. openai는 하드코딩 기본 없음 — 어드민이 상위 모델 직접 선택 필수(미설정 시 제외).
export const DEFAULT_MODELS: Record<ProviderId, string | null> = {
  gemini: 'gemini-2.0-flash', // 기존 saveGeminiModel 미설정 시 폴백(기존 컨벤션)
  claude: 'claude-opus-4-8', // 고급 모델 기본 (확정 계약)
  openai: null, // 하드코딩 기본 없음
}

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'claude', 'openai']

export interface ProviderConfig {
  id: ProviderId
  apiKey: string
  model: string
}

function readString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** 특정 프로바이더 설정. 키/모델 미충족 시 null (openai는 모델 미설정 시 제외). */
export function getProviderConfig(
  meta: Record<string, unknown>,
  id: ProviderId,
): ProviderConfig | null {
  const keys = META_KEYS[id]
  const apiKey = readString(meta, keys.apiKey)
  if (!apiKey) return null

  const model = readString(meta, keys.model) || (DEFAULT_MODELS[id] ?? '')
  if (!model) return null // openai 모델 미설정 → 제외

  return { id, apiKey, model }
}

/** META에서 사용 가능한 프로바이더 목록 (고정 순서). */
export function getAvailableProviders(meta: Record<string, unknown>): ProviderConfig[] {
  const out: ProviderConfig[] = []
  for (const id of PROVIDER_ORDER) {
    const cfg = getProviderConfig(meta, id)
    if (cfg) out.push(cfg)
  }
  return out
}

/** 신규 대화 기본 프로바이더(META `ai_chat_default_provider`, 04 §7).
 *  설정값이 available이면 그 설정, 미설정/미가용이면 첫 available, available 0개면 null.
 *  createConversation 기본값(새 대화 버튼 프리셀렉트)의 단일 소스. */
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

/** 프로바이더 인스턴스 매핑 (providers/*). */
export function getProvider(id: ProviderId): ChatProvider {
  switch (id) {
    case 'gemini':
      return geminiProvider
    case 'claude':
      return claudeProvider
    case 'openai':
      return openaiProvider
  }
}
