import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { enqueueJob } from '@/lib/ci/jobs/queue'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 재시도. 버전을 올려 멱등키를 새로 만든다 — 그래야 같은 대상을 다시 처리할 수 있다. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const adminClient = createAdminClient() as any

    const { data: content } = await adminClient
      .from('ci_contents').select('id')
      .eq('id', id).eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .maybeSingle()

    if (!content) return fail('NOT_FOUND', '콘텐츠를 찾을 수 없습니다')

    await adminClient.from('ci_contents')
      .update({ ingest_status: 'queued' }).eq('id', id)

    const { jobId } = await enqueueJob({
      workspaceId: session.workspaceId,
      stage: 'ingest',
      targetType: 'content',
      targetId: id,
      version: Date.now(),
    })

    return ok({ contentId: id, jobId, status: 'queued' })
  } catch (e) {
    return failUnexpected(e)
  }
}
