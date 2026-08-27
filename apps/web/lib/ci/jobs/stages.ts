// lib/ci/jobs/stages.ts — classify / verify / patterns 단계 실행 (서버 전용)
// 설계서 §11.3 검증 루프: 불명확하면 AI가 근거를 보강해 재판정하고,
// 그래도 미달이면 "AI가 이미 시도한 것"을 붙여 검토 큐로 보낸다.

import { createAdminClient } from '@/lib/supabase/server'
import { logTokenUsage } from '@/lib/token-logger'
import { getGeminiMeta } from '../ai/meta.ts'
import { callGemini } from '../ai/gemini.ts'
import {
  classifyByRules, shouldCallAi, buildClassifyPrompt, parseLlmVerdict,
  type TopicCandidate, type BasisRung, type ClassifyVerdict,
} from '../analysis/classify.ts'
import {
  computeChannelIdentity, judgeIdentity, identityConfidence, describeIdentity, describeSample,
  type ChannelIdentity, type ChannelSignalSample,
} from '../analysis/channel-identity.ts'
import { computePatterns, type PatternSample } from '../analysis/patterns.ts'
import {
  buildContrastSets, promoteDiscoveries, type DiscoverySample,
} from '../analysis/discovery.ts'
import { discoverFromContrasts } from '../ai/discover-server.ts'
import { buildCorrectionExamples, type CorrectionRecord } from '../analysis/corrections.ts'
import { resolveSettings, type SettingRow } from '../settings/resolve.ts'
import { CORPUS_FILTER } from '../corpus.ts'
import { fetchChannelFeed } from '../connectors/channel-feed.ts'
import { fetchChannelMeta } from '../connectors/youtube-channel.ts'
import {
  fetchAllUploads, windowSince, COLLECT_WINDOWS, type CollectWindowId,
} from '../connectors/youtube-uploads.ts'
import { isProvisionalKey } from '../ucm/channel-key.ts'
import { analyzeCreative } from '../ai/creative-server.ts'
import { understandMedia, recordSkip } from '../media/understand-server.ts'
import { understandingToEvidenceText, type MediaUnderstanding } from '../media/understand.ts'
import { shouldUnderstand, MEDIA_MAX_PER_PASS, type AnalyzedRecord } from '../media/policy.ts'
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

/**
 * 이 워크스페이스의 주제 정정 이력 (설계서 §11.4).
 * 실패해도 분류를 막지 않는다 — 학습 재료가 없는 것과 분류가 죽는 것은 다르다.
 */
async function loadCorrectionExamples(
  workspaceId: string,
  topics: readonly TopicCandidate[],
): Promise<string[]> {
  try {
    const adminClient = createAdminClient() as any
    // ci_corrections.target_id는 여러 테이블을 가리키는 다형 참조라 FK가 없다.
    // PostgREST 임베드가 성립하지 않으므로 제목은 따로 읽는다(임베드하면 조회 자체가 실패한다).
    const { data } = await adminClient
      .from('ci_corrections')
      .select('target_id, before_value, after_value, created_at')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'topic')
      .eq('target_type', 'content')
      .order('created_at', { ascending: false })
      .limit(50)

    const rows = (data ?? []) as any[]
    if (rows.length === 0) return []

    const { data: titles } = await adminClient
      .from('ci_contents')
      .select('id, title')
      .in('id', rows.map((r) => r.target_id).filter(Boolean))
    const titleById = new Map(
      ((titles ?? []) as { id: string; title: string | null }[]).map((c) => [c.id, c.title]),
    )

    const records: CorrectionRecord[] = rows.map((r) => ({
      title: titleById.get(r.target_id) ?? null,
      fromTopicId: (r.before_value?.topicId as string | null) ?? null,
      toTopicId: (r.after_value?.topicId as string | null) ?? null,
      createdAt: r.created_at,
    }))

    const nameById = Object.fromEntries(topics.map((t) => [t.id, t.name]))
    return buildCorrectionExamples(records, nameById)
  } catch {
    return []
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
    const of = (kind: string) => rules.filter((r) => r.kind === kind).map((r) => r.pattern)
    const include = of('include')
    const signal = of('signal')
    return {
      id: t.id,
      name: t.name,
      // 규칙이 없으면 주제 이름 자체를 포함 키워드로 쓴다 — 설정 없이도 동작해야 한다
      includePatterns: include.length > 0 ? include : [t.name],
      excludePatterns: of('exclude'),
      // 신호 규칙도 같다. 주제가 '음악'이면 signalLabel이 '음악'인 신호에 걸린다 —
      // 주제를 만들자마자 플랫폼 신호가 붙도록 기본값을 준다.
      signalPatterns: signal.length > 0 ? signal : [t.name],
      categoryPatterns: of('category'),
    }
  })
}

