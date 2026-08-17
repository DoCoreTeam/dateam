// app/api/ci/topics/backfill/route.ts — 이미 담긴 게시물의 주제 신호를 다시 받아온다
//
// 왜 필요한가: 커넥터가 `topicDetails`를 요청조차 안 하던 시절에 담긴 게시물은
// platform_category·topic_signals가 비어 있다(실측 320건). 코드를 고쳐도 **이미 있는 데이터는
// 스스로 채워지지 않는다** — 채널 훑기는 새 게시물만 담고 기존 행은 건너뛰기 때문이다.
//
// 되돌릴 수 있는 형태다: 신호를 추가로 저장하고 다시 판정할 뿐, 지우는 것이 없다.

import { createAdminClient } from '@/lib/supabase/server'
import { ok, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { enqueueJob } from '@/lib/ci/jobs/queue'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한 번에 다시 수집할 게시물 수. 유튜브 videos.list는 건당 1유닛(일 10,000). */
const MAX_CONTENTS = 500

/** 게시물 한 건을 다시 수집하는 데 걸리는 대략의 시간(초). 채널 재판정 지연을 여기서 만든다. */
const SECONDS_PER_CONTENT = 2

/** 채널 재판정을 너무 늦게 걸면 사용자가 기다리다 창을 닫는다. */
const MAX_DELAY_SECONDS = 1800

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const adminClient = createAdminClient() as any
    const [{ count: total }, { count: missing }] = await Promise.all([
      adminClient.from('ci_contents').select('id', { count: 'exact', head: true })
        .eq('workspace_id', session.workspaceId).is('deleted_at', null),
      adminClient.from('ci_contents').select('id', { count: 'exact', head: true })
        .eq('workspace_id', session.workspaceId).is('deleted_at', null)
        .eq('topic_signals', '{}'),
    ])

    return ok({
      total: total ?? 0,
      // 신호가 비어 있는 게시물 수 — 이 숫자가 곧 "판단 근거가 없는 게시물"이다
      missingSignals: missing ?? 0,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const adminClient = createAdminClient() as any

    // 신호가 비어 있는 게시물만 고른다 — 이미 채워진 것을 다시 부르면 쿼터만 태운다
    const { data: targets } = await adminClient.from('ci_contents')
      .select('id')
      .eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .eq('topic_signals', '{}')
      .limit(MAX_CONTENTS)

    const ids = ((targets ?? []) as { id: string }[]).map((t) => t.id)
    const version = Date.now()

    let queued = 0
    for (const contentId of ids) {
      const r = await enqueueJob({
        workspaceId: session.workspaceId, stage: 'ingest',
        targetType: 'content', targetId: contentId, version,
      }).catch(() => null)
      if (r?.jobId && !r.deduped) queued++
    }

    // 채널 재판정(L1)은 게시물 신호가 찬 뒤에 돌아야 한다.
    // 지금 걸면 방금 만든 잡들보다 먼저 실행돼 "신호 없음"으로 판정한다 → 지연을 준다.
    const delaySeconds = Math.min(MAX_DELAY_SECONDS, 30 + queued * SECONDS_PER_CONTENT)

    const { data: channels } = await adminClient.from('ci_channels')
      .select('id').eq('workspace_id', session.workspaceId).is('deleted_at', null)
    const channelIds = ((channels ?? []) as { id: string }[]).map((c) => c.id)

    for (const channelId of channelIds) {
      await enqueueJob({
        workspaceId: session.workspaceId, stage: 'classify',
        targetType: 'channel', targetId: channelId, version, delaySeconds,
      }).catch(() => null)
    }

    // 언제 무엇이 끝나는지 그대로 돌려준다 — "눌렀는데 아무 일도 안 나는" 것처럼 보이면 안 된다
    return ok({
      contents: ids.length,
      queued,
      channels: channelIds.length,
      delaySeconds,
      truncated: ids.length >= MAX_CONTENTS,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
