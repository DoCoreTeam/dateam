import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { kstWallToIso } from '@/lib/datetime/kst'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 후보를 확정하거나 버린다.
 *
 * **왜 삭제가 아니라 dismissed 인가**: 버린 것을 지우면 다음 훑기에서 같은 주소가
 * 다시 후보로 올라온다(중복 열쇠는 살아 있는 행만 본다). 사람이 이미 «아니다»라고
 * 판단한 것을 매번 다시 보여 주면 그때부터 후보함을 안 본다.
 */
const PatchBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  action: z.enum(['confirm', 'dismiss']),
})

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
      // 사람이 직접 적은 것은 확인이 끝난 것이다 — 자기가 쓴 줄을 다시 확인시키지 않는다
      status: 'confirmed',
      created_by: session.userId,
    }).select('id').single()

    return data ? ok(data) : fail('INTERNAL', '이슈를 등록하지 못했습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function PATCH(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error
    const parsed = PatchBody.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data, error: dbError } = await adminClient
      .from('ci_signals')
      .update({
        status: parsed.data.action === 'confirm' ? 'confirmed' : 'dismissed',
        // 누가 확정했는지 남긴다 — 「이 줄 누가 넣었지」에 답할 수 있어야 근거로 쓸 수 있다
        created_by: session.userId,
      })
      .eq('workspace_id', session.workspaceId)
      // 확인 대기만 바꾼다. 이미 확정된 것을 되돌리는 길은 따로 열지 않는다
      .eq('status', 'candidate')
      .in('id', parsed.data.ids)
      .select('id')

    // supabase-js 는 실패를 던지지 않고 돌려준다. 검사하지 않으면 0건 갱신이 성공으로 보인다.
    if (dbError) return fail('INTERNAL', '이슈를 처리하지 못했습니다', dbError.message)
    return ok({ changed: (data ?? []).length })
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
    // supabase-js 는 실패를 던지지 않고 돌려준다 — 검사하지 않으면 «지웠다»고 답한 뒤 그대로 남는다
    const { error: dbError } = await adminClient
      .from('ci_signals').delete().eq('id', id).eq('workspace_id', session.workspaceId)
    if (dbError) return fail('INTERNAL', '이슈를 삭제하지 못했습니다', dbError.message)
    return ok({ id })
  } catch (e) {
    return failUnexpected(e)
  }
}