/**
 * 채널의 신호 표본과 정체성. 분류(L1)와 채널 판정이 함께 쓴다.
 * 실패하면 null — 채널 정보를 못 읽는 것과 분류가 죽는 것은 다르다.
 */
async function loadChannelContext(channelId: string | null): Promise<{
  platform: string
  topicId: string | null
  topicConfidence: number | null
  displayName: string | null
  description: string | null
  identity: ChannelIdentity | null
} | null> {
  if (!channelId) return null
  try {
    const adminClient = createAdminClient() as any
    const { data: ch } = await adminClient
      .from('ci_channels')
      .select('id, platform, topic_id, topic_confidence, display_name, description, identity')
      .eq('id', channelId).is('deleted_at', null).maybeSingle()
    if (!ch) return null

    const stored = ch.identity as ChannelIdentity | null
    return {
      platform: ch.platform,
      topicId: ch.topic_id ?? null,
      topicConfidence: ch.topic_confidence != null ? Number(ch.topic_confidence) : null,
      displayName: ch.display_name ?? null,
      description: ch.description ?? null,
      identity: stored && typeof stored === 'object' && 'sampleSize' in stored ? stored : null,
    }
  } catch {
    return null
  }
}

/**
 * 분류 단계. 1차 규칙으로 판정하고, 저확신이면 2차 LLM으로 재판정한다.
 * LLM 키가 없거나 예산이 막히면 1차 결과로 진행한다 — 기능이 통째로 죽지 않는다.
 */
/**
 * 영상에서 관측된 것을 분류가 쓸 텍스트로 꺼낸다.
 *
 * 없으면 null이다 — "안 읽었다"와 "읽었는데 아무것도 없었다"를 구분해야
 * 사다리가 LM 단에서 정직한 말을 할 수 있다.
 */
async function loadMediaEvidence(contentId: string): Promise<{
  text: string | null; topicGuess: string | null
}> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_content_media')
    .select('transcript, on_screen_text, setting, topic_guess, topic_evidence')
    .eq('content_id', contentId).maybeSingle()
  if (!data) return { text: null, topicGuess: null }

  const u = {
    transcript: data.transcript ?? null,
    onScreenText: Array.isArray(data.on_screen_text) ? data.on_screen_text : [],
    setting: data.setting ?? null,
    topicGuess: data.topic_guess ?? null,
    topicEvidence: data.topic_evidence ?? null,
  } as MediaUnderstanding

  const text = understandingToEvidenceText(u)
  return { text: text || null, topicGuess: data.topic_guess ?? null }
}

