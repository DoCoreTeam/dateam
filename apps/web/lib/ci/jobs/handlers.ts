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
import {
  runClassify, runVerify, runPatterns, runDiscovery, runChannelSweep, runCreativeBacklog,
  enrichChannelMetaBacklog, runChannelIdentity,
  runMediaUnderstanding, runMediaBacklog,
} from './stages.ts'
import { enrichContextBacklog } from '../analysis/context-enrich.ts'
import { runSignalSweep } from '../ai/signals-server.ts'
import { runAlertBacklog } from '../alerts/evaluate.ts'
import { scheduleSnapshot, type SnapshotPreset } from './snapshot.ts'
import { resolveSettings, getResolved, type SettingRow } from '../settings/resolve.ts'
import { enqueueJob, type ClaimedJob } from './queue.ts'
import { nextStage, chainVersionFromKey } from './policy.ts'
import { buildChannelKey, isProvisionalKey } from '../ucm/channel-key.ts'
import { resolveExistingChannel } from '../queries/channel-resolve.ts'
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

  // 완전도는 **이 경로가 줄 수 있는 것** 기준으로 센다.
  // 못 주는 값을 결손으로 세면 모든 콘텐츠가 영원히 '일부만 수집됨'이 된다.
  const completeness = completenessFor(
    content.platform as CiPlatform, ucm.provenance.missingFields, ucm.provenance.method,
  )
  const channelId = await upsertChannel(content.workspace_id, ucm)

  await adminClient.from('ci_contents').update({
    channel_id: channelId,
    format: ucm.format,
    title: ucm.title,
    caption: ucm.caption,
    keywords: ucm.keywords ?? [],
    // 주제 판정의 1차 증거(L0). 커넥터가 못 주면 빈 값 그대로 둔다 —
    // 없는 신호를 추측으로 채우면 분류가 그 추측 위에 쌓인다.
    platform_category: ucm.platformCategory ?? null,
    topic_signals: ucm.topicSignals ?? [],
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

  // 다음 촬영을 예약한다. 온보딩이 "첫 자동 업데이트를 예약한다"고 약속한 것이 이것이고,
  // 예약이 없으면 지표는 수집 시점 한 장으로 굳어 속도(velocity)가 영원히 null이 된다.
  await scheduleSnapshot({
    workspaceId: content.workspace_id,
    contentId,
    preset: await loadSnapshotPreset(content.workspace_id),
    publishedAt: ucm.publishedAt ?? null,
    firstSeenAt: ucm.provenance.fetchedAt,
  })

  // 게시물 링크 하나로 그 **계정 전체**를 훑는다(설계 불변식 I-1).
  //
  // 왜 여기인가: 링크만 봐서는 채널을 모른다. 수집이 끝나야 채널 id가 생긴다.
  // 왜 하는가: "잘 됨"은 그 계정의 평소 대비로만 정의된다. 형제가 없으면 비교군이 비어
  // 배수가 영원히 안 나오고(최소 8건), 배수가 없으면 "왜 잘됐나"도 발화하지 않는다(1.5배 기준).
  // 즉 이 한 줄이 없으면 링크 1건은 **아무것도 알려주지 못한다.**
  if (channelId && job.payload?.sweepChannel) {
    await maybeSweepChannel(content.workspace_id, channelId)
  }

  return { ok: true }
}

/** 계정 훑기를 걸어도 되는 간격. 링크를 여러 개 붙여넣어도 같은 채널을 반복해 훑지 않는다. */
export const CHANNEL_SWEEP_COOLDOWN_MS = 6 * 60 * 60 * 1000

/**
 * 이 채널을 아직 안 훑었거나 오래됐으면 훑기를 건다.
 *
 * 쿨다운이 필요한 이유: 같은 채널 게시물 10개를 한꺼번에 붙여넣으면 훑기 잡이 10개 걸린다.
 * 멱등키가 버전으로 갈리므로 dedup도 안 된다 — 외부 API 쿼터를 10배로 태운다.
 */
async function maybeSweepChannel(workspaceId: string, channelId: string): Promise<void> {
  const adminClient = createAdminClient() as any
  const { data: ch } = await adminClient
    .from('ci_channels')
    .select('id, last_sweep_at')
    .eq('id', channelId)
    .maybeSingle()
  if (!ch) return

  const lastAt = ch.last_sweep_at ? Date.parse(ch.last_sweep_at) : 0
  if (Number.isFinite(lastAt) && Date.now() - lastAt < CHANNEL_SWEEP_COOLDOWN_MS) return

  // 훑기 직전에 시각을 찍는다 — 같은 배치의 형제 콘텐츠들이 동시에 여기 도달해도 한 번만 건다.
  await adminClient.from('ci_channels')
    .update({ last_sweep_at: new Date().toISOString() })
    .eq('id', channelId)

  await enqueueJob({
    workspaceId, stage: 'ingest', targetType: 'channel', targetId: channelId, version: Date.now(),
  })
}

/** 워크스페이스의 스냅샷 정밀도. 못 읽으면 가장 싼 쪽으로 — 비용은 조용히 늘어나면 안 된다. */
async function loadSnapshotPreset(workspaceId: string): Promise<SnapshotPreset> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_settings').select('scope, scope_id, key, value, is_encrypted, version')
      .eq('key', 'snapshot.preset')
    const resolved = resolveSettings((data ?? []) as SettingRow[], { userId: null, workspaceId })
    const v = getResolved<SnapshotPreset>(resolved, 'snapshot.preset')
    return v === 'standard' || v === 'precise' ? v : 'economy'
  } catch {
    return 'economy'
  }
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

  // "이미 있나"와 "임시키 승격"은 SSOT가 한다(queries/channel-resolve).
  // 예전에는 이 판정이 여기와 addChannel 두 곳에 따로 있었고, 한쪽만 승격을 봐서
  // 사용자가 같은 채널을 다시 넣으면 행이 갈라졌다.
  const existing = await resolveExistingChannel(adminClient, workspaceId, {
    platform: ch.platform,
    externalId: ch.externalId,
    handle: ch.handle,
    profileUrl: ch.profileUrl,
    displayName: ch.displayName,
  })

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
    // 링크를 넣었다는 것은 "이 채널을 보겠다"는 뜻이다(사용자 지시 2026-08-18).
    // 예전엔 꺼진 채로 만들어서, 링크를 넣어도 그 채널의 새 게시물이 영원히 안 들어왔다 —
    // 사용자가 모니터링 화면에서 한 번 더 켜야 한다는 사실을 화면 어디에서도 알리지 않았다.
    // 끄는 것은 모니터링 화면에서 언제든 되돌릴 수 있다.
    is_monitored: true,
    monitored_since: new Date().toISOString(),
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
    // 이 기능이 생기기 전에 수집된 것은 enrich를 지나간 적이 없다.
    // 재훑기가 없으면 "새 것만 되고 옛 것은 안 되는" 상태로 굳는다.
    await runMediaBacklog(job.workspace_id)
    // 콘텐츠 수집이 만든 채널은 이름과 URL뿐이다. 정보를 못 채운 채널을 함께 메운다.
    await enrichChannelMetaBacklog(job.workspace_id)
    // "언제의 트렌드인가" — 계절·요일·시간대·지역·날씨를 채운다
    await enrichContextBacklog(job.workspace_id)
    // 파생값이 바뀌면 성공 공식도 다시 봐야 한다. 낡은 공식이 화면에 남지 않게.
    await runPatterns(job.workspace_id)
    await runDiscovery(job.workspace_id)
    // 떡상 알림도 배수에 딸린 파생 처리라 같은 함정을 갖는다 — 단건이 아니라 재훑기다.
    await runAlertBacklog(job.workspace_id)
  }
  return { ok: true }
}

