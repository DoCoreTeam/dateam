// AI 공급자 명세 (SSOT)
//
// 공급자를 하나 늘리려면 예전엔 아홉 자리를 고쳐야 했다 — 타입, 라벨표, META 키맵,
// 기본 모델표, 순서 배열, getProvider 분기, 카탈로그, 모델 화면, 관리자 카드.
// 그래서 Groq 은 「음성 인식」 카드 한 곳에만 꽂힌 채 AI 공급자가 되지 못했고,
// Grok 은 아예 들어오지 못했다.
//
// 이 파일이 유일한 등록처다. 아래 배열에 한 줄을 더하면 라벨과 키와 기본 모델과 순서가
// 전부 따라온다. 파생 함수를 순수 함수로 둔 이유도 그것이다 — 테스트가 여섯째 공급자를
// 넣어 보고 실제로 따라오는지 확인할 수 있어야 확장성이 주장이 아니라 사실이 된다.

/** 등록된 공급자. 새 공급자는 AI_PROVIDERS 에 더하고 이 합집합에 이름을 더한다 */
export type AiProviderId = 'gemini' | 'claude' | 'openai' | 'groq' | 'grok'

/** 공급자가 무엇을 할 수 있는가. 어댑터가 각자 적지 않고 여기서 읽어 간다 */
export interface AiProviderCapabilities {
  vision: boolean
  tools: boolean
  thinking: boolean
  defaultMaxOutputTokens: number
}

export interface AiProviderSpec {
  id: AiProviderId
  /** 화면에 적는 이름 */
  label: string
  /** org_content META 안에서 키와 모델이 앉는 자리 */
  meta: { apiKey: string; model: string }
  /**
   * OpenAI 호환 엔드포인트 주소. 공식 SDK 를 쓰는 공급자는 null 이다.
   * null 이 아니면 openai-compatible 어댑터가 그대로 붙는다.
   */
  baseUrl: string | null
  /** 저장 전에 확인하는 키 접두사. 남의 공급자 키를 잘못 붙여 넣는 사고를 그 자리에서 잡는다 */
  keyPrefixes: string[]
  /** 모델 미설정 시 쓸 값. null 이면 관리자가 고르기 전까지 후보에서 빠진다 */
  defaultModel: string | null
  capabilities: AiProviderCapabilities
  /** 카드에 적는 용도 한 줄. 무엇에 쓰는 공급자인지 모르면 키를 넣을 이유도 모른다 */
  purpose: string
  /** 키 발급 주소. 「어디서 받나」를 화면 밖에서 찾게 하지 않는다 */
  keyIssueUrl: string
  /** 이 키가 채팅 말고 또 어디에 쓰이는가. 해제할 때 무엇이 함께 멈추는지 말해야 한다 */
  alsoUsedFor?: string
}

/**
 * 등록된 공급자. **순서가 곧 폴백 기본 순서다** — 앞에 있는 것부터 시도한다.
 * (조직이 순서를 바꿔 저장하면 그 값이 이깁니다. 여기 순서는 저장값이 없을 때의 기본)
 */
export const AI_PROVIDERS: readonly AiProviderSpec[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    meta: { apiKey: 'gemini_api_key', model: 'gemini_model' },
    baseUrl: null, // @google/genai SDK
    keyPrefixes: ['AIza'],
    defaultModel: null, // lib/ai/gemini-model.ts 의 SSOT 를 registry 가 채운다
    capabilities: { vision: true, tools: true, thinking: false, defaultMaxOutputTokens: 8192 },
    purpose: '긴 문서를 통째로 읽는 데 강합니다. 회의록 정리와 자료 분석의 기본 공급자입니다.',
    keyIssueUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'claude',
    label: 'Claude',
    meta: { apiKey: 'claude_api_key', model: 'claude_model' },
    baseUrl: null, // @anthropic-ai/sdk
    keyPrefixes: ['sk-ant-'],
    defaultModel: 'claude-opus-4-8',
    capabilities: { vision: true, tools: true, thinking: true, defaultMaxOutputTokens: 16384 },
    purpose: '길게 생각해야 하는 일에 강합니다. 제안서 초안과 까다로운 분석에 씁니다.',
    keyIssueUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    meta: { apiKey: 'openai_api_key', model: 'openai_model' },
    baseUrl: null, // openai SDK 기본 주소
    keyPrefixes: ['sk-'],
    // 하드코딩 기본을 두지 않는다. 상위 모델은 자주 갈리므로 관리자가 직접 고르게 한다
    defaultModel: null,
    capabilities: { vision: true, tools: false, thinking: false, defaultMaxOutputTokens: 16384 },
    purpose: '범용으로 고르게 잘합니다. 다른 공급자가 막혔을 때 받아 주는 자리이기도 합니다.',
    keyIssueUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'groq',
    label: 'Groq',
    // ⚠️ 이름을 groq_api_key 로 바꾸지 말 것. 조직에 이미 저장된 키가 stt_api_key 다.
    //    (「음성 인식」 카드에서 넣은 그 키이고, lib/ci/ai/meta.ts 는 이미 LLM 폴백으로 읽고 있다)
    meta: { apiKey: 'stt_api_key', model: 'groq_model' },
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPrefixes: ['gsk_'],
    defaultModel: 'llama-3.3-70b-versatile',
    // 오픈소스 모델을 남의 GPU 에서 돌린다. 이미지는 못 읽고 도구도 안 쓴다
    capabilities: { vision: false, tools: false, thinking: false, defaultMaxOutputTokens: 8192 },
    purpose: '같은 질문을 몇 배 빠르게 답합니다. 대량 처리와 다른 공급자가 막혔을 때의 폴백에 씁니다.',
    keyIssueUrl: 'https://console.groq.com/keys',
    alsoUsedFor: '회의 녹음을 글로 옮기는 데도 이 키를 씁니다',
  },
  {
    id: 'grok',
    label: 'Grok',
    meta: { apiKey: 'xai_api_key', model: 'xai_model' },
    baseUrl: 'https://api.x.ai/v1',
    keyPrefixes: ['xai-'],
    defaultModel: 'grok-4',
    capabilities: { vision: true, tools: false, thinking: true, defaultMaxOutputTokens: 16384 },
    purpose: '최신 사건을 묻는 데 강합니다. 시장 동향과 경쟁사 조사에 씁니다.',
    keyIssueUrl: 'https://console.x.ai',
  },
] as const