export async function runClassify(workspaceId: string, contentId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: content } = await adminClient
    .from('ci_contents')
    .select('id, platform, title, caption, topic_id, topic_source, channel_id, keywords, platform_category, topic_signals')
    .eq('id', contentId).maybeSingle()
  if (!content) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '콘텐츠를 찾을 수 없습니다' }

  // 사용자가 직접 정한 주제는 건드리지 않는다
  if (content.topic_source === 'user') return { ok: true }

  const [topics, threshold, channel, media] = await Promise.all([
    loadTopics(workspaceId),
    loadThreshold(workspaceId),
    loadChannelContext(content.channel_id ?? null),
    loadMediaEvidence(contentId),
  ])
  if (topics.length === 0) return { ok: true }   // 주제가 없으면 분류할 것도 없다

  const signals: ChannelSignalSample = {
    platformCategory: content.platform_category ?? null,
    topicSignals: Array.isArray(content.topic_signals) ? content.topic_signals : [],
    keywords: Array.isArray(content.keywords) ? content.keywords : [],
  }

  let verdict = classifyByRules({
    title: content.title,
    caption: content.caption,
    channelTopicId: channel?.topicId ?? null,
    channelTopicConfidence: channel?.topicConfidence ?? null,
    channelIdentity: channel?.identity ?? null,
    signals,
    platform: content.platform,
    mediaText: media.text,
    mediaTopicGuess: media.topicGuess,
    topics,
  })
  const rungs: BasisRung[] = [...verdict.rungs]

  // ── L3 · AI ───────────────────────────────────────────────────
  // 후보가 1개 이하면 부르지 않는다. "요리인가 아닌가"를 물으면서 정답지에 요리만 놓으면
  // AI가 무엇을 답해도 정보가 늘지 않는다(실측: 그 상태로 15건 호출, 15건 모두 같은 답).
  if (shouldCallAi(topics.length, verdict, threshold)) {
    const meta = await getGeminiMeta()
    if (meta.geminiApiKey) {
      // 사용자가 고친 것을 AI에게 돌려준다 — 정정을 쌓아만 두면 같은 실수를 영원히 반복한다.
      const correctionExamples = await loadCorrectionExamples(workspaceId, topics)
      const prompt = buildClassifyPrompt({
        title: content.title,
        caption: content.caption,
        topics: topics.map((t) => ({ id: t.id, name: t.name })),
        // 채널 맥락 — 예전 프롬프트에는 이것이 통째로 빠져 있었다.
        // 그래서 AI가 규칙과 같은 것을 보고 같은 답을 냈다.
        channel: channel ? {
          name: channel.displayName,
          description: channel.description,
          identityText: channel.identity ? describeIdentity(channel.identity) : null,
        } : null,
        signalText: describeSample(content.platform, signals),
        // 숏폼에서는 이것이 AI가 볼 수 있는 유일한 본문이다
        mediaText: media.text,
        correctionExamples,
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
          // AI가 주제를 고른 경우에만 채택한다.
          // "고를 주제가 없다"는 답의 확신도를 "이 주제가 맞다"는 확신도와 비교하면
          // 규칙이 찾아낸 주제가 지워진다(실제 사고: 확신도 1.0의 null이 0.55의 매칭을 덮어씀).
          if (llm.topicId && llm.confidence > verdict.confidence) {
            rungs.push({ level: 'L3', ok: true, detail: `AI 판정: ${llm.reason}` })
            verdict = {
              ...verdict,
              topicId: llm.topicId,
              confidence: llm.confidence,
              source: 'ai_verified',
              reason: llm.reason,
              // AI가 판단해 준 것은 더 이상 사람에게 묻지 않는다
              needsHuman: llm.confidence < 0.5,
            }
          } else {
            rungs.push({
              level: 'L3',
              ok: false,
              detail: llm.topicId
                ? 'AI 판정이 규칙 판정보다 약해 채택하지 않았습니다'
                : 'AI도 맞는 주제를 찾지 못했습니다',
            })
          }
        } else {
          rungs.push({ level: 'L3', ok: false, detail: 'AI 응답 형식이 올바르지 않아 채택하지 않았습니다' })
        }
      } else {
        rungs.push({ level: 'L3', ok: false, detail: `AI 판정 실패: ${res.error}` })
      }
    } else {
      rungs.push({ level: 'L3', ok: false, detail: 'AI 키가 없어 2차 판정을 건너뛰었습니다' })
    }
  }

  await adminClient.from('ci_contents')
    .update(buildClassifyUpdate(verdict, rungs))
    .eq('id', contentId)

  return { ok: true }
}

/**
 * 판정 결과를 저장 컬럼으로. **한 곳에서만 만든다** —
 * 단건 분류(runClassify)와 채널 일괄 재분류가 다른 모양으로 쓰면
 * 어느 경로를 탔느냐에 따라 같은 게시물이 다르게 보인다.
 *
 * 검토 큐로 보내는 조건이 바뀌었다.
 *   예전: 임계 미달이면 전부 pending → 96.6%가 큐에 쌓였다
 *   지금: **판단이 갈릴 때만** pending. 근거가 약한 것은 '추정'으로 쓰고 넘어간다.
 */
