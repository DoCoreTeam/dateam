import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { kstWallToIso } from '@/lib/datetime/kst'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  ideaId: z.string().uuid().optional(),
  platform: z.enum(['youtube','tiktok','instagram','facebook','x','threads']),
  channelId: z.string().uuid().nullable().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
})

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_publications')
      .select('id, platform, route, status, scheduled_at, published_at, published_url, error_code, error_message')
      .eq('workspace_id', session.workspaceId)
      .order('created_at', { ascending: false }).limit(100)
    return ok(data ?? [])
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
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    // KST 벽시계 → +09:00 앵커 ISO. naive 문자열을 DB에 넣지 않는다.
    const scheduledAt = parsed.data.scheduledDate
      ? kstWallToIso(parsed.data.scheduledDate, parsed.data.scheduledTime ?? '18:00')
      : null

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_publications').insert({
      workspace_id: session.workspaceId,
      platform: parsed.data.platform,
      channel_id: parsed.data.channelId ?? null,
      route: 'manual',
      status: scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: scheduledAt,
      created_by: session.userId,
    }).select('id, status').single()

    return data ? ok(data) : fail('INTERNAL', '게시 항목을 만들지 못했습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}
