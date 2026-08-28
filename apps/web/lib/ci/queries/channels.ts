// lib/ci/queries/channels.ts — 채널 조회·생성 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import { parseChannelUrl } from '../ucm/url.ts'
import { resolveExistingChannel } from './channel-resolve.ts'
import { enqueueJob } from '../jobs/queue.ts'
import { describeIdentity } from '../analysis/channel-identity.ts'
import type { ChannelIdentity } from '../analysis/channel-identity.ts'
import type { CiChannelListItem } from '../contracts.ts'
import type { CiChannelOwnership, CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 채널 조회에서 항상 같은 칸을 읽는다 — 목록과 상세가 다른 칸을 읽으면 화면마다 다른 말을 한다 */
const CHANNEL_COLUMNS =
  // ⚠️ ci_topics 는 **반드시 FK 이름을 붙여** 임베드한다.
  //
  // ci_channels → ci_topics 로 가는 FK 가 둘이다(topic_id · content_topic_id — 마이그 226).
  // 이름을 안 붙이면 PostgREST 가 어느 쪽인지 몰라 **쿼리 전체가 PGRST201 로 죽는다.**
  // 그런데 아래 조회들이 error 를 검사하지 않던 시절에는 그것이 «채널 0곳»으로 보였고,
  // 화면은 채널 8곳이 멀쩡히 있는데도 「아직 등록한 관심 채널이 없습니다」라고 말했다
  // (실측 2026-08-28 — 모니터링 화면이 통째로 비어 있었다).
  'id, platform, display_name, handle, avatar_url, subscriber_count, is_monitored, ownership, size_band, last_seen_at, description, video_count, profile_url, subscriber_provenance, meta_fetched_at, meta_error, collect_window, topic_confidence, topic_source, identity, ci_topics!ci_channels_topic_id_fkey ( id, name )'

interface Row {
  id: string
  platform: CiPlatform
  display_name: string
  handle: string | null
  avatar_url: string | null
  subscriber_count: number | null
  is_monitored: boolean
  ownership: CiChannelOwnership
  size_band: string | null
  last_seen_at: string | null
  description: string | null
  video_count: number | null
  profile_url: string | null
  subscriber_provenance: 'platform' | 'web_verified' | 'estimated' | null
  meta_fetched_at: string | null
  meta_error: string | null
  collect_window: string | null
  topic_confidence: number | null
  topic_source: 'auto' | 'ai_verified' | 'user' | null
  identity: Partial<ChannelIdentity> | null
  ci_topics: { id: string; name: string } | null
}

/** identity jsonb는 `{}`(기본값)로 시작한다 — 판정 전이면 문장을 만들지 않는다 */
function identityOf(raw: Partial<ChannelIdentity> | null): ChannelIdentity | null {
  if (!raw || typeof raw !== 'object' || typeof raw.sampleSize !== 'number') return null
  return {
    dominantCategory: raw.dominantCategory ?? null,
    dominantCategoryLabel: raw.dominantCategoryLabel ?? null,
    categoryAgreement: raw.categoryAgreement ?? 0,
    topSignals: raw.topSignals ?? [],
    dominantSignal: raw.dominantSignal ?? null,
    keywordProfile: raw.keywordProfile ?? [],
    sampleSize: raw.sampleSize,
    unknownCount: raw.unknownCount ?? 0,
  }
}

function toItem(r: Row): CiChannelListItem {
  const identity = identityOf(r.identity)
  return {
    id: r.id,
    platform: r.platform,
    displayName: r.display_name,
    handle: r.handle,
    avatarUrl: r.avatar_url,
    subscriberCount: r.subscriber_count,
    isMonitored: r.is_monitored,
    ownership: r.ownership,
    sizeBand: r.size_band,
    topic: r.ci_topics ? { id: r.ci_topics.id, name: r.ci_topics.name } : null,
    lastSeenAt: r.last_seen_at,
    description: r.description,
    videoCount: r.video_count,
    profileUrl: r.profile_url,
    subscriberProvenance: r.subscriber_provenance,
    metaFetchedAt: r.meta_fetched_at,
    metaError: r.meta_error,
    collectWindow: r.collect_window ?? '1y',
    topicConfidence: r.topic_confidence,
    topicSource: r.topic_source,
    identityText: identity ? describeIdentity(identity) : null,
    identityAgreement: identity ? identity.categoryAgreement : null,
    identitySampleSize: identity ? identity.sampleSize : null,
  }
}

export async function listChannels(
  workspaceId: string,
  ownership?: CiChannelOwnership,
): Promise<CiChannelListItem[]> {
  const adminClient = createAdminClient() as any
  let q = adminClient
    .from('ci_channels')
    .select(CHANNEL_COLUMNS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('is_monitored', { ascending: false })
    .order('display_name', { ascending: true })

  if (ownership) q = q.eq('ownership', ownership)

  // supabase-js 는 실패를 던지지 않고 돌려준다. 검사하지 않으면 `data`가 null 이고
  // `?? []` 가 그것을 빈 목록으로 바꿔 화면이 「아직 등록한 관심 채널이 없습니다」라고 말한다.
  // 채널 8곳이 멀쩡히 있는데 그렇게 보였다(실측 2026-08-28 · PGRST201).
  // 조회가 실패한 것과 정말 0곳인 것은 다른 사실이므로 여기서 갈라 준다.
  const { data, error } = await q
  if (error) {
    console.error('[ci/channels] 목록 조회 실패', { workspaceId, ownership, error })
    throw new Error('채널을 불러오지 못했습니다')
  }
  return ((data ?? []) as Row[]).map(toItem)
}

export async function getChannel(
  workspaceId: string,
  channelId: string,
): Promise<CiChannelListItem | null> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_channels')
    .select(CHANNEL_COLUMNS)
    .eq('workspace_id', workspaceId).eq('id', channelId).is('deleted_at', null)
    .maybeSingle()
  return data ? toItem(data as Row) : null
}

export type AddChannelResult =
  | { ok: true; item: CiChannelListItem; created: boolean }
  | { ok: false; code: 'INVALID_URL' | 'PLAN_LIMIT_EXCEEDED'; message: string; limit?: number; current?: number }

/** 구독이 아예 없는 워크스페이스에 적용하는 한도. 플랜 시드(마이그 190)의 무료 체험과 같은 값이다. */
const NO_SUBSCRIPTION_CHANNEL_LIMIT = 3

/**
 * 플랜 한도 조회.
 *
 * **`tracked_channels`가 null이면 한도가 없다는 뜻이다.**
 * 예전에는 값이 없으면 무조건 3으로 떨어졌다. 그래서 한도를 두지 않으려 해도 둘 수가 없었고,
 * 사용자가 설정한 적 없는 "채널 3곳" 벽이 화면에 떴다(실측 2026-08-18: 4번째 채널 등록 거부).
 * 무제한을 표현할 방법이 없는 것이 문제였지, 값이 3인 것이 문제가 아니었다.
 */
async function trackedChannelLimit(workspaceId: string): Promise<number> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_subscriptions')
    .select('ci_plans ( limits )')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  // 구독 자체가 없으면 무료 플랜 기본값
  if (!data?.ci_plans) return NO_SUBSCRIPTION_CHANNEL_LIMIT

  const limits = (data.ci_plans.limits ?? {}) as Record<string, unknown>
  // 키가 없거나 null이면 무제한. 플랜이 "한도를 두지 않는다"고 말할 수 있어야 한다.
  if (limits.tracked_channels == null) return Number.POSITIVE_INFINITY

  const n = Number(limits.tracked_channels)
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY
}

