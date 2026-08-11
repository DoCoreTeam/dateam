import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  itemType: z.enum(['content', 'pattern', 'signal']),
  itemId: z.string().uuid(),
  note: z.string().max(1000).optional(),
})

async function assertBoard(workspaceId: string, boardId: string): Promise<boolean> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient.from('ci_boards').select('id')
    .eq('id', boardId).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle()
  return Boolean(data)
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const { id } = await ctx.params
    if (!await assertBoard(session.workspaceId, id)) return fail('NOT_FOUND', '보드를 찾을 수 없습니다')

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_board_items')
      .select('id, item_type, item_id, note, added_at')
      .eq('board_id', id).order('added_at', { ascending: false })
    return ok(data ?? [])
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const { id } = await ctx.params
    if (!await assertBoard(session.workspaceId, id)) return fail('NOT_FOUND', '보드를 찾을 수 없습니다')

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { error: insErr } = await adminClient.from('ci_board_items').insert({
      board_id: id,
      item_type: parsed.data.itemType,
      item_id: parsed.data.itemId,
      note: parsed.data.note ?? null,
      added_by: session.userId,
    })
    // 같은 항목을 두 번 담아도 에러로 막지 않는다 — 이미 담긴 것이다
    if (insErr) return ok({ boardId: id, deduped: true })
    return ok({ boardId: id, deduped: false })
  } catch (e) {
    return failUnexpected(e)
  }
}