function buildClassifyUpdate(
  verdict: ClassifyVerdict, rungs: BasisRung[],
): Record<string, unknown> {
  return {
    topic_id: verdict.topicId,
    // 주제를 고르지 못했으면 확신도는 0이다. 미분류에 확신도 1.0을 남기면 화면이 거짓말을 한다.
    topic_confidence: verdict.topicId ? verdict.confidence : 0,
    topic_source: verdict.source,
    secondary_topic_ids: verdict.topicId
      ? verdict.secondaryTopicIds.filter((id) => id !== verdict.topicId)
      : [],
    review_state: verdict.needsHuman ? 'pending' : 'none',
    // 근거를 콘텐츠에 남긴다. 예전엔 ci_jobs.payload에 있어 목록에서 볼 수 없었고,
    // 그래서 사용자는 "이거 하드코딩이니 AI니"를 물을 수밖에 없었다.
    topic_basis: {
      reason: verdict.reason,
      rungs,
      decidedBy: verdict.source,
      needsHuman: verdict.needsHuman,
      at: new Date().toISOString(),
    },
  }
}

/**
 * 채널 소속 게시물을 **한 번에** 다시 판정한다.
 *
 * 왜 따로 있나: runClassify를 게시물마다 부르면 주제·임계·채널 맥락을 매번 다시 읽는다.
 * 311건짜리 채널이면 왕복이 1,000번을 넘어 "눌렀는데 화면은 그대로"가 된다(실측).
 * 판정 로직은 여전히 classifyByRules 하나뿐이고, 여기서는 **읽기를 한 번으로 줄일 뿐**이다.
 *
 * AI(L3)는 부르지 않는다 — 수백 건에 AI를 거는 것은 이 자리에서 할 일이 아니다.
 * 애매한 건은 needsHuman으로 남아 검토 화면에서 개별로 다시 판정된다.
 */
export async function reclassifyChannelContents(
  workspaceId: string, channelId: string,
): Promise<number> {
  const adminClient = createAdminClient() as any

  const [topics, channel] = await Promise.all([
    loadTopics(workspaceId),
    loadChannelContext(channelId),
  ])
  if (topics.length === 0) return 0

  const { data: rows } = await adminClient
    .from('ci_contents')
    .select('id, platform, title, caption, keywords, platform_category, topic_signals')
    .eq('channel_id', channelId).eq('workspace_id', workspaceId)
    // NULL <> 'user'는 참이 아니라 NULL이다 — neq만 쓰면 아직 판정된 적 없는 게시물이 빠진다
    .or('topic_source.is.null,topic_source.neq.user')
    .is('deleted_at', null)
    .limit(2000)

  const targets = (rows ?? []) as any[]
  if (targets.length === 0) return 0

  const updates = targets.map((c) => {
    const verdict = classifyByRules({
      title: c.title,
      caption: c.caption,
      channelTopicId: channel?.topicId ?? null,
      channelTopicConfidence: channel?.topicConfidence ?? null,
      channelIdentity: channel?.identity ?? null,
      signals: {
        platformCategory: c.platform_category ?? null,
        topicSignals: Array.isArray(c.topic_signals) ? c.topic_signals : [],
        keywords: Array.isArray(c.keywords) ? c.keywords : [],
      },
      platform: c.platform,
      topics,
    })
    return { id: c.id as string, patch: buildClassifyUpdate(verdict, verdict.rungs) }
  })

  // 쓰기는 병렬로 흘린다. 순차로 보내면 왕복 지연이 그대로 쌓여 수백 초가 된다.
  const CONCURRENCY = 20
  let written = 0
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const wave = updates.slice(i, i + CONCURRENCY)
    const results = await Promise.all(wave.map((u) =>
      adminClient.from('ci_contents').update(u.patch).eq('id', u.id)
        .then((r: { error: unknown }) => !r.error)
        .catch(() => false)))
    written += results.filter(Boolean).length
  }
  return written
}

/**
 * L1 · 채널 정체성 판정.
 *
 * 채널이 올린 콘텐츠들의 플랫폼 신호를 모아 "이 채널은 무엇인가"를 정하고,
 * 확정되면 그 채널 콘텐츠를 **한꺼번에** 재분류한다.
 *
 * 이것이 "게시물 1만 개를 사람이 검토해?"에 대한 답이다 —
 * 채널 하나를 판정하면 그 채널 콘텐츠 전량이 함께 풀린다.
 */