/** 정규화는 수집 단계에서 UCM으로 이미 끝난다. 이력만 남기고 통과한다. */
async function handlePassthrough(): Promise<HandlerResult> {
  return { ok: true }
}

/**
 * 보강 — **영상 실체를 읽는다.**
 *
 * 이 단계는 설계서가 자리만 잡아두고 오래 비어 있었다(handlePassthrough).
 * 그 결과 분류(classify)가 보는 증거는 언제나 '플랫폼이 준 것'뿐이었고,
 * 플랫폼이 아무것도 안 주는 숏폼에서는 볼 것이 없어 굶었다.
 * (실측: 숏폼 423건 중 227건 설명문 없음 · 키워드 전 건 0개 →
 *  화면이 "설명문을 확보하지 못했습니다"라고만 말했다)
 *
 * 순서가 핵심이다 — enrich는 classify **앞**에 있다.
 * 그래서 여기서 읽은 대사·자막이 곧바로 주제 판정의 증거가 된다.
 */
async function handleEnrich(job: ClaimedJob): Promise<HandlerResult> {
  // 채널 잡에는 읽을 영상이 없다. 통과시킨다.
  if (job.target_type !== 'content' || !job.target_id) return { ok: true }
  return runMediaUnderstanding(job.target_id)
}

async function handleClassify(job: ClaimedJob): Promise<HandlerResult> {
  if (!job.workspace_id || !job.target_id) return { ok: true }
  // 대상이 채널이면 채널 정체성(L1)을 판정한다 — 그리고 그 결과가 소속 콘텐츠로 상속된다.
  // 채널 하나를 판정하면 콘텐츠 수백 건이 함께 풀리는 것이 이 설계의 요점이다.
  if (job.target_type === 'channel') {
    return runChannelIdentity(job.workspace_id, job.target_id)
  }
  return runClassify(job.workspace_id, job.target_id)
}

