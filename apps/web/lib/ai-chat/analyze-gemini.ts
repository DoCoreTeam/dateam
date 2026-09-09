// 목록 심층분석 — Gemini 1회 호출 SSOT.
//
// 왜 분리했나: 기존에는 이 함수가 `analyze/actions.ts`(=`'use server'` 파일) 내부 private로 있어
// 다른 경로(그룹핑 서버액션 등)에서 재사용할 수 없었다. 'use server' 파일은 export가 전부
// 서버액션이어야 하므로 헬퍼를 그 파일에 둔 채 공유할 수 없다. → lib으로 승격해 SSOT화.
//
// 토큰 사용량은 항상 logTokenUsage로 기록하고 호출측에도 반환한다(세션 토큰 표시용).

import { createAdminClient } from '@/lib/supabase/server'
import { getProviderConfig, getProvider, getAvailableProviders } from '@/lib/ai-chat/registry'
import type { ChatUsage } from '@/lib/ai-chat/provider'
import { buildModelChain, pruneChain, type ChainCandidate } from '@/lib/ai-chat/model-chain'
import { classifyProviderError } from '@/lib/ai-chat/provider-errors'
import { logTokenUsage } from '@/lib/token-logger'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export const ZERO_USAGE: ChatUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

export interface GeminiAttachment {
  kind: 'image'
  mime: string
  filename: string
  dataBase64: string
}

async function readMeta(admin: AdminClient): Promise<Record<string, unknown>> {
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
  return (data?.value as Record<string, unknown>) ?? {}
}

/** Gemini 1회 호출(비스트리밍 누적). 프로바이더 SSOT(registry.ts) 재사용. */
export async function callGeminiOnce(
  userId: string,
  turnContent: string,
  attachments?: GeminiAttachment[],
  modelOverride?: string,
): Promise<{ text: string; usage: ChatUsage }> {
  const admin = createAdminClient() as AdminClient
  const meta = await readMeta(admin)
  const cfg = getProviderConfig(meta, 'gemini')
  if (!cfg) throw new Error('Gemini API 키가 설정되지 않았습니다')
  const model = modelOverride?.trim() || cfg.model // 세션 선택 모델 우선, 없으면 org 기본

  /**
   * 채팅과 같은 폴백 체인을 탄다(lib/ai-chat/model-chain).
   *
   * 예전엔 Gemini 를 1회 부르고 끝이라, 무료 티어 한도 하나에 심층분석이 통째로 죽었다.
   * 첨부가 있으면 그림을 못 보는 공급자로는 넘어가지 않는다.
   */
  const { data: catalogRows } = await admin
    .from('ai_model_catalog')
    .select('provider, model_id, is_active, availability')
  const chain = buildModelChain({
    chosen: { provider: 'gemini', model },
    providers: getAvailableProviders(meta),
    catalog: (catalogRows as { provider: string; model_id: string }[] | null) ?? [],
    capabilities: {
      gemini: getProvider('gemini').capabilities,
      claude: getProvider('claude').capabilities,
      openai: getProvider('openai').capabilities,
    },
    requires: { vision: (attachments?.length ?? 0) > 0 },
  })
  if (chain.length === 0) throw new Error('지금 쓸 수 있는 AI 모델이 없습니다')

  let rest: ChainCandidate[] = chain
  let lastError: unknown = null

  while (rest.length > 0) {
    const cand = rest[0]
    rest = rest.slice(1)
    const controller = new AbortController()
    let text = ''
    try {
      const result = await getProvider(cand.provider).streamChat({
        apiKey: cand.apiKey,
        model: cand.model,
        turns: [{ role: 'user', content: turnContent, attachments }],
        signal: controller.signal,
        onDelta: (d) => {
          text += d
        },
      })

      logTokenUsage({
        userId,
        feature: 'ai-chat-analyze',
        model: cand.model,
        provider: cand.provider,
        promptTokens: result.usage.promptTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      })

      return { text: result.text, usage: result.usage }
    } catch (err) {
      lastError = err
      console.error('[analyze] 후보 실패', cand.provider, cand.model, err)
      rest = pruneChain(rest, cand, classifyProviderError(err).scope)
    }
  }

  throw lastError ?? new Error('AI 응답을 생성하지 못했습니다')
}

/** AI 응답에서 JSON 객체만 안전 파싱(코드펜스 방어). 실패 시 null — 호출측이 폴백한다. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
  try {
    const parsed: unknown = JSON.parse(stripped)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