export async function runChannelIdentity(workspaceId: string, channelId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: ch } = await adminClient
    .from('ci_channels')
    .select('id, platform, display_name, topic_id, topic_source')
    .eq('id', channelId).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle()
  if (!ch) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '채널을 찾을 수 없습니다' }

  const { data: rows } = await adminClient
    .from('ci_contents')
    .select('platform_category, topic_signals, keywords')
    .eq('channel_id', channelId).is('deleted_at', null)
    .limit(500)

  const samples: ChannelSignalSample[] = ((rows ?? []) as any[]).map((r) => ({
    platformCategory: r.platform_category ?? null,
    topicSignals: Array.isArray(r.topic_signals) ? r.topic_signals : [],
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
  }))

  const identity = computeChannelIdentity(ch.platform, samples)
  const verdict = judgeIdentity(identity)
  const confidence = identityConfidence(identity)

  // 사람이 확정한 채널 주제는 건드리지 않는다
  const keepTopic = ch.topic_source === 'user'

  let topicId: string | null = keepTopic ? ch.topic_id : null
  if (!keepTopic && verdict === 'auto') {
    topicId = await matchTopicForIdentity(workspaceId, identity)
  }

  await adminClient.from('ci_channels').update({
    identity: identity as unknown as Record<string, unknown>,
    identity_at: new Date().toISOString(),
    ...(keepTopic ? {} : {
      topic_id: topicId,
      topic_confidence: topicId ? confidence : null,
      topic_source: topicId ? 'auto' : null,
    }),
  }).eq('id', channelId)

  // 소속 콘텐츠를 **항상** 다시 판정한다.
  //
  // 예전엔 `if (topicId)`로 막아 뒀다. 그런데 채널 주제를 못 찾는 경우가 바로
  // **낡은 판정이 남아 있는 경우**다 — 주제 체계가 '요리' 하나뿐이면 음악 채널은 매칭에
  // 실패하고, 그래서 재판정을 건너뛰고, 321건이 계속 '요리'로 남았다(실측).
  // 채널 정체성이 새로 잡혔으면 옳든 그르든 다시 판정해야 화면이 진실을 말한다.
  await reclassifyChannelContents(workspaceId, channelId)

  return { ok: true }
}

/**
 * 채널 정체성에 맞는 기존 주제를 찾는다.
 * 없으면 null — **주제를 자동으로 만들지 않는다.** 주제 체계를 늘리는 것은 사람의 결정이고,
 * 제안은 topic-proposal이 화면에서 한다(사용자가 확인하고 만든다).
 */
