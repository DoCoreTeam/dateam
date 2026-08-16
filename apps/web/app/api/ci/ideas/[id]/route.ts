import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { deleteCiEntity } from '@/lib/ci/queries/delete'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Patch = z.object({
  stage: z.enum(['idea', 'brief', 'edit', 'ready']).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(4000).nullable().optional(),
  archived: z.boolean().optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const parsed = Patch.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const patch: Record<string, unknown> = {}
    if (parsed.data.stage) patch.stage = parsed.data.stage
    if (parsed.data.title) patch.title = parsed.data.title
    if (parsed.data.note !== undefined) patch.note = parsed.data.note
    if (parsed.data.archived !== undefined) {
      patch.archived_at = parsed.data.archived ? new Date().toISOString() : null
    }
    if (Object.keys(patch).length === 0) return fail('VALIDATION_FAILED', '변경할 내용이 없습니다')

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_ideas').update(patch)
      .eq('id', id).eq('workspace_id', session.workspaceId).select('id, stage').maybeSingle()

    return data ? ok(data) : fail('NOT_FOUND', '아이디어를 찾을 수 없습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}

/** 진짜로 지운다. 되돌릴 수 없다. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const { id } = await ctx.params
    const res = await deleteCiEntity('idea', id, session.workspaceId)
    if (!res.ok) return fail(res.code ?? 'INTERNAL', res.errorMessage ?? '지우지 못했습니다')
    if (res.deleted === 0) return fail('NOT_FOUND', '아이디어을(를) 찾을 수 없습니다')
    return ok({ id, deleted: res.deleted })
  } catch (e) {
    return failUnexpected(e)
  }
}
