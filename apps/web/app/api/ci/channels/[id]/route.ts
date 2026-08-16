import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getChannel } from '@/lib/ci/queries/channels'
import { enqueueJob } from '@/lib/ci/jobs/queue'
import { deleteCiEntity } from '@/lib/ci/queries/delete'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Patch = z.object({
  isMonitored: z.boolean().optional(),
  topicId: z.string().uuid().nullable().optional(),
  ownership: z.enum(['owned', 'tracked']).optional(),
  collectWindow: z.enum(['1m', '3m', '1y', 'all']).optional(),
  /** 기간을 바꾸면 그 자리에서 다시 훑을 수 있게 한다 */
  resweep: z.boolean().optional(),
})

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const { id } = await ctx.params
    const item = await getChannel(session.workspaceId, id)
    return item ? ok(item) : fail('NOT_FOUND', '채널을 찾을 수 없습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const parsed = Patch.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const patch: Record<string, unknown> = {}
    if (parsed.data.isMonitored !== undefined) {
      patch.is_monitored = parsed.data.isMonitored
      patch.monitored_since = parsed.data.isMonitored ? new Date().toISOString() : null
    }
    if (parsed.data.topicId !== undefined) patch.topic_id = parsed.data.topicId
    if (parsed.data.ownership !== undefined) patch.ownership = parsed.data.ownership
    if (parsed.data.collectWindow !== undefined) patch.collect_window = parsed.data.collectWindow

    const adminClient = createAdminClient() as any
    if (Object.keys(patch).length > 0) {
      await adminClient.from('ci_channels').update(patch)
        .eq('id', id).eq('workspace_id', session.workspaceId)
    }

    // 기간을 바꿨거나 사용자가 요청하면 즉시 다시 훑는다 —
    // 설정만 바뀌고 목록이 그대로면 바뀐 걸 확인할 방법이 없다
    if (parsed.data.resweep || parsed.data.collectWindow !== undefined) {
      await enqueueJob({
        workspaceId: session.workspaceId, stage: 'ingest',
        targetType: 'channel', targetId: id, version: Date.now(),
      })
    }

    const item = await getChannel(session.workspaceId, id)
    return item ? ok(item) : fail('NOT_FOUND', '채널을 찾을 수 없습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}

/** 소프트 삭제 — 추적 이력을 지우지 않는다. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    // CI 워크스페이스 멤버면 지운다 — 앱 전역 admin과 무관하다.
    // 예전엔 여기만 'admin'이라 다른 변경(추가·수정)은 되는데 삭제만 막혀 있었다.
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const { id } = await ctx.params

    // 진짜 삭제다. 게시물은 함께 사라지지 않는다 —
    // `ci_contents.channel_id`가 SET NULL이라 수집한 게시물과 지표는 그대로 남는다.
    const res = await deleteCiEntity('channel', id, session.workspaceId)
    if (!res.ok) return fail(res.code ?? 'INTERNAL', res.errorMessage ?? '지우지 못했습니다')
    if (res.deleted === 0) return fail('NOT_FOUND', '채널을 찾을 수 없습니다')
    return ok({ id, deleted: res.deleted })
  } catch (e) {
    return failUnexpected(e)
  }
}
