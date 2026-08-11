import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({ excluded: z.boolean(), reason: z.string().max(200).optional() })

/** 통계 제외 토글. 정정 이력을 남긴다. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_contents')
      .update({ is_stat_excluded: parsed.data.excluded })
      .eq('id', id).eq('workspace_id', session.workspaceId).select('id').maybeSingle()
    if (!data) return fail('NOT_FOUND', '콘텐츠를 찾을 수 없습니다')

    await adminClient.from('ci_corrections').insert({
      workspace_id: session.workspaceId,
      kind: 'outlier_dismiss',
      target_type: 'content',
      target_id: id,
      after_value: { excluded: parsed.data.excluded, reason: parsed.data.reason ?? null },
      actor_id: session.userId,
    })

    return ok({ id, excluded: parsed.data.excluded })
  } catch (e) {
    return failUnexpected(e)
  }
}
