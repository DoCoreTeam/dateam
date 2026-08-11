import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { createAdminClient } from '@/lib/supabase/server'
import { enrichChannelMeta } from '@/lib/ci/jobs/stages'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 채널 정보(구독자·소개문·아바타)를 지금 다시 읽어온다. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params

    // 워크스페이스 밖 채널을 건드리지 못하게 소유를 먼저 확인한다.
    const adminClient = createAdminClient() as any
    const { data: owned } = await adminClient
      .from('ci_channels').select('id')
      .eq('id', id).eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .maybeSingle()
    if (!owned) return fail('NOT_FOUND', '채널을 찾을 수 없습니다')

    const result = await enrichChannelMeta(id)
    if (!result.ok) {
      return ok({ note: result.errorMessage ?? '채널 정보를 가져오지 못했습니다' })
    }
    return ok({ note: result.errorMessage ?? '채널 정보를 새로 가져왔습니다' })
  } catch (e) {
    return failUnexpected(e)
  }
}
