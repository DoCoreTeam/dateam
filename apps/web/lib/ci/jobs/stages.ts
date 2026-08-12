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
import { fetchChannelFeed } from '../connectors/channel-feed.ts'
import { fetchChannelMeta } from '../connectors/youtube-channel.ts'
import { fetchAllUploads } from '../connectors/youtube-uploads.ts'
import { isProvisionalKey } from '../ucm/channel-key.ts'
import { analyzeCreative } from '../ai/creative-server.ts'
import { enqueueJob } from './queue.ts'
import { OUTLIER_MIN_BASELINE } from '../format/metrics.ts'

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


/**
 * 채널 일괄 수집 — 채널의 최근 게시물을 전부 끌어와 비교군을 만든다.
 *
 * 이게 없으면 콘텐츠 한 건만 있는 채널의 배수가 영원히 계산되지 않는다.
 * "평소 대비"는 같은 채널의 평소가 있어야 성립한다.
 */
export async function runChannelSweep(workspaceId: string, channelId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: ch } = await adminClient
    .from('ci_channels')
    .select('id, platform, external_id, handle, profile_url')
    .eq('id', channelId).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle()
  if (!ch) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '채널을 찾을 수 없습니다' }

  // 게시물을 훑는 김에 채널 자체의 정보도 채운다. 게시물만 모으고 채널을 모르면
  // "이 채널은 뭐 하는 곳인가"에 답할 수 없다. 실패해도 게시물 수집은 계속한다.
  await enrichChannelMeta(channelId).catch(() => null)

  // 전체 업로드를 먼저 시도한다. RSS는 최근 15개만 주므로 543개 채널을 15개로 판단하게 된다.
  // 키가 없어 전체를 못 받으면 RSS로 내려가되, **몇 개 중 몇 개인지 화면에 남긴다.**
  const meta = await getGeminiMeta()
  const realChannelId = isProvisionalKey(ch.external_id) ? null : ch.external_id
  const full = ch.platform === 'youtube' && realChannelId
    ? await fetchAllUploads(realChannelId, meta.youtubeApiKey).catch(() => null)
    : null

  const feed = full?.ok
    ? {
      ok: true as const,
      entries: full.items,
      method: `youtube_api:${full.items.length}건${full.truncated ? '(상한 절단)' : ' 전량'}`,
    }
    : await fetchChannelFeed({
      platform: ch.platform,
      externalId: ch.external_id,
      handle: ch.handle,
      profileUrl: ch.profile_url,
    })

  // 전체를 못 받은 이유를 채널에 남긴다 — 사용자가 "왜 15개뿐이지"를 화면에서 알 수 있어야 한다
  const coverageNote = !full?.ok && full !== null && !full.ok
    ? full.error
    : (full?.ok && full.truncated ? '업로드가 많아 일부만 가져왔습니다' : null)

  if (!feed.ok) {
    // 실패를 감추지 않는다. 채널 화면에 그대로 보여준다.
    await adminClient.from('ci_channels').update({
      last_sweep_at: new Date().toISOString(),
      sweep_error: feed.error,
    }).eq('id', channelId)
    return { ok: false, errorCode: 'CONNECTOR_FAILED', errorMessage: feed.error }
  }

  let created = 0
  for (const entry of feed.entries) {
    const { data: existing } = await adminClient.from('ci_contents').select('id')
      .eq('workspace_id', workspaceId).eq('platform', ch.platform)
      .eq('external_id', entry.externalId).is('deleted_at', null).maybeSingle()
    if (existing?.id) continue

    const { data: row } = await adminClient.from('ci_contents').insert({
      workspace_id: workspaceId,
      platform: ch.platform,
      external_id: entry.externalId,
      canonical_url: entry.canonicalUrl,
      channel_id: channelId,
      format: 'long',
      title: entry.title,
      published_at: entry.publishedAt,
      thumbnail_url: entry.thumbnailUrl,
      // 채널에서 끌어온 것은 시장 비교의 모집단이 된다
      source: 'monitoring',
      ingest_status: 'queued',
    }).select('id').single()

    if (row?.id) {
      created++
      await enqueueJob({
        workspaceId, stage: 'ingest', targetType: 'content', targetId: row.id, version: Date.now(),
      })
    }
  }

  await adminClient.from('ci_channels').update({
    last_sweep_at: new Date().toISOString(),
    sweep_cursor: feed.method,
    // 수집 범위의 한계는 오류가 아니지만 숨기면 안 된다. 같은 자리에 남겨 화면이 말하게 한다.
    sweep_error: coverageNote,
  }).eq('id', channelId)

  const scope = full?.ok
    ? `채널 전체 ${feed.entries.length}건 확인`
    : `최근 ${feed.entries.length}건만 확인(RSS 한계)`
  return { ok: true, errorMessage: `${created}건 새로 담았습니다 · ${scope}` }
}

/** 한 번에 정보를 가져올 채널 수 상한. */
export const CHANNEL_META_MAX_PER_PASS = 5

/**
 * 채널 자체의 정보를 채운다 — 구독자·소개문·아바타·게시물 수.
 *
 * 콘텐츠 수집은 채널을 "이름과 URL"로만 만든다. 그래서 채널 상세가 계속 "—"였다.
 * 채널을 알아야 그 채널의 콘텐츠를 판단하는데 정작 채널을 몰랐다.
 * 실패는 sweep_error가 아니라 meta_error에 남긴다 — 게시물 수집 실패와 구분해야 한다.
 */
