import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { getChannel } from '@/lib/ci/queries/channels'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Patch = z.object({
  isMonitored: z.boolean().optional(),
  topicId: z.string().uuid().nullable().optional(),
  ownership: z.enum(['owned', 'tracked']).optional(),
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

    const adminClient = createAdminClient() as any
    await adminClient.from('ci_channels').update(patch)
      .eq('id', id).eq('workspace_id', session.workspaceId)

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
    const { session, error } = await requireCiMemberApi(workspaceId, 'admin')
    if (error) return error
    const { id } = await ctx.params
    const adminClient = createAdminClient() as any
    await adminClient.from('ci_channels')
      .update({ deleted_at: new Date().toISOString(), is_monitored: false })
      .eq('id', id).eq('workspace_id', session.workspaceId)
    return ok({ id })
  } catch (e) {
    return failUnexpected(e)
  }
}
