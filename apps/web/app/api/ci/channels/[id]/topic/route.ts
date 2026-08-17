// app/api/ci/channels/[id]/topic/route.ts — 채널 주제 확정 (L4 사람 판정)
//
// 왜 이 API가 있는가: 예전에는 확정 창구가 `POST /contents/[id]/topic` 하나뿐이라
// 게시물 1만 건이면 클릭이 1만 번이었다. 사람에게 물어야 할 질문은
// "이 영상 주제 뭐예요?" ×10,000이 아니라 "이 채널 뭐 하는 채널이에요?" ×1이다.
//
// 채널 하나를 확정하면 그 채널 콘텐츠가 **함께** 확정된다(실측: 추성훈 1회 = 311건).

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { runClassify } from '@/lib/ci/jobs/stages'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  topicId: z.string().uuid().nullable(),
  /**
   * 이미 사람이 손대 둔 게시물까지 덮을지.
   * 기본은 false — 남이 내린 판단을 조용히 지우지 않는다.
   */
  overrideUserSet: z.boolean().default(false),
})

/** 한 번에 다시 판정할 콘텐츠 상한. 이보다 많으면 나머지는 잡 워커가 이어받는다. */
const INLINE_LIMIT = 500

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id: channelId } = await ctx.params
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any

    const { data: channel } = await adminClient.from('ci_channels')
      .select('id, display_name, topic_id')
      .eq('id', channelId).eq('workspace_id', session.workspaceId)
      .is('deleted_at', null).maybeSingle()
    if (!channel) return fail('NOT_FOUND', '채널을 찾을 수 없습니다')

    // 주제가 이 워크스페이스 것인지 확인한다 — 남의 워크스페이스 주제를 붙이면 통계가 섞인다
    if (parsed.data.topicId) {
      const { data: topic } = await adminClient.from('ci_topics')
        .select('id').eq('id', parsed.data.topicId).eq('workspace_id', session.workspaceId)
        .is('deleted_at', null).maybeSingle()
      if (!topic) return fail('NOT_FOUND', '주제를 찾을 수 없습니다')
    }

    await adminClient.from('ci_channels').update({
      topic_id: parsed.data.topicId,
      topic_confidence: parsed.data.topicId ? 1 : null,
      topic_source: parsed.data.topicId ? 'user' : null,
    }).eq('id', channelId)

    // 사용자 정정을 버리지 않는다 — 다음 분류 프롬프트의 근거가 된다.
    // 채널 단위로 확정하면 정정이 즉시 쌓인다는 점이, 검토 부담을 낮추는 일이
    // 곧 학습을 살리는 길인 이유다(ci_corrections 실측 0건이었다).
    if (channel.topic_id !== parsed.data.topicId) {
      await adminClient.from('ci_corrections').insert({
        workspace_id: session.workspaceId,
        kind: 'topic',
        target_type: 'channel',
        target_id: channelId,
        before_value: { topicId: channel.topic_id },
        after_value: { topicId: parsed.data.topicId },
        actor_id: session.userId,
      })
    }

    // 소속 콘텐츠를 다시 판정한다. 사다리가 채널 주제를 상속으로 받아 간다.
    let q = adminClient.from('ci_contents').select('id')
      .eq('channel_id', channelId).eq('workspace_id', session.workspaceId)
      .is('deleted_at', null)
    if (!parsed.data.overrideUserSet) q = q.neq('topic_source', 'user')

    const { data: targets } = await q.limit(INLINE_LIMIT)
    const ids = ((targets ?? []) as { id: string }[]).map((t) => t.id)

    let applied = 0
    for (const contentId of ids) {
      const r = await runClassify(session.workspaceId, contentId).catch(() => null)
      if (r?.ok) applied++
    }

    // 몇 건에 반영됐는지 그대로 돌려준다 — 사용자가 "몇 개가 바뀌었나"를 알아야 한다
    return ok({
      channelId,
      topicId: parsed.data.topicId,
      applied,
      truncated: ids.length >= INLINE_LIMIT,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