/* ── 파생 ──────────────────────────────────────────────────────
   전부 명세 배열을 인자로 받는 순수 함수다. 모듈 상수는 그 함수를 실제 명세로 한 번 부른 것뿐이라,
   테스트가 가상의 여섯째를 넣어 「정말 따라오는가」를 확인할 수 있다. */

export function deriveOrder(specs: readonly AiProviderSpec[]): AiProviderId[] {
  return specs.map((s) => s.id)
}

export function deriveLabels(specs: readonly AiProviderSpec[]): Record<AiProviderId, string> {
  return Object.fromEntries(specs.map((s) => [s.id, s.label])) as Record<AiProviderId, string>
}

export function deriveMetaKeys(
  specs: readonly AiProviderSpec[],
): Record<AiProviderId, { apiKey: string; model: string }> {
  return Object.fromEntries(specs.map((s) => [s.id, s.meta])) as Record<
    AiProviderId,
    { apiKey: string; model: string }
  >
}

export function deriveDefaultModels(
  specs: readonly AiProviderSpec[],
): Record<AiProviderId, string | null> {
  return Object.fromEntries(specs.map((s) => [s.id, s.defaultModel])) as Record<
    AiProviderId,
    string | null
  >
}

/** 등록 순서 그대로. 화면과 폴백이 같은 순서를 본다 */
export const AI_PROVIDER_IDS: AiProviderId[] = deriveOrder(AI_PROVIDERS)

const BY_ID = new Map<string, AiProviderSpec>(AI_PROVIDERS.map((s) => [s.id, s]))

/** 명세 조회. 없는 id 는 조용히 undefined 로 넘기지 않는다 — 배선이 빠진 것을 그 자리에서 알린다 */
export function getProviderSpec(id: AiProviderId): AiProviderSpec {
  const spec = BY_ID.get(id)
  if (!spec) throw new Error(`등록되지 않은 AI 공급자: ${id}`)
  return spec
}

/** 등록된 공급자인가. 저장된 설정값처럼 밖에서 들어온 문자열을 좁힐 때 쓴다 */
export function isAiProviderId(v: unknown): v is AiProviderId {
  return typeof v === 'string' && BY_ID.has(v)
}

/**
 * 키가 이 공급자 것인가. 접두사가 맞지 않으면 저장하지 않는다.
 * (Claude 칸에 OpenAI 키를 넣으면 저장은 되고 첫 호출에서야 실패하던 것을 여기서 잡는다)
 *
 * 단순 startsWith 로는 부족하다 — OpenAI 의 `sk-` 는 Claude 의 `sk-ant-` 를 통째로 포함한다.
 * 그래서 «내 접두사가 맞는가»가 아니라 «맞는 것들 중 내 것이 가장 긴가»를 본다.
 */
export function matchesKeyPrefix(id: AiProviderId, key: string): boolean {
  const trimmed = key.trim()
  const mine = longestMatchingPrefix(getProviderSpec(id), trimmed)
  if (mine === null) return false
  for (const other of AI_PROVIDERS) {
    if (other.id === id) continue
    const theirs = longestMatchingPrefix(other, trimmed)
    if (theirs !== null && theirs.length > mine.length) return false
  }
  return true
}

function longestMatchingPrefix(spec: AiProviderSpec, key: string): string | null {
  let best: string | null = null
  for (const p of spec.keyPrefixes) {
    if (key.startsWith(p) && (best === null || p.length > best.length)) best = p
  }
  return best
}

/** 이 키는 어느 공급자 것인가. 붙여 넣은 키를 보고 칸을 짚어 줄 때 쓴다 */
export function detectProviderByKey(key: string): AiProviderId | null {
  for (const spec of AI_PROVIDERS) {
    if (matchesKeyPrefix(spec.id, key)) return spec.id
  }
  return null
}
