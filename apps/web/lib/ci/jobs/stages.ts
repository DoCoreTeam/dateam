// lib/ci/jobs/stages.ts — classify / verify / patterns 단계 실행 (서버 전용)
// 설계서 §11.3 검증 루프: 불명확하면 AI가 근거를 보강해 재판정하고,
// 그래도 미달이면 "AI가 이미 시도한 것"을 붙여 검토 큐로 보낸다.

import { createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { getGeminiMeta } from '../ai/meta.ts'
import { callGemini } from '../ai/gemini.ts'
import {
  classifyByRules, shouldAutoConfirm, buildClassifyPrompt, parseLlmVerdict,
  type TopicCandidate,
} from '../analysis/classify.ts'
import { computePatterns, type PatternSample } from '../analysis/patterns.ts'
import { resolveSettings, type SettingRow } from '../settings/resolve.ts'
import { CORPUS_FILTER } from '../corpus.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface StageResult {
  ok: boolean
  errorCode?: string
  errorMessage?: string
}

async function loadThreshold(workspaceId: string): Promise<number> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_settings').select('scope, scope_id, key, value, is_encrypted, version')
      .eq('key', 'topic.autoconfirm_threshold')
    const resolved = resolveSettings((data ?? []) as SettingRow[], { userId: null, workspaceId })
    const v = Number(resolved['topic.autoconfirm_threshold'])
    return Number.isFinite(v) ? v : 0.85
  } catch {
    return 0.85
  }
}

async function loadTopics(workspaceId: string): Promise<TopicCandidate[]> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_topics')
    .select('id, name, ci_topic_rules ( kind, pattern )')
    .eq('workspace_id', workspaceId).is('deleted_at', null).is('merged_into_id', null)

  return ((data ?? []) as any[]).map((t) => {
    const rules = (t.ci_topic_rules ?? []) as { kind: string; pattern: string }[]
    return {
      id: t.id,
      name: t.name,
      // 규칙이 없으면 주제 이름 자체를 포함 키워드로 쓴다 — 설정 없이도 동작해야 한다
      includePatterns: rules.filter((r) => r.kind === 'include').map((r) => r.pattern).concat(
        rules.some((r) => r.kind === 'include') ? [] : [t.name],
      ),
      excludePatterns: rules.filter((r) => r.kind === 'exclude').map((r) => r.pattern),
    }
  })
}

/**
 * 분류 단계. 1차 규칙으로 판정하고, 저확신이면 2차 LLM으로 재판정한다.
 * LLM 키가 없거나 예산이 막히면 1차 결과로 진행한다 — 기능이 통째로 죽지 않는다.
 */
export async function runClassify(workspaceId: string, contentId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: content } = await adminClient
    .from('ci_contents')
    .select('id, title, caption, topic_id, topic_source, ci_channels ( topic_id )')
    .eq('id', contentId).maybeSingle()
  if (!content) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '콘텐츠를 찾을 수 없습니다' }

  // 사용자가 직접 정한 주제는 건드리지 않는다
  if (content.topic_source === 'user') return { ok: true }

  const [topics, threshold] = await Promise.all([loadTopics(workspaceId), loadThreshold(workspaceId)])
  if (topics.length === 0) return { ok: true }   // 주제가 없으면 분류할 것도 없다

  let verdict = classifyByRules({
    title: content.title,
    caption: content.caption,
    channelTopicId: content.ci_channels?.topic_id ?? null,
    topics,
  })
  const attempts: string[] = [`규칙 판정: ${verdict.reason} (확신도 ${verdict.confidence.toFixed(2)})`]

  // 2차 — 저확신 구간만 LLM
  if (!shouldAutoConfirm(verdict.confidence, threshold)) {
    const meta = await getGeminiMeta()
    if (meta.geminiApiKey) {
      const prompt = buildClassifyPrompt({
        title: content.title, caption: content.caption,
        topics: topics.map((t) => ({ id: t.id, name: t.name })),
      })
      const res = await callGemini({ apiKey: meta.geminiApiKey, model: meta.geminiModel, prompt })
      if (res.ok) {
        logTokenUsage({
          userId: null, feature: 'ci-classify', model: meta.geminiModel,
          provider: 'gemini', promptTokens: res.promptTokens,
          outputTokens: res.outputTokens, totalTokens: res.promptTokens + res.outputTokens,
        })
        const llm = parseLlmVerdict(res.text, topics.map((t) => t.id))
        if (llm) {
          attempts.push(`AI 판정: ${llm.reason} (확신도 ${llm.confidence.toFixed(2)})`)
          // AI가 주제를 고른 경우에만 채택한다.
          // "고를 주제가 없다"는 답의 확신도를 "이 주제가 맞다"는 확신도와 비교하면
          // 규칙이 찾아낸 주제가 지워진다(실제 사고: 확신도 1.0의 null이 0.55의 매칭을 덮어씀).
          if (llm.topicId && llm.confidence > verdict.confidence) {
            verdict = { topicId: llm.topicId, confidence: llm.confidence, source: 'ai_verified', reason: llm.reason }
          } else if (!llm.topicId) {
            attempts.push('AI도 맞는 주제를 찾지 못해 규칙 판정을 유지했습니다')
          }
        } else {
          attempts.push('AI 응답 형식이 올바르지 않아 채택하지 않았습니다')
        }
      } else {
        attempts.push(`AI 판정을 시도했으나 실패했습니다: ${res.error}`)
      }
    } else {
      attempts.push('AI 키가 없어 2차 판정을 건너뛰었습니다')
    }
  }

  const auto = shouldAutoConfirm(verdict.confidence, threshold) && verdict.topicId != null

  await adminClient.from('ci_contents').update({
    topic_id: verdict.topicId,
    // 주제를 고르지 못했으면 확신도는 0이다. 미분류에 확신도 1.0을 남기면 화면이 거짓말을 한다.
    topic_confidence: verdict.topicId ? verdict.confidence : 0,
    topic_source: verdict.source,
    // 자동 확정 못 하면 검토 큐로. 사용자는 최종 심판이지 분류 노동자가 아니므로
    // 무엇을 시도했는지 근거를 함께 남긴다.
    review_state: auto ? 'none' : 'pending',
  }).eq('id', contentId)

  if (!auto) {
    await adminClient.from('ci_jobs')
      .update({ payload: { ai_attempts: attempts } })
      .eq('target_id', contentId).eq('stage', 'classify')
  }

  return { ok: true }
}

