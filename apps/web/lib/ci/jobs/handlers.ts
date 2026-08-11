// lib/ci/jobs/handlers.ts — 잡 단계별 실행기 (설계서 §11.2)
// ingest → normalize → enrich → classify → verify → project
//
// Slice 1 범위: ingest(수집)와 project(파생값 계산)를 실동작시킨다.
// 나머지 단계는 통과 처리하되 잡 이력은 남긴다 — 단계를 지운 것이 아니라 아직 비어 있는 것이다.

import { createAdminClient } from '@/lib/supabase/server'
import { getConnector } from '../connectors/registry.ts'
import { ConnectorError, type UcmContent } from '../connectors/types.ts'
import { completenessFor } from '../connectors/meta-tags.ts'
import { getGeminiMeta } from '../ai/meta.ts'
import { computeDerived, recomputeChannelDerived } from '../analysis/derive.ts'
import { runClassify, runVerify, runPatterns, runChannelSweep, runCreativeBacklog } from './stages.ts'
import { enqueueJob, type ClaimedJob } from './queue.ts'
import { nextStage } from './policy.ts'
import { buildChannelKey, isProvisionalKey } from '../ucm/channel-key.ts'
import type { CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface HandlerResult {
  ok: boolean
  errorCode?: string
  errorMessage?: string
}

/**
 * 수집. 커넥터 체인을 돌려 UCM으로 정규화하고 ci_contents를 갱신한다.
 * 일부만 확보해도 저장한다 — 완전도와 미확보 항목을 함께 남겨 화면이 정직하게 말하게 한다.
 */
async function handleIngest(job: ClaimedJob): Promise<HandlerResult> {
  // 채널이 대상이면 그 채널의 게시물을 일괄로 끌어온다.
  // 채널을 알면 콘텐츠를 모으는 것이 이 제품의 출발점이다.
  if (job.target_type === 'channel' && job.workspace_id && job.target_id) {
    return runChannelSweep(job.workspace_id, job.target_id)
  }

  const adminClient = createAdminClient() as any
  const contentId = job.target_id
  if (!contentId) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '대상 콘텐츠가 없습니다' }

  const { data: content } = await adminClient
    .from('ci_contents')
    .select('id, workspace_id, platform, external_id, canonical_url')
    .eq('id', contentId)
    .maybeSingle()

  if (!content) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '콘텐츠를 찾을 수 없습니다' }

  const connector = getConnector(content.platform as CiPlatform)

  await adminClient.from('ci_contents').update({ ingest_status: 'running' }).eq('id', contentId)

  const meta = await getGeminiMeta()
  let ucm: UcmContent
  try {
    ucm = await connector.fetchContent(content.external_id, content.canonical_url, {
      apiKey: meta.youtubeApiKey,
      onQuotaSpend: () => { /* 쿼터 회계는 job_runs에 기록된다 */ },
    })
  } catch (e) {
    const failure = e instanceof ConnectorError
      ? { code: e.code, message: e.message, attempted: e.attempted }
      : { code: 'CONNECTOR_FAILED', message: '수집에 실패했습니다', attempted: [] }

    await adminClient.from('ci_contents').update({
      ingest_status: 'failed',
      provenance: { error: failure.code, attempted: failure.attempted },
    }).eq('id', contentId)

    return { ok: false, errorCode: failure.code, errorMessage: failure.message }
  }

  const completeness = completenessFor(content.platform as CiPlatform, ucm.provenance.missingFields)
  const channelId = await upsertChannel(content.workspace_id, ucm)

  await adminClient.from('ci_contents').update({
    channel_id: channelId,
    format: ucm.format,
    title: ucm.title,
    caption: ucm.caption,
    published_at: ucm.publishedAt,
    duration_sec: ucm.durationSec,
    language: ucm.language,
    thumbnail_url: ucm.thumbnailUrl,
    comparability_class: ucm.comparability,
    completeness,
    missing_fields: ucm.provenance.missingFields,
    ingest_status: completeness >= 1 ? 'done' : 'partial',
    provenance: ucm.provenance as unknown as Record<string, unknown>,
    last_refreshed_at: ucm.provenance.fetchedAt,
  }).eq('id', contentId)

  // 지표 스냅샷은 append-only. 같은 시각 재수집은 무시된다.
  if (ucm.metrics.views != null || ucm.metrics.likes != null) {
    await adminClient.from('ci_content_metrics').insert({
      content_id: contentId,
      captured_at: ucm.metrics.capturedAt,
      views: ucm.metrics.views,
      likes: ucm.metrics.likes,
      comments: ucm.metrics.comments,
      shares: ucm.metrics.shares,
      saves: ucm.metrics.saves,
      source_method: ucm.provenance.method,
    })
  }

  return { ok: true }
}

/**
 * 콘텐츠가 속한 채널을 확보한다.
 *
 * 콘텐츠는 반드시 채널에 귀속되어야 한다 — 배수는 "같은 채널·같은 포맷"을 비교군으로 쓰므로,
 * 채널이 없으면 비교군이 영원히 비고 배수가 나오지 않는다.
 * 플랫폼이 채널 ID를 안 주면 핸들·프로필 URL·표시 이름 순으로 키를 만들어서라도 채널을 만든다.
 */
