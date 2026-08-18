// lib/ci/queries/channel-groups.ts — 채널별 보기 조회 SSOT (서버 전용)
//
// 왜 별도 조회인가: 채널별 보기의 **페이지 단위는 게시물이 아니라 채널**이다.
// 게시물로 페이지를 자른 뒤 그 안에서 묶으면 페이지마다 채널이 바뀌어
// "채널이 몇 곳이고 어디가 잘 됐나"를 어느 페이지에서도 볼 수 없다
// (사용자 지적 2026-08-18 · 표준: AG Grid 서버사이드 모델 "페이지는 최상위 그룹 기준").

import { createAdminClient } from '@/lib/supabase/server'
import { formatOutlier } from '../format/metrics.ts'
import type { CiContentFormat, CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChannelGroupRow {
  channelId: string | null
  channelName: string
  itemCount: number
  /** 이 채널에서 가장 높은 배수를 사람 말로. 근거가 부족하면 null */
  topOutlierText: string | null
}

export interface ChannelGroupsResult {
  groups: ChannelGroupRow[]
  /** 전체 채널 수 — 페이지 수를 화면이 계산한다 */
  total: number
}

export interface ChannelGroupsParams {
  workspaceId: string
  tab?: 'all' | 'review' | 'failed'
  /** 검색으로 좁힌 게시물 id. 검색이 아니면 null */
  contentIds?: string[] | null
  topicId?: string | null
  platform?: CiPlatform | null
  format?: CiContentFormat | null
  limit: number
  offset: number
}

export async function listChannelGroups(p: ChannelGroupsParams): Promise<ChannelGroupsResult> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient.rpc('ci_channel_groups', {
    p_workspace_id: p.workspaceId,
    p_tab: p.tab ?? 'all',
    p_ids: p.contentIds ?? null,
    p_topic: p.topicId || null,
    p_platform: p.platform || null,
    p_format: p.format || null,
    p_limit: p.limit,
    p_offset: p.offset,
  })

  const rows = (data ?? []) as {
    channel_id: string | null
    channel_name: string
    item_count: number
    top_outlier_index: number | null
    total_groups: number
  }[]

  return {
    groups: rows.map((r) => ({
      channelId: r.channel_id,
      channelName: r.channel_name,
      itemCount: Number(r.item_count),
      // 배수 표시는 목록과 **같은 함수**를 쓴다 — 화면마다 다른 문구가 나오면 안 된다.
      // 채널 최고 배수는 그 채널 안에서 이미 표본 조건을 통과한 값이라 baselineN을 다시 묻지 않는다.
      topOutlierText: r.top_outlier_index != null
        ? formatOutlier(r.top_outlier_index, Number.POSITIVE_INFINITY)
        : null,
    })),
    total: rows.length > 0 ? Number(rows[0].total_groups) : 0,
  }
}
