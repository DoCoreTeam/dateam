import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  topicId: z.string().uuid().nullable().optional(),
})

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('ci_boards')
      .select('id, name, created_at, ci_board_items ( id )')
      .eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .order('created_at', { ascending: false })
    return ok((data ?? []).map((b: any) => ({
      id: b.id, name: b.name, createdAt: b.created_at, itemCount: (b.ci_board_items ?? []).length,
    })))
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '보드 이름을 확인해 주세요', parsed.error.issues)
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_boards').insert({
      workspace_id: session.workspaceId,
      name: parsed.data.name,
      topic_id: parsed.data.topicId ?? null,
      created_by: session.userId,
    }).select('id, name').single()
    return data ? ok(data) : fail('INTERNAL', '보드를 만들지 못했습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}