async function matchTopicForIdentity(
  workspaceId: string, identity: ChannelIdentity,
): Promise<string | null> {
  const topics = await loadTopics(workspaceId)
  if (topics.length === 0) return null

  const wanted = new Set<string>()
  if (identity.dominantSignal) wanted.add(identity.dominantSignal.toLowerCase())
  for (const s of identity.topSignals) wanted.add(s.label.toLowerCase())

  // 신호 규칙이 맞는 주제를 먼저
  for (const t of topics) {
    if (t.signalPatterns.some((p) => wanted.has(p.trim().toLowerCase()))) return t.id
  }
  // 카테고리 규칙
  if (identity.dominantCategory) {
    for (const t of topics) {
      if (t.categoryPatterns.includes(identity.dominantCategory)) return t.id
    }
  }
  // 주제 이름이 신호 이름과 같으면
  for (const t of topics) {
    if (wanted.has(t.name.trim().toLowerCase())) return t.id
  }
  return null
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
 * 발견 — "왜 이것만 잘됐나"를 대조로 찾는다 (runPatterns 의 후계)
 *
 * runPatterns 와의 차이는 하나다: **보기를 주지 않는다.**
 *   runPatterns 는 규칙 7개를 미리 적어 두고 데이터를 그 7칸에 넣었다(효과 1.2배 = 노이즈).
 *   여기서는 떡상 1건과 같은 채널·같은 포맷·비슷한 시기의 평범 3건을 AI에게 나란히 보여 주고
 *   "이 1건만 가진 것"을 자유 문장으로 쓰게 한다. 그리고 **서로 다른 채널 3곳 이상에서
 *   반복된 것만** 공식으로 올린다.
 *
 * runPatterns 는 그대로 둔다 — 읽는 코드가 아직 있고, 폐기는 그것을 옮긴 뒤에 한다(M-4 추가 전용).
 */
export async function runDiscovery(workspaceId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: topics } = await adminClient.from('ci_topics')
    .select('id').eq('workspace_id', workspaceId).is('deleted_at', null)

  let promotedTotal = 0
  let blocked: string | null = null

  for (const t of (topics ?? []) as { id: string }[]) {
    const { data } = await adminClient.from('ci_contents')
      .select('id, channel_id, title, caption, format, duration_sec, published_at, thumbnail_url, ci_content_derived ( outlier_index, outlier_baseline_n )')
      .eq('workspace_id', workspaceId).eq('topic_id', t.id)
      .eq('source', CORPUS_FILTER.source).eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
      .is('deleted_at', null).limit(1000)

    const samples: DiscoverySample[] = ((data ?? []) as any[]).map((r) => ({
      contentId: r.id,
      channelId: r.channel_id,
      title: r.title,
      caption: r.caption,
      format: r.format,
      durationSec: r.duration_sec,
      publishedAt: r.published_at,
      thumbnailUrl: r.thumbnail_url,
      outlierIndex: r.ci_content_derived?.outlier_index ?? null,
      baselineN: r.ci_content_derived?.outlier_baseline_n ?? 0,
    }))

    const sets = buildContrastSets(samples)
    if (sets.length === 0) continue

    const found = await discoverFromContrasts(sets)
    if (found.blocked) { blocked = found.blocked; continue }

    const { promoted } = promoteDiscoveries(found.clusters, found.findings, found.kinds)

    // 이번 계산에서 살아남지 못한 발견은 보관 처리한다.
    // (patterns 와 같은 순서지만, 아래 insert 가 0건이어도 화면이 "0건"과 "못 돌았다"를
    //  구분할 수 있게 blocked 를 따로 들고 나간다 — 617건이 조용히 사라진 사고의 교훈)
    await adminClient.from('ci_discoveries')
      .update({ is_archived: true })
      .eq('workspace_id', workspaceId).eq('topic_id', t.id)

    for (const d of promoted) {
      const { data: saved } = await adminClient.from('ci_discoveries').insert({
        workspace_id: workspaceId,
        topic_id: t.id,
        statement: d.statement,
        kind: d.kind,
        evidence_count: d.evidenceCount,
        channel_count: d.channelCount,
        is_archived: false,
      }).select('id').single()

      if (!saved?.id) continue
      promotedTotal += 1

      const obsOf = new Map<string, string>()
      for (const f of found.findings) if (f.observation) obsOf.set(f.contentId, f.observation)

      await adminClient.from('ci_discovery_evidence').insert(
        d.contentIds.slice(0, 200).map((cid) => ({
          discovery_id: saved.id,
          content_id: cid,
          observation: obsOf.get(cid) ?? null,
        })),
      )
    }
  }

  // 못 돈 이유가 있으면 실패로 올린다 — 0건으로 위장하지 않는다
  if (promotedTotal === 0 && blocked) {
    return { ok: false, errorCode: 'AI_UNAVAILABLE', errorMessage: blocked }
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
    .select('id, platform, external_id, handle, profile_url, collect_window')
    .eq('id', channelId).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle()
  if (!ch) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '채널을 찾을 수 없습니다' }

  // 게시물을 훑는 김에 채널 자체의 정보도 채운다. 게시물만 모으고 채널을 모르면
  // "이 채널은 뭐 하는 곳인가"에 답할 수 없다. 실패해도 게시물 수집은 계속한다.
  await enrichChannelMeta(channelId).catch(() => null)

  // 전체 업로드를 먼저 시도한다. RSS는 최근 15개만 주므로 543개 채널을 15개로 판단하게 된다.
  // 키가 없어 전체를 못 받으면 RSS로 내려가되, **몇 개 중 몇 개인지 화면에 남긴다.**
  const meta = await getGeminiMeta()
  const realChannelId = isProvisionalKey(ch.external_id) ? null : ch.external_id
  // 개수가 아니라 기간으로 끊는다 — 사용자가 이해할 수 있는 기준이고, 쿼터도 그만큼만 쓴다
  const win = (ch.collect_window ?? '1y') as CollectWindowId
  const sinceIso = windowSince(win, Date.now())
  const full = ch.platform === 'youtube' && realChannelId
    ? await fetchAllUploads(realChannelId, meta.youtubeApiKey, { sinceIso }).catch(() => null)
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
    // 채널 국가는 공식 API만이 아는 값이다. 얻었을 때만 채운다.
    ...(full?.ok && full.country ? { country: full.country } : {}),
    // 수집 범위의 한계는 오류가 아니지만 숨기면 안 된다. 같은 자리에 남겨 화면이 말하게 한다.
    sweep_error: coverageNote,
  }).eq('id', channelId)

  // 게시물을 모았으면 채널이 무엇인지 다시 판정한다(L1).
  //
  // 왜 잡으로 미루나: 콘텐츠 수집(ingest)이 끝나야 신호가 찬다. 여기서 바로 집계하면
  // 방금 만든 행들이 아직 title뿐이라 "신호 없음"으로 판정된다.
  //
  // 왜 stage='classify'인가: 채널을 분류하는 일이라 의미가 맞고, policy.nextStage가
  // 채널 대상 잡의 체인을 이미 끊어 준다(콘텐츠 전용 단계로 흘러가지 않는다).
  // 잡 단계 enum에 값을 새로 추가하면 되돌릴 수 없어(PostgreSQL은 enum 값 제거 불가)
  // 있는 단계를 쓰는 쪽을 골랐다.
  await enqueueJob({
    workspaceId, stage: 'classify', targetType: 'channel', targetId: channelId,
    version: Date.now(),
  }).catch(() => null)

  const winLabel = COLLECT_WINDOWS.find((w) => w.id === win)?.label ?? '최근 1년'
  const scope = full?.ok
    ? `${winLabel} ${feed.entries.length}건 확인`
    : `최근 ${feed.entries.length}건만 확인(RSS 한계 — ${winLabel} 전체를 보려면 YouTube API 키 필요)`
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
// 판정 기준은 순수 분석 모듈이 갖는다. 기존 호출부를 위해 여기서 다시 내보낸다.
export { CREATIVE_MIN_INDEX } from '../analysis/outlier.ts'
import { CREATIVE_MIN_INDEX } from '../analysis/outlier.ts'
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

