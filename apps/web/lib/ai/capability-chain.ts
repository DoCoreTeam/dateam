// lib/ai/capability-chain.ts — 어느 능력을 어느 모델 순서로 부르나 (순수 표)
//
// ## 왜 생겼나
//
// 사슬이 하나뿐이었다. 요약도 이름표 붙이기도 같은 모델부터 두드렸고, 그 모델의 하루 한도가
// 차면 전부 같이 죽었다. 실측 2026-09-20: 하루 23,318건 중 22,131건이 한도로 실패했다 —
// **보내 봐야 못 가는 호출**이 대부분이었다는 뜻이다.
//
// 무료 한도는 **모델마다 따로** 찬다(GenerateRequestsPerDayPerProjectPerModel-FreeTier).
// 실측 2026-08-27: flash 계열 넷이 전부 429일 때 lite 만 200 이었다. 그러면 가벼운 일을
// 한도가 큰 쪽으로 먼저 보내는 것만으로 무거운 일의 몫이 남는다. 같은 호출 수라도
// 어느 버킷을 쓰느냐가 달라진다.
//
// ## 이름을 model-tier 라 안 짓는 이유
//
// `lib/ai-chat/model-tier.ts` 가 이미 있다. 그것은 **사람이 고르는 메뉴**를 세우는 순서고
// (고성능·범용·빠름), 여기는 **기계가 부르는 순서**다. 같은 이름을 옆 폴더에 두면
// 다음 사람이 둘 중 아무거나 import 한다.

import { AI_CAPABILITIES, type AiCapability } from '@ax/ai-core'
import { DEFAULT_GEMINI_MODEL, supportsJsonMode } from './gemini-model.ts'

/**
 * 하루 한도가 큰 것부터. 이 순서가 곧 사슬 순서다.
 *
 * 숫자를 적지 않는 이유: 벤더가 공표하는 값이 바뀌고, 바뀐 줄 모른 채 숫자를 믿으면
 * 순서가 조용히 틀린다. 우리가 실제로 관측한 것은 **누가 먼저 죽는가**뿐이므로
 * 그 순위만 적고 근거를 함께 둔다.
 */
export const MODEL_BY_DAILY_QUOTA: readonly { model: string; why: string }[] = [
  {
    model: 'gemini-flash-lite-latest',
    why: '실측 2026-08-27 flash 넷이 전부 429일 때 혼자 200, 버킷이 따로이고 가장 늦게 찬다',
  },
  {
    model: DEFAULT_GEMINI_MODEL,
    why: '기본 모델. JSON 모드가 확인된 모델 중 품질이 가장 낫다',
  },
  {
    model: 'gemini-3.7-flash',
    why: '같은 flash 계열의 다음 판, 기본 모델이 404·503 일 때 받는다',
  },
  {
    model: 'gemini-flash-latest',
    why: '별칭이라 항상 존재한다. 성능과 비용이 예고 없이 바뀌므로 맨 뒤 안전망',
  },
]

/**
 * 값싼 쪽부터 갈 능력인가.
 *
 * 「가벼운 일」의 기준은 글자 수가 아니라 **틀렸을 때 무엇을 잃는가**다.
 * 이름표가 어긋나면 사람이 고쳐 누르면 되고, 판정(judge)이 어긋나면 그 판단을 믿고
 * 다음 일이 진행된다. 되돌리기 쉬운 쪽을 싼 모델로 보낸다.
 */
export const CHEAP_FIRST: Record<AiCapability, boolean> = {
  extract: false,   // 문서에서 사실을 꺼낸다 — 놓치면 사람이 못 알아챈다
  summarize: false, // 요약이 어긋나면 원문을 안 읽은 사람은 모른다
  judge: false,     // 판정을 믿고 다음 일이 진행된다
  suggest: true,    // 후보일 뿐이고 사람이 고른다
  generate: false,  // 사람이 그대로 내보낼 수 있는 글이다
  answer: false,    // 출처를 달고 답한다 — 틀리면 출처까지 거짓이 된다
  transcribe: false,// 받아쓴 것을 원본 대신 쓴다
  search: true,     // 순위일 뿐이고 아래를 더 볼 수 있다
}