async function handleVerify(job: ClaimedJob): Promise<HandlerResult> {
  if (!job.workspace_id || !job.target_id) return { ok: true }
  return runVerify(job.workspace_id, job.target_id)
}

/**
 * 이슈 자동 수집 — 바깥 웹을 훑어 «지금 무엇이 화제인가»를 후보로 담는다.
 *
 * 대상이 워크스페이스라 콘텐츠 체인을 타지 않는다(policy.nextStage 가 null 을 준다).
 * 실패해도 다른 잡을 막지 않는다 — 재시도·백오프는 큐가 알아서 한다.
 */
async function handleSignals(job: ClaimedJob): Promise<HandlerResult> {
  if (!job.workspace_id) return { ok: true }
  const r = await runSignalSweep(job.workspace_id)
  return r.ok
    ? { ok: true }
    : { ok: false, errorCode: r.errorCode ?? 'INTERNAL', errorMessage: r.errorMessage ?? r.note }
}

const HANDLERS = {
  ingest: handleIngest,
  normalize: handlePassthrough,
  enrich: handleEnrich,
  classify: handleClassify,
  verify: handleVerify,
  project: handleProject,
  signals: handleSignals,
} as const

export async function runJob(job: ClaimedJob): Promise<HandlerResult> {
  const handler = HANDLERS[job.stage]
  if (!handler) return { ok: false, errorCode: 'INTERNAL', errorMessage: `알 수 없는 단계: ${job.stage}` }

  const result = await handler(job)

  // 성공하면 다음 단계를 건다. 체인이 끊기면 파이프라인이 조용히 멈춘다.
  // 대상 종류를 함께 넘긴다 — 채널 잡에 콘텐츠 전용 단계를 걸면 반드시 죽는다(policy.nextStage).
  if (result.ok && job.target_id) {
    const next = nextStage(job.stage, job.target_type)
    if (next) {
      await enqueueJob({
        workspaceId: job.workspace_id,
        stage: next,
        targetType: job.target_type,
        targetId: job.target_id,
        payload: job.payload,
        // 이 잡의 버전을 그대로 물려준다.
        // 멱등키가 전역 유니크라 버전을 안 넘기면 재수집 2회차부터 normalize~project가
        // 통째로 dedup에 걸려 사라진다 — 수집은 되는데 파생값이 안 도는 조용한 실패.
        version: chainVersionFromKey(job.idempotency_key),
      })
    }
  }

  return result
}
