import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  topicId: z.string().uuid().nullable(),
  /** 이 주제가 아니라고 확인만 하고 넘기는 경우 */
  dismiss: z.boolean().default(false),
})

/**
 * 주제 확정. 사용자 정정은 CorrectionLog에 쌓여 다음 분류에 반영된다(설계서 §11.4).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data: before } = await adminClient.from('ci_contents')
      .select('id, topic_id').eq('id', id).eq('workspace_id', session.workspaceId).maybeSingle()
    if (!before) return fail('NOT_FOUND', '콘텐츠를 찾을 수 없습니다')

    await adminClient.from('ci_contents').update({
      topic_id: parsed.data.topicId,
      topic_source: 'user',
      topic_confidence: parsed.data.topicId ? 1 : 0,
      review_state: 'resolved',
    }).eq('id', id)

    // 사용자 정정을 버리지 않는다 — 학습 탭과 규칙 승격 제안의 근거가 된다
    if (before.topic_id !== parsed.data.topicId) {
      await adminClient.from('ci_corrections').insert({
        workspace_id: session.workspaceId,
        kind: 'topic',
        target_type: 'content',
        target_id: id,
        before_value: { topicId: before.topic_id },
        after_value: { topicId: parsed.data.topicId },
        actor_id: session.userId,
      })
    }

    return ok({ id, topicId: parsed.data.topicId })
  } catch (e) {
    return failUnexpected(e)
  }
}
