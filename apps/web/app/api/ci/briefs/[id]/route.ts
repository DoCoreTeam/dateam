import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { deleteCiEntity } from '@/lib/ci/queries/delete'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Patch = z.object({
  titleOptions: z.array(z.string()).optional(),
  hook: z.string().nullable().optional(),
  script: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  thumbnailIdeas: z.array(z.string()).optional(),
  status: z.enum(['draft', 'ready']).optional(),
})

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const { id } = await ctx.params
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_briefs')
      .select('id, idea_id, version, title_options, hook, script, caption, tags, thumbnail_specs, status, generated_by, created_at')
      .eq('id', id).eq('workspace_id', session.workspaceId).maybeSingle()
    return data ? ok(data) : fail('NOT_FOUND', '기획안을 찾을 수 없습니다')
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

    const p: Record<string, unknown> = {}
    const d = parsed.data
    if (d.titleOptions) p.title_options = d.titleOptions
    if (d.hook !== undefined) p.hook = d.hook
    if (d.script !== undefined) p.script = d.script
    if (d.caption !== undefined) p.caption = d.caption
    if (d.tags) p.tags = d.tags
    if (d.thumbnailIdeas) p.thumbnail_specs = { ideas: d.thumbnailIdeas }
    if (d.status) p.status = d.status
    if (Object.keys(p).length === 0) return fail('VALIDATION_FAILED', '변경할 내용이 없습니다')

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_briefs').update(p)
      .eq('id', id).eq('workspace_id', session.workspaceId).select('id, status').maybeSingle()
    return data ? ok(data) : fail('NOT_FOUND', '기획안을 찾을 수 없습니다')
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
    const res = await deleteCiEntity('brief', id, session.workspaceId)
    if (!res.ok) return fail(res.code ?? 'INTERNAL', res.errorMessage ?? '지우지 못했습니다')
    if (res.deleted === 0) return fail('NOT_FOUND', '기획을(를) 찾을 수 없습니다')
    return ok({ id, deleted: res.deleted })
  } catch (e) {
    return failUnexpected(e)
  }
}
