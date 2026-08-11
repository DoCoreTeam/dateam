// lib/ci/queries/home-data.ts — 홈 화면 데이터 (서버 전용)
// 홈은 페이지(서버 컴포넌트)와 API가 같은 함수를 쓴다 — 두 경로가 다른 값을 보이면 안 된다.

import { createAdminClient } from '@/lib/supabase/server'
import { getLoopCounts, getRefreshState } from './home.ts'
import { listContents } from './contents.ts'
import type { CiColdStartStep, CiHomeData } from '../contracts.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const BRIEFING_LIMIT = 12

/** 콜드 스타트 판정 — 데이터 없는 빈 대시보드를 보여주지 않기 위한 게이트(설계서 §8.6) */
async function judgeColdStart(workspaceId: string): Promise<{ needed: boolean; step: CiColdStartStep | null }> {
  const adminClient = createAdminClient() as any

  const [{ count: topics }, { count: channels }, { count: contents }] = await Promise.all([
    adminClient.from('ci_topics').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).is('deleted_at', null),
    adminClient.from('ci_channels').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('is_monitored', true).is('deleted_at', null),
    adminClient.from('ci_contents').select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).is('deleted_at', null),
  ])

  if ((topics ?? 0) === 0) return { needed: true, step: 'topic' }
  if ((contents ?? 0) === 0) return { needed: true, step: 'samples' }
  if ((channels ?? 0) === 0) return { needed: true, step: 'channels' }
  return { needed: false, step: null }
}

export async function getHomeData(workspaceId: string): Promise<CiHomeData> {
  const adminClient = createAdminClient() as any

  const [ws, minimap, refresh, coldStart, briefing] = await Promise.all([
    adminClient.from('ci_workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    getLoopCounts(workspaceId),
    getRefreshState(workspaceId),
    judgeColdStart(workspaceId),
    listContents({
      workspaceId,
      corpusOnly: true,
      sort: 'outlier',
      windowDays: 7,
      limit: BRIEFING_LIMIT,
    }),
  ])

  return {
    workspaceId,
    workspaceName: ws?.data?.name ?? '워크스페이스',
    minimap,
    briefing: briefing.items,
    refresh,
    coldStart,
  }
}
