import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { kstWallToIso } from '@/lib/datetime/kst'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  kind: z.enum(['news', 'search_spike', 'community']),
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().max(500).optional(),
  source: z.string().trim().max(80).optional(),
  topicId: z.string().uuid().nullable().optional(),
  occurredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_signals').insert({
      workspace_id: session.workspaceId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      url: parsed.data.url || null,
      source: parsed.data.source || null,
      topic_id: parsed.data.topicId ?? null,
      // KST 벽시계 → +09:00 앵커 ISO
      occurred_at: parsed.data.occurredDate
        ? kstWallToIso(parsed.data.occurredDate, '00:00')
        : new Date().toISOString(),
    }).select('id').single()

    return data ? ok(data) : fail('INTERNAL', '이슈를 등록하지 못했습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function DELETE(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return fail('VALIDATION_FAILED', 'id가 필요합니다')
    const adminClient = createAdminClient() as any
    await adminClient.from('ci_signals').delete().eq('id', id).eq('workspace_id', session.workspaceId)
    return ok({ id })
  } catch (e) {
    return failUnexpected(e)
  }
}