async function upsertChannel(workspaceId: string, ucm: UcmContent): Promise<string | null> {
  const ch = ucm.channel
  if (!ch) return null

  const key = buildChannelKey({
    platform: ch.platform,
    externalId: ch.externalId,
    handle: ch.handle,
    profileUrl: ch.profileUrl,
    displayName: ch.displayName,
  })
  if (!key) return null

  const adminClient = createAdminClient() as any

  const { data: existing } = await adminClient
    .from('ci_channels')
    .select('id, external_id, display_name, subscriber_count')
    .eq('workspace_id', workspaceId)
    .eq('platform', ch.platform)
    .eq('external_id', key.externalId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing?.id) {
    // 나중에 더 나은 정보를 얻으면 채운다. 이미 있는 값을 빈 값으로 덮지 않는다.
    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
    if (ch.displayName && (!existing.display_name || isProvisionalKey(existing.external_id))) {
      patch.display_name = ch.displayName
    }
    if (ch.subscriberCount != null && existing.subscriber_count == null) {
      patch.subscriber_count = ch.subscriberCount
      patch.subscriber_provenance = 'platform'
    }
    await adminClient.from('ci_channels').update(patch).eq('id', existing.id)
    return existing.id
  }

  const { data: created } = await adminClient.from('ci_channels').insert({
    workspace_id: workspaceId,
    platform: ch.platform,
    external_id: key.externalId,
    handle: ch.handle,
    display_name: ch.displayName ?? ch.handle ?? '이름 미확인',
    profile_url: ch.profileUrl,
    avatar_url: ch.avatarUrl,
    subscriber_count: ch.subscriberCount,
    subscriber_provenance: ch.subscriberCount != null ? 'platform' : null,
    ownership: 'tracked',
    // 수집으로 자동 생성된 채널을 몰래 과금(모니터링) 대상으로 만들지 않는다.
    // 사용자가 모니터링에서 직접 켜야 지켜보기가 시작된다.
    is_monitored: false,
    last_seen_at: new Date().toISOString(),
  }).select('id').single()

  return created?.id ?? null
}

/** 파생값 계산 — 배수·백분위·신뢰도를 채운다. */
async function handleProject(job: ClaimedJob): Promise<HandlerResult> {
  const contentId = job.target_id
  if (!contentId) return { ok: false, errorCode: 'NOT_FOUND', errorMessage: '대상이 없습니다' }
  await computeDerived(contentId)

  // 배수는 채널 중앙값 대비라, 한 건이 들어오면 그 채널 전체가 다시 계산되어야 한다.
  const adminClient = createAdminClient() as any
  const { data: own } = await adminClient
    .from('ci_contents').select('channel_id').eq('id', contentId).maybeSingle()
  if (own?.channel_id) await recomputeChannelDerived(own.channel_id)

  if (job.workspace_id) {
    // 배수가 나온 뒤에야 "왜 터졌나"를 볼 수 있다. 순서가 중요하다.
    // 이번 건만이 아니라 형제 재계산으로 이제 막 자격을 얻은 것들까지 함께 훑는다.
    await runCreativeBacklog(job.workspace_id)
    // 파생값이 바뀌면 성공 공식도 다시 봐야 한다. 낡은 공식이 화면에 남지 않게.
    await runPatterns(job.workspace_id)
  }
  return { ok: true }
}

/** 정규화·보강은 수집 단계에서 UCM으로 이미 끝난다. 이력만 남기고 통과한다. */
async function handlePassthrough(): Promise<HandlerResult> {
  return { ok: true }
}

async function handleClassify(job: ClaimedJob): Promise<HandlerResult> {
  if (!job.workspace_id || !job.target_id) return { ok: true }
  return runClassify(job.workspace_id, job.target_id)
}

async function handleVerify(job: ClaimedJob): Promise<HandlerResult> {
  if (!job.workspace_id || !job.target_id) return { ok: true }
  return runVerify(job.workspace_id, job.target_id)
}

const HANDLERS = {
  ingest: handleIngest,
  normalize: handlePassthrough,
  enrich: handlePassthrough,
  classify: handleClassify,
  verify: handleVerify,
  project: handleProject,
} as const

export async function runJob(job: ClaimedJob): Promise<HandlerResult> {
  const handler = HANDLERS[job.stage]
  if (!handler) return { ok: false, errorCode: 'INTERNAL', errorMessage: `알 수 없는 단계: ${job.stage}` }

  const result = await handler(job)

  // 성공하면 다음 단계를 건다. 체인이 끊기면 파이프라인이 조용히 멈춘다.
  if (result.ok && job.target_id) {
    const next = nextStage(job.stage)
    if (next) {
      await enqueueJob({
        workspaceId: job.workspace_id,
        stage: next,
        targetType: job.target_type,
        targetId: job.target_id,
        payload: job.payload,
      })
    }
  }

  return result
}
