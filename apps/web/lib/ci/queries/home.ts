// lib/ci/queries/home.ts — 홈·셸에 필요한 집계 (서버 전용)
// 루프 미니맵 건수는 셸과 홈이 함께 쓴다 → 한 곳에서만 계산한다.

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import type { CiLoopMinimap, CiRefreshState } from '../contracts.ts'

const EMPTY: CiLoopMinimap = { review: 0, newOutliers: 0, producing: 0, ready: 0, tracking: 0 }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function countRows(
  table: string,
  build: (q: any) => any,
): Promise<number> {
  try {
    const adminClient = createAdminClient() as any
    const { count } = await build(adminClient.from(table).select('id', { count: 'exact', head: true }))
    return count ?? 0
  } catch {
    // 집계 실패가 화면을 죽이지 않는다. 0으로 떨어뜨리고 화면은 계속 뜬다.
    return 0
  }
}

/** 최근 며칠 안에 발견된 떡상을 "새 떡상"으로 본다. */
export const NEW_OUTLIER_WINDOW_DAYS = 7

export async function getLoopCounts(workspaceId: string): Promise<CiLoopMinimap> {
  if (!workspaceId) return EMPTY

  const since = new Date(Date.now() - NEW_OUTLIER_WINDOW_DAYS * 86400_000).toISOString()

  const [review, newOutliers, producing, ready, tracking] = await Promise.all([
    // 검토 대기 — 저확신으로 검토 큐에 들어온 것
    countRows('ci_contents', (q) =>
      q.eq('workspace_id', workspaceId).eq('review_state', 'pending').is('deleted_at', null)),

    // 새 떡상 — 코퍼스 안에서 최근 발견분
    countRows('ci_contents', (q) =>
      q.eq('workspace_id', workspaceId)
        .eq('source', CORPUS_FILTER.source)
        .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
        .is('deleted_at', null)
        .gte('first_seen_at', since)),

    // 제작 중 — 아이디어·기획·편집
    countRows('ci_ideas', (q) =>
      q.eq('workspace_id', workspaceId).is('archived_at', null).in('stage', ['idea', 'brief', 'edit'])),

    // 게시 준비
    countRows('ci_ideas', (q) =>
      q.eq('workspace_id', workspaceId).is('archived_at', null).eq('stage', 'ready')),

    // 추적 중 — 모니터링 켜진 관심 채널
    countRows('ci_channels', (q) =>
      q.eq('workspace_id', workspaceId).eq('is_monitored', true).is('deleted_at', null)),
  ])

  return { review, newOutliers, producing, ready, tracking }
}

/** 자동 업데이트 상태 — 잡 큐를 그대로 읽는다(침묵 실패 금지). */
export async function getRefreshState(workspaceId: string): Promise<CiRefreshState> {
  const fallback: CiRefreshState = {
    status: 'idle', progress: 100, newCount: 0, failedCount: 0, lastRunAt: null,
  }
  if (!workspaceId) return fallback

  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_jobs')
      .select('status, updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(200)

    const rows: { status: string; updated_at: string }[] = data ?? []
    if (rows.length === 0) return fallback

    const running = rows.filter((r) => r.status === 'queued' || r.status === 'running').length
    const dead = rows.filter((r) => r.status === 'dead').length
    const done = rows.length - running

    return {
      status: running > 0 ? 'running' : dead > 0 ? 'failed' : 'idle',
      progress: rows.length === 0 ? 100 : Math.round((done / rows.length) * 100),
      newCount: rows.filter((r) => r.status === 'succeeded').length,
      failedCount: dead,
      lastRunAt: rows[0]?.updated_at ?? null,
    }
  } catch {
    return fallback
  }
}