/* ───────────────────── 영상 실체 이해 ───────────────────── */

interface MediaAttemptRow {
  content_id?: string
  attempt_count: number | null
  transcript: string | null
  topic_guess: string | null
  on_screen_text: string[] | null
}

/**
 * 저장된 행을 "다시 읽을 것인가" 판단 입력으로 바꾼다. **한 곳에서만** 만든다 —
 * 단건 경로와 백로그가 다르게 판정하면 같은 게시물이 경로에 따라 다르게 처리된다.
 */
function toAnalyzedRecord(row: MediaAttemptRow): AnalyzedRecord {
  return {
    hasEvidence: Boolean(
      row.transcript || row.topic_guess || (row.on_screen_text?.length ?? 0) > 0,
    ),
    attempts: row.attempt_count ?? 1,
  }
}

/**
 * 밀린 영상을 읽는다.
 *
 * 왜 백로그가 따로 있나: 파이프라인은 새로 들어온 것만 지나간다.
 * 이 기능이 생기기 전에 수집된 것(실측 503건)은 파이프라인을 다시 타지 않으므로
 * 영원히 안 읽힌다 — 사용자 눈에는 "새 것만 되고 옛 것은 안 되는" 상태가 된다.
 * 적재가 돌 때마다 밀린 것을 함께 훑어 스스로 메운다(크리에이티브 분석과 같은 구조).
 *
 * 순서는 **숏폼 먼저, 최신 먼저**다. 숏폼이 증거가 굶은 쪽이고,
 * 사용자가 지금 보는 화면이 최신이라 거기서 먼저 달라져야 "됐다"고 느낀다.
 */