export async function enrichChannelMeta(channelId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: ch } = await adminClient
    .from('ci_channels')
    .select('id, platform, external_id, handle, profile_url, display_name, subscriber_count')
    .eq('id', channelId).maybeSingle()

  if (!ch) return { ok: false, errorMessage: '채널을 찾을 수 없습니다' }
  if (ch.platform !== 'youtube') {
    await adminClient.from('ci_channels').update({
      meta_fetched_at: new Date().toISOString(),
      meta_error: `${ch.platform}는 공개 채널 정보 경로가 없습니다`,
    }).eq('id', channelId)
    return { ok: true, errorMessage: '이 플랫폼은 채널 정보를 공개하지 않습니다' }
  }

  const result = await fetchChannelMeta({
    externalId: isProvisionalKey(ch.external_id) ? null : ch.external_id,
    handle: ch.handle,
    profileUrl: ch.profile_url,
  })

  if (!result.ok) {
    await adminClient.from('ci_channels').update({
      meta_fetched_at: new Date().toISOString(),
      meta_error: result.error,
    }).eq('id', channelId)
    return { ok: false, errorMessage: result.error }
  }

  const m = result.meta
  // 이미 가진 값을 빈 값으로 덮지 않는다. 새로 얻은 것만 채운다.
  const patch: Record<string, unknown> = {
    meta_fetched_at: new Date().toISOString(),
    meta_error: null,
  }
  if (m.displayName) patch.display_name = m.displayName
  if (m.description) patch.description = m.description
  if (m.avatarUrl) patch.avatar_url = m.avatarUrl
  if (m.handle) patch.handle = m.handle
  if (m.videoCount != null) patch.video_count = m.videoCount
  if (m.subscriberCount != null) {
    patch.subscriber_count = m.subscriberCount
    // 공개 페이지 값은 "137만"처럼 반올림 표기다. 정확값인 척하지 않는다.
    patch.subscriber_provenance = 'estimated'
  }
  if (m.externalId && isProvisionalKey(ch.external_id)) patch.external_id = m.externalId

  await adminClient.from('ci_channels').update(patch).eq('id', channelId)
  return { ok: true, errorMessage: m.subscriberText ? `구독자 ${m.subscriberText}` : undefined }
}

/** 정보를 한 번도 못 가져온 채널을 훑어 채운다. 크리에이티브와 같은 자가치유 방식. */
export async function enrichChannelMetaBacklog(workspaceId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_channels')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'youtube')
    .is('meta_fetched_at', null)
    .is('deleted_at', null)
    .limit(CHANNEL_META_MAX_PER_PASS)

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  if (ids.length === 0) return { ok: true }

  let done = 0
  for (const id of ids) {
    const r = await enrichChannelMeta(id)
    if (r.ok) done += 1
  }
  return { ok: true, errorMessage: `채널 ${done}곳 정보 확보` }
}

/** 이 배수를 넘긴 것만 분석한다 — 평범한 걸 분석해봐야 배울 게 없고 AI 비용만 든다. */
export const CREATIVE_MIN_INDEX = 1.5
/** 한 번에 분석할 상한. 15건 일괄 수집 뒤 한꺼번에 터지는 비용을 막는다. */
export const CREATIVE_MAX_PER_PASS = 10

/**
 * 크리에이티브 분석 — "왜 터졌나"를 뽑는다.
 *
 * 워크스페이스 단위로 도는 이유: 배수는 채널 중앙값 대비라 **형제가 들어온 뒤에야** 값이 선다.
 * 자기 콘텐츠 하나만 보면, 먼저 처리된 건은 비교군이 비어 영원히 미달로 지나가고
 * 나중에 배수가 9배로 확정돼도 아무도 다시 보지 않는다.
 * (실제로 그래서 9.01·8.56·7.05배 6건에 분석이 0건이었다.)
 * 매 적재마다 밀린 것을 함께 훑어 스스로 메운다.
 */
export async function runCreativeBacklog(workspaceId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  // ci_content_derived에는 workspace_id가 없다 — 콘텐츠를 inner join해 워크스페이스를 가둔다.
  const { data: hot } = await adminClient
    .from('ci_content_derived')
    .select('content_id, outlier_index, ci_contents!inner(workspace_id, deleted_at)')
    .eq('ci_contents.workspace_id', workspaceId)
    .is('ci_contents.deleted_at', null)
    .gte('outlier_index', CREATIVE_MIN_INDEX)
    .gte('outlier_baseline_n', OUTLIER_MIN_BASELINE)
    .order('outlier_index', { ascending: false })
    .limit(200)

  const ids = ((hot ?? []) as { content_id: string }[]).map((r) => r.content_id)
  if (ids.length === 0) return { ok: true }

  const { data: done } = await adminClient
    .from('ci_content_creative').select('content_id').in('content_id', ids)
  const analyzed = new Set(((done ?? []) as { content_id: string }[]).map((r) => r.content_id))

  const pending = ids.filter((id) => !analyzed.has(id)).slice(0, CREATIVE_MAX_PER_PASS)
  if (pending.length === 0) return { ok: true }

  let failed = 0
  for (const id of pending) {
    const result = await analyzeCreative(id)
    if (!result.ok) failed += 1
  }

  return {
    ok: true,
    errorMessage: `${pending.length - failed}건 분석${failed ? ` · ${failed}건 실패` : ''}`,
  }
}
