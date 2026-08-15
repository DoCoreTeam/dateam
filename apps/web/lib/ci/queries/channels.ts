// lib/ci/queries/channels.ts — 채널 조회·생성 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import { parseChannelUrl } from '../ucm/url.ts'
import { resolveExistingChannel } from './channel-resolve.ts'
import { enqueueJob } from '../jobs/queue.ts'
import type { CiChannelListItem } from '../contracts.ts'
import type { CiChannelOwnership, CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  ci_topics: { id: string; name: string } | null
}

function toItem(r: Row): CiChannelListItem {
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
  }
}

export async function listChannels(
  workspaceId: string,
  ownership?: CiChannelOwnership,
): Promise<CiChannelListItem[]> {
  const adminClient = createAdminClient() as any
  let q = adminClient
    .from('ci_channels')
    .select('id, platform, display_name, handle, avatar_url, subscriber_count, is_monitored, ownership, size_band, last_seen_at, description, video_count, profile_url, subscriber_provenance, meta_fetched_at, meta_error, collect_window, ci_topics ( id, name )')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('is_monitored', { ascending: false })
    .order('display_name', { ascending: true })

  if (ownership) q = q.eq('ownership', ownership)

  const { data } = await q
  return ((data ?? []) as Row[]).map(toItem)
}

export async function getChannel(
  workspaceId: string,
  channelId: string,
): Promise<CiChannelListItem | null> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_channels')
    .select('id, platform, display_name, handle, avatar_url, subscriber_count, is_monitored, ownership, size_band, last_seen_at, description, video_count, profile_url, subscriber_provenance, meta_fetched_at, meta_error, collect_window, ci_topics ( id, name )')
    .eq('workspace_id', workspaceId).eq('id', channelId).is('deleted_at', null)
    .maybeSingle()
  return data ? toItem(data as Row) : null
}

export type AddChannelResult =
  | { ok: true; item: CiChannelListItem; created: boolean }
  | { ok: false; code: 'INVALID_URL' | 'PLAN_LIMIT_EXCEEDED'; message: string; limit?: number; current?: number }

/** 플랜 한도 조회. 구독이 없으면 무료 플랜 기본값을 쓴다. */
async function trackedChannelLimit(workspaceId: string): Promise<number> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_subscriptions')
    .select('ci_plans ( limits )')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const limits = (data?.ci_plans?.limits ?? {}) as Record<string, unknown>
  const n = Number(limits.tracked_channels)
  return Number.isFinite(n) && n > 0 ? n : 3
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
