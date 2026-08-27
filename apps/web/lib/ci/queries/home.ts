// lib/ci/queries/home.ts — 홈·셸에 필요한 집계 (서버 전용)
// 루프 미니맵 건수는 셸과 홈이 함께 쓴다 → 한 곳에서만 계산한다.

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import type { CiLoopMinimap, CiRefreshState } from '../contracts.ts'

const EMPTY: CiLoopMinimap = {
  review: 0, newOutliers: 0, producing: 0, ready: 0, tracking: 0,
  editPlans: 0, boards: 0, publications: 0, ownChannels: 0,
}

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

/**
 * 사이드바 배지 숫자를 이 초만큼 재사용한다.
 *
 * 왜 캐시하는가: 이 함수는 **모든 CI 화면의 셸**에서 돌고 count 쿼리 5개를 낸다.
 *   화면 하나를 여는 DB 왕복 20회 중 **5회가 여기**였다. 사용자가 화면을 옮길 때마다
 *   같은 숫자를 다시 셌다.
 * 왜 30초인가: 이 숫자는 "검토 대기 3건" 같은 **안내 배지**다. 30초 늦은 숫자와
 *   화면마다 5왕복 중에서는 전자가 낫다. 실제 목록은 캐시하지 않으므로 화면에 들어가면
 *   항상 최신을 본다 — 늦을 수 있는 건 배지뿐이다.
 * 워크스페이스 단위 값이라 사용자별로 다르지 않다 → 키에 workspaceId만 넣으면 안전하다.
 * (근거: docs/2026-08-16-performance-audit/PLAN.md §2-2)
 */
export const LOOP_COUNTS_TTL_SECONDS = 30

export async function getLoopCounts(workspaceId: string): Promise<CiLoopMinimap> {
  if (!workspaceId) return EMPTY
  return unstable_cache(
    () => computeLoopCounts(workspaceId),
    ['ci-loop-counts', workspaceId],
    { revalidate: LOOP_COUNTS_TTL_SECONDS, tags: [`ci-loop-counts:${workspaceId}`] },
  )()
}

async function computeLoopCounts(workspaceId: string): Promise<CiLoopMinimap> {
  const since = new Date(Date.now() - NEW_OUTLIER_WINDOW_DAYS * 86400_000).toISOString()

  const [
    review, newOutliers, producing, ready, tracking,
    editPlans, boards, publications, ownChannels,
  ] = await Promise.all([
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

    // ── 아래 넷은 «메뉴에 올릴지»를 정하는 값이다. 0이면 사이드바가 그 항목을 접는다.
    countRows('ci_edit_plans', (q) => q.eq('workspace_id', workspaceId)),
    countRows('ci_boards', (q) => q.eq('workspace_id', workspaceId)),
    countRows('ci_publications', (q) => q.eq('workspace_id', workspaceId)),
    countRows('ci_channels', (q) =>
      q.eq('workspace_id', workspaceId).eq('ownership', 'owned').is('deleted_at', null)),
  ])

  return {
    review, newOutliers, producing, ready, tracking,
    editPlans, boards, publications, ownChannels,
  }
}

/** "최근"의 정의. 이 창 밖의 일은 지금 화면과 무관하다. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 자동 업데이트 상태.
 *
 * 예전 판은 세 군데서 거짓말을 했다:
 *   - `newCount`가 **성공한 잡 수**였다. 잡은 콘텐츠 1건당 6개(수집→…→파생)라
 *     콘텐츠 21건이 "신규 263"으로 보였다. 사용자는 이걸 "새로 들어온 게시물"로 읽는다.
 *   - `progress`가 **역대 잡 200건 중 끝난 비율**이었다. 이력이 쌓이면 항상 100%라
 *     진행 중이든 아니든 같은 숫자였다.
 *   - `failedCount`가 **역대 죽은 잡**이라 한 번 실패하면 영원히 빨간 배지가 남았다.
 *
 * 지금은 각 숫자가 사용자가 읽는 그대로다:
 *   신규 = 최근 24시간에 **처음 들어온 콘텐츠 수**
 *   진행률 = 지금 처리 중인 일이 있을 때만 의미가 있다(없으면 100)
 *   실패 = 최근 24시간 안에 죽은 잡(눌러서 볼 수 있는 것)
 */
export async function getRefreshState(workspaceId: string): Promise<CiRefreshState> {
  const fallback: CiRefreshState = {
    status: 'idle', progress: 100, newCount: 0, failedCount: 0, lastRunAt: null,
  }
  if (!workspaceId) return fallback

  const sinceIso = new Date(Date.now() - RECENT_WINDOW_MS).toISOString()

  try {
    const adminClient = createAdminClient() as any

    const [pendingRes, recentRes, newRes, lastRes] = await Promise.all([
      // 지금 남은 일 — 진행 중 여부의 유일한 근거
      adminClient.from('ci_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId).in('status', ['queued', 'running', 'failed']),
      // 최근 창 안에서 끝난 일 — 진행률의 분모를 이 창으로 한정한다
      adminClient.from('ci_jobs')
        .select('status')
        .eq('workspace_id', workspaceId).gte('updated_at', sinceIso).limit(500),
      // 신규 = 콘텐츠. 잡이 아니다.
      adminClient.from('ci_contents')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId).is('deleted_at', null).gte('first_seen_at', sinceIso),
      adminClient.from('ci_jobs')
        .select('updated_at')
        .eq('workspace_id', workspaceId).eq('status', 'succeeded')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ])

    const pending = pendingRes.count ?? 0
    const recent: { status: string }[] = recentRes.data ?? []
    const recentDone = recent.filter((r) => r.status === 'succeeded' || r.status === 'dead').length
    const recentDead = recent.filter((r) => r.status === 'dead').length

    // 진행률은 "이번 물결"에 대해서만 말이 된다.
    // 남은 일이 없으면 100 — 끝난 것을 87%라고 하지 않는다.
    const total = pending + recentDone
    const progress = pending === 0 ? 100 : total === 0 ? 0 : Math.round((recentDone / total) * 100)

    return {
      status: pending > 0 ? 'running' : recentDead > 0 ? 'failed' : 'idle',
      progress,
      newCount: newRes.count ?? 0,
      failedCount: recentDead,
      lastRunAt: lastRes.data?.updated_at ?? null,
    }
  } catch {
    return fallback
  }
}
