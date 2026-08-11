// lib/ci/ai/brief-server.ts — 기획안 AI 생성 (서버 전용)
// 근거(떡상·성공 공식)를 프롬프트에 실어 보낸다. 근거 없이 그럴듯한 문장만 만들지 않는다.

import { createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { getGeminiMeta } from './meta.ts'
import { callGemini } from './gemini.ts'
import { buildBriefPrompt, parseBriefDraft, type BriefDraft } from './brief.ts'
import { formatLift, formatOutlier } from '../format/metrics.ts'
import { resolveSettings, type SettingRow } from '../settings/resolve.ts'
import type { CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type GenerateResult =
  | { ok: true; draft: BriefDraft }
  | { ok: false; error: string }

async function loadAiSettings(workspaceId: string): Promise<{ brandVoice: string; locale: string }> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_settings')
      .select('scope, scope_id, key, value, is_encrypted, version')
      .in('key', ['ai.brand_voice', 'ai.response_locale'])
    const r = resolveSettings((data ?? []) as SettingRow[], { userId: null, workspaceId })
    return {
      brandVoice: typeof r['ai.brand_voice'] === 'string' ? r['ai.brand_voice'] : '',
      locale: typeof r['ai.response_locale'] === 'string' ? r['ai.response_locale'] : 'ko',
    }
  } catch {
    return { brandVoice: '', locale: 'ko' }
  }
}

export async function generateBriefDraft(input: {
  workspaceId: string
  ideaId: string
  fields?: (keyof BriefDraft)[]
  base?: BriefDraft
}): Promise<GenerateResult> {
  const adminClient = createAdminClient() as any

  const { data: idea } = await adminClient.from('ci_ideas')
    .select('id, title, note, target_platforms, ci_topics ( id, name ), ci_idea_evidence ( source_type, source_id )')
    .eq('id', input.ideaId).eq('workspace_id', input.workspaceId).maybeSingle()
  if (!idea) return { ok: false, error: '아이디어를 찾을 수 없습니다' }

  // 근거 콘텐츠 — 제목과 배수 문장을 그대로 넘긴다
  const contentIds = ((idea.ci_idea_evidence ?? []) as { source_type: string; source_id: string }[])
    .filter((e) => e.source_type === 'content').map((e) => e.source_id)

  let evidence: { title: string; outlierText: string | null }[] = []
  if (contentIds.length > 0) {
    const { data } = await adminClient.from('ci_contents')
      .select('title, ci_content_derived ( outlier_index, outlier_baseline_n )')
      .in('id', contentIds).limit(10)
    evidence = ((data ?? []) as any[]).map((c) => ({
      title: c.title ?? '제목 없음',
      outlierText: formatOutlier(
        c.ci_content_derived?.outlier_index ?? null,
        c.ci_content_derived?.outlier_baseline_n ?? 0,
      ),
    }))
  }

  // 이 주제에서 확인된 공식 — 승격 기준을 넘긴 것만 나온다
  let patterns: string[] = []
  if (idea.ci_topics?.id) {
    const { data } = await adminClient.from('ci_patterns')
      .select('statement, lift, evidence_count, channel_count')
      .eq('workspace_id', input.workspaceId).eq('topic_id', idea.ci_topics.id)
      .eq('is_archived', false).order('lift', { ascending: false }).limit(5)
    patterns = ((data ?? []) as any[])
      .map((p) => formatLift(p.lift, p.evidence_count, p.channel_count))
      .filter((s): s is string => Boolean(s))
  }

  const [meta, ai] = await Promise.all([getGeminiMeta(), loadAiSettings(input.workspaceId)])
  if (!meta.geminiApiKey) {
    return { ok: false, error: 'AI 키가 설정되지 않아 직접 작성 모드로 만들었습니다' }
  }

  const prompt = buildBriefPrompt({
    ideaTitle: idea.title,
    note: idea.note,
    topicName: idea.ci_topics?.name ?? null,
    platforms: (idea.target_platforms ?? []) as CiPlatform[],
    brandVoice: ai.brandVoice,
    locale: ai.locale,
    evidence,
    patterns,
    fields: input.fields,
  })

  const res = await callGemini({ apiKey: meta.geminiApiKey, model: meta.geminiModel, prompt, temperature: 0.7 })
  if (!res.ok) return { ok: false, error: res.error }

  logTokenUsage({
    userId: null, feature: 'ci-brief', model: meta.geminiModel, provider: 'gemini',
    promptTokens: res.promptTokens, outputTokens: res.outputTokens,
    totalTokens: res.promptTokens + res.outputTokens,
  })

  const draft = parseBriefDraft(res.text, input.base)
  if (!draft) return { ok: false, error: 'AI 응답 형식이 올바르지 않아 반영하지 않았습니다' }

  return { ok: true, draft }
}
