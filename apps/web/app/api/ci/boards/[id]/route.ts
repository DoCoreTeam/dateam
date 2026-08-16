// app/api/ci/boards/[id]/route.ts — 보드 이름 바꾸기 · 지우기
//
// 예전엔 보드를 만들 수만 있고 이름도 못 바꾸고 지우지도 못했다.
// 잘못 만든 보드가 목록에 영원히 남았다.
// (근거: docs/2026-08-16-ci-crud-audit/AUDIT.md §4)

import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { deleteCiEntity } from '@/lib/ci/queries/delete'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Patch = z.object({
  name: z.string().trim().min(1).max(120),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const parsed = Patch.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail('VALIDATION_FAILED', '보드 이름을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_boards').update({ name: parsed.data.name })
      .eq('id', id).eq('workspace_id', session.workspaceId).select('id, name').maybeSingle()

    return data ? ok(data) : fail('NOT_FOUND', '보드를 찾을 수 없습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}

/** 진짜로 지운다. 담긴 항목도 함께 사라진다(FK CASCADE). 되돌릴 수 없다. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const { id } = await ctx.params
    const res = await deleteCiEntity('board', id, session.workspaceId)
    if (!res.ok) return fail(res.code ?? 'INTERNAL', res.errorMessage ?? '지우지 못했습니다')
    if (res.deleted === 0) return fail('NOT_FOUND', '보드를 찾을 수 없습니다')
    return ok({ id, deleted: res.deleted })
  } catch (e) {
    return failUnexpected(e)
  }
}