/**
 * 관심 채널 추가.
 * 플랫폼 API 없이도 핸들만으로 등록되게 한다 — 이름은 수집이 돌면서 채워진다.
 * 확보하지 못한 이름을 그럴듯하게 지어내지 않고 핸들을 그대로 표시한다.
 */
export async function addChannel(input: {
  workspaceId: string
  urlOrHandle: string
  topicId?: string | null
  monitor: boolean
}): Promise<AddChannelResult> {
  const parsed = parseChannelUrl(input.urlOrHandle)
  if (!parsed) {
    return {
      ok: false, code: 'INVALID_URL',
      message: '채널 주소를 인식하지 못했습니다. 채널 페이지 URL을 붙여넣어 주세요',
    }
  }

  const adminClient = createAdminClient() as any
  const externalId = parsed.externalId ?? `handle:${parsed.handle}`

  // "이미 있나"는 SSOT가 판정한다. 여기서 external_id 정확 일치만 보면,
  // 훑기가 진짜 ID로 승격한 행을 못 찾아 **같은 채널을 다시 넣을 때마다 새 행**이 생긴다.
  const existing = await resolveExistingChannel(adminClient, input.workspaceId, {
    platform: parsed.platform,
    externalId: parsed.externalId,
    handle: parsed.handle,
    profileUrl: parsed.url,
    displayName: null,
  })

  if (existing?.id) {
    if (input.monitor) {
      await adminClient.from('ci_channels')
        .update({ is_monitored: true, monitored_since: new Date().toISOString() })
        .eq('id', existing.id)
      // 지켜보기를 켜면 그 채널의 게시물을 끌어온다 — 비교군이 있어야 배수가 나온다
      await enqueueJob({
        workspaceId: input.workspaceId, stage: 'ingest',
        targetType: 'channel', targetId: existing.id, version: Date.now(),
      })
    }
    const item = await getChannel(input.workspaceId, existing.id)
    return item ? { ok: true, item, created: false } : { ok: false, code: 'INVALID_URL', message: '채널을 불러오지 못했습니다' }
  }

  // 모니터링 대상만 과금 한도에 센다 — 그냥 목록에 있는 채널은 비용을 만들지 않는다
  if (input.monitor) {
    const limit = await trackedChannelLimit(input.workspaceId)
    const { count } = await adminClient
      .from('ci_channels').select('id', { count: 'exact', head: true })
      .eq('workspace_id', input.workspaceId).eq('is_monitored', true).is('deleted_at', null)
    const current = count ?? 0
    if (current >= limit) {
      return {
        ok: false, code: 'PLAN_LIMIT_EXCEEDED', limit, current,
        message: `현재 플랜에서는 관심 채널을 ${limit}곳까지 지켜볼 수 있습니다`,
      }
    }
  }

  const { data: created } = await adminClient.from('ci_channels').insert({
    workspace_id: input.workspaceId,
    platform: parsed.platform,
    external_id: externalId,
    handle: parsed.handle,
    display_name: parsed.handle ?? parsed.externalId ?? '이름 미확인',
    profile_url: parsed.url,
    ownership: 'tracked',
    is_monitored: input.monitor,
    monitored_since: input.monitor ? new Date().toISOString() : null,
    topic_id: input.topicId ?? null,
  }).select('id').single()

  if (created?.id) {
    // 새 채널은 바로 게시물을 훑는다. 등록만 하고 비어 있으면 아무것도 못 본다.
    await enqueueJob({
      workspaceId: input.workspaceId, stage: 'ingest',
      targetType: 'channel', targetId: created.id, version: Date.now(),
    })
  }

  const item = created?.id ? await getChannel(input.workspaceId, created.id) : null
  return item
    ? { ok: true, item, created: true }
    : { ok: false, code: 'INVALID_URL', message: '채널을 만들지 못했습니다' }
}