/**
 * 검증 단계. 결손 필드와 이상 신호를 확인한다.
 * 지금은 삭제 의심(제목·썸네일 동시 소실)만 판정한다 — 판정할 수 있는 것만 판정한다.
 */
export async function runVerify(workspaceId: string, contentId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any
  const { data: c } = await adminClient
    .from('ci_contents')
    .select('id, title, thumbnail_url, ingest_status, completeness, media_fingerprint')
    .eq('id', contentId).maybeSingle()
  if (!c) return { ok: true }

  const suspectedDeleted = c.ingest_status === 'failed' && !c.title && !c.thumbnail_url
  if (suspectedDeleted) {
    await adminClient.from('ci_contents').update({
      deleted_detected_at: new Date().toISOString(),
      is_stat_excluded: true,     // 삭제 의심분은 통계에서 뺀다
    }).eq('id', contentId)
  }

  // 같은 소재 묶음 — 지문이 같은 것끼리 묶는다
  if (c.media_fingerprint) {
    const { data: twins } = await adminClient.from('ci_contents')
      .select('id, content_group_id')
      .eq('workspace_id', workspaceId).eq('media_fingerprint', c.media_fingerprint)
      .is('deleted_at', null).neq('id', contentId).limit(20)

    const existingGroup = (twins ?? []).find((t: any) => t.content_group_id)?.content_group_id
    if (twins && twins.length > 0) {
      let groupId = existingGroup
      if (!groupId) {
        const { data: g } = await adminClient.from('ci_content_groups').insert({
          workspace_id: workspaceId,
          representative_content_id: contentId,
          method: 'fingerprint',
          confidence: 0.99,
        }).select('id').single()
        groupId = g?.id
      }
      if (groupId) {
        await adminClient.from('ci_contents').update({ content_group_id: groupId })
          .in('id', [contentId, ...twins.map((t: any) => t.id)])
      }
    }
  }

  return { ok: true }
}

/**
 * 성공 공식 재계산. 주제 단위로 표본을 모아 승격 기준을 넘는 것만 저장한다.
 * 기준 미달 공식은 만들지 않는다(화면에서 거르는 게 아니다).
 */
export async function runPatterns(workspaceId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: topics } = await adminClient.from('ci_topics')
    .select('id').eq('workspace_id', workspaceId).is('deleted_at', null)

  for (const t of (topics ?? []) as { id: string }[]) {
    const { data } = await adminClient.from('ci_contents')
      .select('id, channel_id, title, duration_sec, published_at, ci_content_derived ( outlier_index, outlier_baseline_n )')
      .eq('workspace_id', workspaceId).eq('topic_id', t.id)
      .eq('source', CORPUS_FILTER.source).eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
      .is('deleted_at', null).limit(1000)

    const samples: PatternSample[] = ((data ?? []) as any[]).map((r) => ({
      contentId: r.id,
      channelId: r.channel_id,
      title: r.title,
      durationSec: r.duration_sec,
      publishedAt: r.published_at,
      outlierIndex: r.ci_content_derived?.outlier_index ?? null,
      baselineN: r.ci_content_derived?.outlier_baseline_n ?? 0,
    }))

    const computed = computePatterns(samples)

    // 이번 계산에서 살아남지 못한 공식은 보관 처리한다 — 낡은 공식이 화면에 남지 않게
    await adminClient.from('ci_patterns')
      .update({ is_archived: true })
      .eq('workspace_id', workspaceId).eq('topic_id', t.id)

    for (const p of computed) {
      const { data: saved } = await adminClient.from('ci_patterns').insert({
        workspace_id: workspaceId,
        topic_id: t.id,
        kind: p.kind,
        statement: p.statement,
        lift: p.lift,
        evidence_count: p.evidenceCount,
        channel_count: p.channelCount,
        confidence: p.evidenceCount >= 40 ? 'high' : 'medium',
        is_archived: false,
      }).select('id').single()

      if (saved?.id) {
        await adminClient.from('ci_pattern_evidence').insert(
          p.contentIds.slice(0, 200).map((cid) => ({ pattern_id: saved.id, content_id: cid })),
        )
      }
    }
  }

  return { ok: true }
}
