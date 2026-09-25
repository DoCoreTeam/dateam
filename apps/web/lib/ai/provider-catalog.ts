// AI 공급자 명세 (SSOT)
//
// 공급자를 하나 늘리려면 예전엔 아홉 자리를 고쳐야 했다. 타입, 라벨표, META 키맵,
// 기본 모델표, 순서 배열, getProvider 분기, 카탈로그, 모델 화면, 관리자 카드.
// 그래서 Groq 은 「음성 인식」 카드 한 곳에만 꽂힌 채 AI 공급자가 되지 못했고,
// Grok 은 아예 들어오지 못했다.
//
// 이 파일이 유일한 등록처다. 아래 배열에 한 줄을 더하면 라벨과 키와 기본 모델과 순서가
// 전부 따라온다. 파생 함수를 순수 함수로 둔 이유도 그것이다. 테스트가 여섯째 공급자를
// 넣어 보고 실제로 따라오는지 확인할 수 있어야 확장성이 주장이 아니라 사실이 된다.
//
// v0.10.0 에서 주인별로 갈랐다. 벤더 주소와 키 접두사와 벤더 능력과 키 발급 주소는
// 벤더 사실이라 `@ax/ai-providers` 에 있고, 화면에 적는 이름과 META 키 자리와
// 기본 모델 선택과 용도 문구는 우리 사실이라 여기 남는다.
// 키 접두사 판별도 패키지에 있다. sk 가 sk-ant 를 통째로 포함하는 문제는 벤더 사실이지
// 우리 사실이 아니다.

import {
  GEMINI, CLAUDE, OPENAI, GROQ, GROK, JEV,
  matchesKeyPrefix as matchesVendorKeyPrefix,
  detectProviderByKey as detectVendorByKey,
  type VendorCapabilities,
} from '@ax/ai-providers'

export type { VendorCapabilities as AiProviderCapabilities }

/** 등록된 공급자. 새 공급자는 AI_PROVIDERS 에 더하고 이 합집합에 이름을 더한다 */
export type AiProviderId = 'gemini' | 'claude' | 'openai' | 'groq' | 'grok' | 'jev'

export interface AiProviderSpec {
  id: AiProviderId
  /** 화면에 적는 이름 */
  label: string
  /** org_content META 안에서 키와 모델이 앉는 자리 */
  meta: { apiKey: string; model: string }
  /**
   * OpenAI 호환 엔드포인트 주소. 공식 SDK 를 쓰는 공급자는 null 이다.
   * null 이 아니면 openai-compatible 어댑터가 그대로 붙는다.
   * (벤더 사실이라 값은 `@ax/ai-providers` 에서 온다)
   */
  baseUrl: string | null
  /** 저장 전에 확인하는 키 접두사. 남의 공급자 키를 잘못 붙여 넣는 사고를 그 자리에서 잡는다 */
  keyPrefixes: readonly string[]
  /** 모델 미설정 시 쓸 값. null 이면 관리자가 고르기 전까지 후보에서 빠진다 */
  defaultModel: string | null
  capabilities: VendorCapabilities
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
    ...GEMINI,
    label: 'Gemini',
    meta: { apiKey: 'gemini_api_key', model: 'gemini_model' },
    defaultModel: null, // lib/ai/gemini-model.ts 의 SSOT 를 registry 가 채운다
    purpose: '긴 문서를 통째로 읽는 데 강합니다. 회의록 정리와 자료 분석의 기본 공급자입니다.',
  },
  {
    ...CLAUDE,
    label: 'Claude',
    meta: { apiKey: 'claude_api_key', model: 'claude_model' },
    defaultModel: 'claude-opus-4-8',
    purpose: '길게 생각해야 하는 일에 강합니다. 제안서 초안과 까다로운 분석에 씁니다.',
  },
  {
    ...OPENAI,
    label: 'OpenAI',
    meta: { apiKey: 'openai_api_key', model: 'openai_model' },
    // 하드코딩 기본을 두지 않는다. 상위 모델은 자주 갈리므로 관리자가 직접 고르게 한다
    defaultModel: null,
    purpose: '범용으로 고르게 잘합니다. 다른 공급자가 막혔을 때 받아 주는 자리이기도 합니다.',
  },
  {
    ...GROQ,
    label: 'Groq',
    // ⚠️ 이름을 groq_api_key 로 바꾸지 말 것. 조직에 이미 저장된 키가 stt_api_key 다.
    //    (「음성 인식」 카드에서 넣은 그 키이고, lib/ci/ai/meta.ts 는 이미 LLM 폴백으로 읽고 있다)
    meta: { apiKey: 'stt_api_key', model: 'groq_model' },
    // ⚠️ Groq 는 모델을 자주 갈아 치운다. 폐기된 이름을 두면 **호출이 404 로만 죽는다**.
    //    실측 2026-09-09: RFP 분석 9번이 전부 `llama-3.3-70b-versatile does not exist` 였고,
    //    화면에는 「쓸 수 있는 모델이 없다」로만 보여 원인을 못 찾았다.
    //    지금 값은 실제 호출로 확인했다(한국어 JSON 정답, 131k 창).
    defaultModel: 'qwen/qwen3.8-27b',
    purpose: '같은 질문을 몇 배 빠르게 답합니다. 대량 처리와 다른 공급자가 막혔을 때의 폴백에 씁니다.',
    alsoUsedFor: '회의 녹음을 글로 옮기는 데도 이 키를 씁니다',
  },
  {
    ...GROK,
    label: 'Grok',
    meta: { apiKey: 'xai_api_key', model: 'xai_model' },
    defaultModel: 'grok-4',
    purpose: '최신 사건을 묻는 데 강합니다. 시장 동향과 경쟁사 조사에 씁니다.',
  },
  {
    ...JEV,
    label: 'Jev (Vercel AI Gateway)',
    meta: { apiKey: 'jev_api_key', model: 'jev_model' },
    /**
     * 기본 모델을 안 정한다. 관문 뒤에는 여러 벤더의 모델이 있고 이름이 수시로 바뀐다 —
     * 여기에 하나를 박아 두면 그 이름이 사라진 날 조용히 404 가 나고,
     * 화면에는 「AI 가 답을 안 한다」로 보인다. 관리자가 고른 것만 쓴다.
     */
    defaultModel: null,
    purpose: 'AI 트레이딩의 판단 모델(Jev)을 부르는 관문입니다. 여러 벤더 모델을 키 하나로 씁니다.',
    alsoUsedFor: 'AI 트레이딩 판단 기록에 이 키를 씁니다',
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
 * 규칙 자체는 `@ax/ai-providers` 에 있다. OpenAI 의 `sk-` 가 Claude 의 `sk-ant-` 를
 * 통째로 포함하는 것은 벤더 사실이지 우리 사실이 아니다. 여기서는 우리 명세만 묶어 넘긴다.
 */
export function matchesKeyPrefix(id: AiProviderId, key: string): boolean {
  return matchesVendorKeyPrefix(AI_PROVIDERS, id, key)
}

/** 이 키는 어느 공급자 것인가. 붙여 넣은 키를 보고 칸을 짚어 줄 때 쓴다 */
export function detectProviderByKey(key: string): AiProviderId | null {
  return detectVendorByKey(AI_PROVIDERS, key)
}
