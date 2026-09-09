// POST /api/rfp/radar/rules/draft — 말한 것을 찾을 조건으로 바꾼다
//
// 「AI 관련 3억 이상 공공기관 사업」 → { keywords, agencies, budgetMin }
//
// **저장하지 않는다.** 정형화한 결과를 돌려주고 사람이 화면에서 고친 뒤 저장한다 —
// 조건이 틀리면 그 뒤 모든 알림이 틀리는데, 사용자는 「레이더가 이상하다」로만 느낀다.
//
// 규칙이 금액을 풀고 AI 는 남은 것만 푼다. AI 가 없거나 죽어도 낱말은 뽑아 준다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import {
  draftByRules, unfilledParts, buildRulePrompt, parseRuleDraft, mergeRuleDraft, keywordsFallback,
} from '@/lib/rfp/radar/rule-from-text'
import { callWithFallback } from '@/lib/rfp/ai/gateway'
import { pickModels } from '@/lib/rfp/ai/models'
import { toModels, toPolicy } from '@/lib/rfp/ai/host-providers'
import { makeHostCaller } from '@/lib/rfp/ai/host-caller'
import { getAvailableProviders } from '@/lib/ai-chat/registry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 한 문장이면 충분하다. 문서를 붙여 넣는 자리가 아니다 */
const MAX_TEXT_CHARS = 500

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: Record<string, unknown>
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT_CHARS) : ''
  if (!text) return NextResponse.json({ error: 'missing_text' }, { status: 400 })

  // ① 규칙이 금액을 푼다 — 「3억 이상」의 뜻은 안 흔들린다
  const rules = draftByRules(text)
  const parts = unfilledParts(rules)

  let aiSkipped: string | null = null
  let ai: Partial<typeof rules> = {}

  if (parts.length > 0) {
    try {
      const admin = createAdminClient()
      const { data: metaRow } = await (admin as any)
        .from('org_content').select('value').eq('key', 'META').single()
      const meta = ((metaRow as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>
      const providers = getAvailableProviders(meta).map((p) => ({ id: p.id, apiKey: p.apiKey, model: p.model }))

      const { data: policyRows } = await (admin as any)
        .from('rfp_ai_models')
        .select('vendor_id, allowed_doc_classes, is_internal, no_training, zero_retention, input_krw_per_mtok, output_krw_per_mtok, multimodal, sort_order, enabled')
      const models = toModels(providers, ((policyRows ?? []) as Record<string, unknown>[]).map(toPolicy))

      // 사람이 찾고 싶은 것을 적은 한 문장이다 — 비밀 문서가 아니라 공개 등급이다
      const pick = pickModels(models, { docClass: 'public' })
      if (pick.chain.length === 0) {
        aiSkipped = 'no_model'
      } else {
        const db = await createClient()
        const { data: orgId } = await (db as any).rpc('rfp_default_org')
        const out = await callWithFallback(pick.chain, {
          orgId: String(orgId ?? ''),
          caseId: null,
          docClass: 'public',
          purpose: 'radar_rule_draft',
          prompt: buildRulePrompt(text, parts),
          maxOutputTokens: 512,
        }, {
          store: {
            async recordCall(r) {
              // 칸 이름은 표에 맞춘다. supabase-js 는 없는 칸을 던지지 않고 돌려주므로
              // 틀리면 기록이 조용히 0건이 된다
              const { error } = await (admin as any).from('rfp_llm_calls').insert({
                org_id: r.orgId, model_id: uuidOrNull(r.modelId), purpose: r.purpose,
                input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_krw: r.costKrw,
                latency_ms: r.latencyMs, status: r.ok ? 'ok' : 'error', error: r.error,
              })
              if (error) console.error('[rfp] llm 호출 기록 실패', error)
            },
            async recordTransfer() {
              // 공개 등급의 한 문장이라 전송 원장에 남길 문서가 없다
            },
          },
          call: makeHostCaller({ providers }),
        })
        ai = parseRuleDraft(out.text)
        // 불렀는데 아무것도 못 건졌으면 그것도 말한다 — 조용히 낱말만 뽑아 놓으면
        // 사용자는 그게 AI 가 이해한 결과인 줄 안다
        if (Object.keys(ai).length === 0) aiSkipped = 'ai_empty'
      }
    } catch (e) {
      aiSkipped = e instanceof Error ? e.message : 'ai_failed'
    }
  }

  const draft = mergeRuleDraft(rules, ai, text)

  // AI 가 못 풀었으면 낱말이라도 뽑는다 — 「아무것도 안 됨」이 되면 안 된다
  if (draft.keywords.length === 0 && draft.agencies.length === 0) {
    draft.keywords = keywordsFallback(text)
  }

  return NextResponse.json({ draft, aiSkipped })
}

/**
 * 기록의 model_id 는 uuid 칸이다.
 *
 * 호스트 폴백 모델(표에 없는 것)은 id 가 'gemini' 같은 이름이라 그대로 넣으면
 * **insert 가 통째로 실패하고 supabase 는 던지지 않는다** — 기록이 조용히 0건이 된다.
 */
function uuidOrNull(v: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null
}