/**
 * Gemma 를 후보로 둘 수 있는 능력.
 *
 * Gemma 는 **JSON 모드를 조용히 무시하고 산문을 돌려준다**(실측 v0.7.571, HTTP 200 에
 * 사고과정 텍스트). 그리고 자기 초안을 답으로 뱉은 적이 있다(v0.7.716). 그래서 대화와
 * 문서 생성에는 안 쓴다. 반대로 짧은 입력에 짧은 이름표를 붙이는 일은 그 약점이
 * 결과를 망치지 않고, 산문이 와도 json-recover 가 받아 낸다.
 *
 * 버킷이 flash 계열과 완전히 달라서, 여기 한 능력이라도 열어 두면 flash 가 전부 찬
 * 날에도 그 일만은 돈다.
 */
export const GEMMA_OK: Record<AiCapability, boolean> = {
  extract: false, summarize: false, judge: false,
  suggest: true,   // 묶기와 이름표 — 짧게 넣고 짧게 받는다
  generate: false, answer: false, transcribe: false,
  search: true,    // 질의는 한 줄이다
}

/** Gemma 에 넣어도 되는 입력 길이의 상한. 넘으면 후보에서 뺀다 */
export const GEMMA_MAX_INPUT_CHARS = 2_000

const GEMMA_MODEL = 'gemma-4-26b-a4b-it'

export interface ChainOptions {
  /** 어드민이 고른 모델. 쓸 수 있으면 언제나 1순위다 */
  configured?: string | null
  /** JSON 으로 받아야 하나. 기본 true */
  requireJson?: boolean
  /** 이번에 보낼 글의 길이. Gemma 후보 여부를 가른다 */
  inputChars?: number
}

/**
 * 이 능력을 어떤 순서로 부를까.
 *
 * 규칙 셋
 *  1. 어드민이 고른 모델이 쓸 수 있으면 맨 앞 — 고른 것을 조용히 무시하지 않는다
 *  2. 나머지는 **하루 한도가 큰 것부터**. 값싼 능력은 그 순서 그대로,
 *     아닌 능력은 기본 모델을 먼저 세우고 한도 큰 쪽을 안전망으로 뒤에 둔다
 *  3. Gemma 는 열린 능력이고 입력이 짧을 때만, 그리고 JSON 을 강요하지 않을 때만 뒤에 붙인다
 */
export function chainFor(capability: AiCapability, opts: ChainOptions = {}): string[] {
  const requireJson = opts.requireJson ?? true
  const chain: string[] = []

  const picked = (opts.configured ?? '').trim()
  if (picked && (!requireJson || supportsJsonMode(picked))) chain.push(picked)

  const byQuota = MODEL_BY_DAILY_QUOTA.map((m) => m.model)
  const ordered = CHEAP_FIRST[capability]
    ? byQuota
    : [DEFAULT_GEMINI_MODEL, ...byQuota]

  for (const m of ordered) {
    if (!requireJson || supportsJsonMode(m)) chain.push(m)
  }

  const gemmaFits = (opts.inputChars ?? 0) <= GEMMA_MAX_INPUT_CHARS
  if (GEMMA_OK[capability] && gemmaFits && !requireJson) chain.push(GEMMA_MODEL)

  return Array.from(new Set(chain))
}

/** 표가 능력 여덟을 전부 덮고 있나 — 아홉째가 생기면 여기서 걸린다 */
export function missingCapabilities(): AiCapability[] {
  return AI_CAPABILITIES.filter((c) => !(c in CHEAP_FIRST) || !(c in GEMMA_OK))
}
