import 'server-only'

/**
 * Release 2 의 Gemini 호출 — **한 자리로 모은다** (명세 §16 · §17.1)
 *
 * 기능이 여섯(지식 카드·소스 분석·패턴 리포트·스펙 후보·신호 설명·설정 도우미)인데
 * 저마다 `callGeminiText` 를 부르면 `surface` 가 여섯 갈래가 되고, 「트레이딩이 AI 를
 * 얼마나 썼나」를 한 번에 못 센다. 실측 전례가 있다 — 상한을 아는 자리가 0곳이라
 * 하루 23,318건이 나갔고 그중 22,131건은 어차피 한도로 실패했다.
 *
 * 새 키 풀도 새 예산도 새 원장도 안 만든다. `callGeminiText` 가 이미
 * `beginGuardedCall` 을 지나 가림·예산·원장·실패 사유를 함께 처리한다.
 *
 * ## 실패를 값으로 돌려준다
 *
 * 던지지 않는다. 지식은 곁가지다 — 카드를 못 만들었다고 수집과 판단이 멈추면 안 된다.
 * 대신 **왜 못 만들었는지**가 값으로 온다. 조용히 빈 카드를 만들지 않는다.
 */

import { callGeminiText, GeminiCallError } from '@/lib/ai/gemini-call'
import { resolveProviderKey } from '@/lib/ai/provider-key-source'
import { BudgetDeniedError } from '@/lib/ai/budget'
import { knowledgeFeature, KNOWLEDGE_SURFACE, type KnowledgePurpose } from './surface.ts'
import { callCompatibleText, canCallCompatible } from '@/lib/ai/openai-compatible-text'
import type { AiProviderId } from '@/lib/ai/provider-catalog'

export { KNOWLEDGE_SURFACE, KNOWLEDGE_PURPOSES, type KnowledgePurpose } from './surface.ts'

export interface KnowledgeCallInput {
  purpose: KnowledgePurpose
  prompt: string
  /** 관리자가 고른 모델. 비면 기본 사슬 */
  model?: string | null
  /**
   * 어느 공급자로 부르나. 기본은 gemini 다.
   *
   * **왜 고를 수 있어야 하나** (사용자 지적 2026-09-27 「gemini로 박지 말라고 우리 AI 키
   * 들어 간거 다 쓸수 있도록」): 등록된 키가 여럿인데 이 자리가 한 벤더에 묶여 있으면
   * 나머지 키는 있으나 마나다.
   */
  provider?: AiProviderId | null
  /** JSON 을 요구하나 */
  json: boolean
  maxOutputTokens?: number
  timeoutMs?: number
}

export type KnowledgeCallResult =
  | { ok: true; text: string; model: string }
  /** **왜 못 했는지가 반드시 있다.** 조용히 빈 값을 돌려주지 않는다 */
  | { ok: false; reason: string; userMessage: string }

const USER_MESSAGE: Record<string, string> = {
  no_key: 'AI 키가 등록되지 않아 이 글을 만들 수 없습니다',
  budget_denied: 'AI 예산이 다 차서 이 글을 만들 수 없습니다',
  call_failed: 'AI 가 답하지 못했습니다',
}

/**
 * 한 번 부른다.
 *
 * `actorId` 를 안 받는다 — 지식 작업은 크론이 돌리는 배경 작업이고, 사람이 누른 순간이 없다.
 * 그때는 `feature` 이름이 주인을 대신한다(`lib/ai/actor.ts` 등재부가 그 규칙을 갖고 있다).
 */
export async function callKnowledge(input: KnowledgeCallInput): Promise<KnowledgeCallResult> {
  /**
   * 원장에 남길 이름. 표면을 **글자 그대로** 한 번 박아 둔다 —
   * `surface.ts` 에서 이름이 바뀌면 이 줄의 형 검사가 깨진다. 이름이 갈리면
   * 「트레이딩이 AI 를 얼마나 썼나」가 두 갈래로 세어지고 화면에서는 안 보인다.
   */
  const expectedSurface: 'trading_knowledge' = KNOWLEDGE_SURFACE
  const feature = knowledgeFeature(input.purpose)
  if (!feature.startsWith(expectedSurface)) {
    return { ok: false, reason: 'surface_drift', userMessage: USER_MESSAGE.call_failed }
  }

  const provider = (input.provider ?? 'gemini') as AiProviderId

  /**
   * gemini 는 **전용 길**로 간다.
   *
   * 그쪽에는 모델 사슬(`lib/ai/gemini-model.ts`)이 있어 고른 모델이 사라진 날
   * 다음 후보로 내려간다. 호환 창구로 보내면 그 사슬이 사라져 404 하나로 끝난다.
   * 나머지 공급자는 사슬이 없으므로 공용 호환 창구로 간다 — 규칙은 같고 길만 다르다.
   */
  if (provider !== 'gemini') {
    if (!canCallCompatible(provider)) {
      return { ok: false, reason: `no_door:${provider}`, userMessage: USER_MESSAGE.call_failed }
    }
    const r = await callCompatibleText({
      provider,
      model: input.model ?? '',
      prompt: input.prompt,
      surface: KNOWLEDGE_SURFACE,
      purpose: feature,
      json: input.json,
    })
    return r.ok
      ? { ok: true, text: r.text, model: input.model ?? '' }
      : { ok: false, reason: r.reason, userMessage: USER_MESSAGE.call_failed }
  }

  const choice = await resolveProviderKey('gemini', null)
  if (!choice.apiKey) {
    return { ok: false, reason: `no_key:${choice.reason}`, userMessage: USER_MESSAGE.no_key }
  }

  try {
    const result = await callGeminiText({
      prompt: input.prompt,
      apiKey: choice.apiKey,
      model: input.model ?? null,
      // 같은 자료에 같은 글이 나와야 한다. 온도를 올리면 다시 돌릴 때마다 다른 말이 되고,
      // 「무엇이 바뀌어서 글이 바뀌었나」를 못 묻는다
      temperature: 0,
      responseJson: input.json,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
      feature,
      actorId: null,
    })
    return { ok: true, text: result.text, model: result.model }
  } catch (error) {
    if (error instanceof BudgetDeniedError) {
      return { ok: false, reason: 'budget_denied', userMessage: USER_MESSAGE.budget_denied }
    }
    const detail = error instanceof GeminiCallError
      ? error.message
      : error instanceof Error ? error.message : 'unknown'
    return { ok: false, reason: `call_failed:${detail}`.slice(0, 300), userMessage: USER_MESSAGE.call_failed }
  }
}