export async function runMediaBacklog(workspaceId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: rows } = await adminClient
    .from('ci_contents')
    .select('id, format, caption, duration_sec')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .in('format', ['short', 'long', 'live'])
    .order('format', { ascending: true })        // 'live' < 'long' < 'short'가 아니므로 아래에서 다시 정렬한다
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(300)

  const candidates = (rows ?? []) as {
    id: string; format: string; caption: string | null; duration_sec: number | null
  }[]
  if (candidates.length === 0) return { ok: true }

  const { data: done } = await adminClient
    .from('ci_content_media')
    .select('content_id, attempt_count, transcript, topic_guess, on_screen_text')
    .in('content_id', candidates.map((c) => c.id))
  const analyzed = new Map<string, AnalyzedRecord>(
    ((done ?? []) as MediaAttemptRow[]).map((r) => [r.content_id as string, toAnalyzedRecord(r)]),
  )

  // 배수는 있으면 쓰고 없으면 없는 대로 판단한다 — 배수를 기다리면 숏폼이 영원히 대기한다.
  const { data: derived } = await adminClient
    .from('ci_content_derived')
    .select('content_id, outlier_index')
    .in('content_id', candidates.map((c) => c.id))
  const indexOf = new Map<string, number | null>(
    ((derived ?? []) as { content_id: string; outlier_index: number | null }[])
      .map((r) => [r.content_id, r.outlier_index]),
  )

  const pending = candidates
    .filter((c) => shouldUnderstand({
      format: c.format as never,
      captionLength: (c.caption ?? '').trim().length,
      durationSec: c.duration_sec,
      outlierIndex: indexOf.get(c.id) ?? null,
      analyzed: analyzed.get(c.id) ?? null,
    }).should)
    // 숏폼을 앞으로. 굶은 쪽부터 먹인다.
    .sort((a, b) => (a.format === 'short' ? 0 : 1) - (b.format === 'short' ? 0 : 1))
    .slice(0, MEDIA_MAX_PER_PASS)

  if (pending.length === 0) return { ok: true }

  let analyzed_ok = 0
  let failed = 0
  let stoppedBy: string | null = null

  for (const c of pending) {
    const r = await understandMedia(c.id)
    if (r.ok) { analyzed_ok += 1; continue }
    // 우리 쪽 문제면 이 회차를 멈춘다 — 다음 건도 같은 이유로 실패한다.
    // 계속 두드리면 실패만 쌓이고, 사용자는 "왜 다 실패했지"를 보게 된다.
    if (r.serviceFailure) { stoppedBy = r.note ?? '일시적인 문제로 중단'; break }
    failed += 1
  }

  return {
    ok: true,
    errorMessage: stoppedBy
      ? `영상 ${analyzed_ok}건 분석 후 중단 — ${stoppedBy.slice(0, 120)}`
      : `영상 ${analyzed_ok}건 분석${failed ? ` · ${failed}건 실패` : ''}`,
  }
}

/**
 * 게시물 하나의 영상을 읽는다 — 파이프라인 enrich 단계가 부른다.
 * 읽을 가치가 없으면 이유를 남기고 통과시킨다. 조용히 건너뛰면 고장과 구분되지 않는다.
 */
export async function runMediaUnderstanding(contentId: string): Promise<StageResult> {
  const adminClient = createAdminClient() as any

  const { data: content } = await adminClient
    .from('ci_contents')
    .select('id, format, caption, duration_sec')
    .eq('id', contentId).maybeSingle()
  if (!content) return { ok: true }

  // 행이 있다고 읽은 것이 아니다 — 실패해도 행은 남는다(왜 못 읽었는지를 화면이 말해야 하므로).
  // 그 둘을 같게 보면 쿼터 초과 한 번에 영구히 포기한다(실측 32건).
  const { data: existing } = await adminClient
    .from('ci_content_media')
    .select('attempt_count, transcript, topic_guess, on_screen_text')
    .eq('content_id', contentId).maybeSingle()

  const decision = shouldUnderstand({
    format: content.format,
    captionLength: (content.caption ?? '').trim().length,
    durationSec: content.duration_sec ?? null,
    outlierIndex: null,     // 적재 직후에는 배수가 아직 없다. 그래서 숏폼 규칙이 중요하다.
    analyzed: existing ? toAnalyzedRecord(existing) : null,
  })
  if (!decision.should) {
    // 왜 안 읽는지를 화면이 말할 수 있게 남긴다. 잡 이력에만 적으면 사용자는 못 본다.
    // "이미 읽었습니다"는 남길 것이 없다 — 이미 결과가 있다.
    if (!existing) await recordSkip(contentId, decision.reason)
    return { ok: true, errorMessage: decision.reason }
  }

  const r = await understandMedia(contentId)
  return { ok: true, errorMessage: r.note ?? decision.reason }
}
