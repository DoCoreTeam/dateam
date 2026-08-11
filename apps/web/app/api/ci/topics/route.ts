import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({ name: z.string().trim().min(1).max(40) })

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_topics')
      .select('id, name, slug').eq('workspace_id', session.workspaceId)
      .is('deleted_at', null).is('merged_into_id', null).order('name')
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
    if (!parsed.success) return fail('VALIDATION_FAILED', '주제 이름을 확인해 주세요', parsed.error.issues)
    const adminClient = createAdminClient() as any
    const { data, error: insErr } = await adminClient.from('ci_topics').insert({
      workspace_id: session.workspaceId,
      name: parsed.data.name,
      slug: parsed.data.name.toLowerCase().replace(/\s+/g, '-'),
    }).select('id, name').single()
    if (insErr) return fail('CONFLICT', '같은 이름의 주제가 이미 있습니다')
    return ok(data)
  } catch (e) {
    return failUnexpected(e)
  }
}
