import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  briefId: z.string().uuid(),
  variantLabel: z.string().max(60).optional(),
  timecodes: z.array(z.object({
    start: z.string(),
    end: z.string().optional(),
    note: z.string().max(500),
  })).default([]),
})

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    const briefId = new URL(req.url).searchParams.get('briefId')
    if (!briefId) return fail('VALIDATION_FAILED', 'briefId가 필요합니다')
    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_edit_plans')
      .select('id, variant_label, timecodes, export_status, created_at')
      .eq('workspace_id', session.workspaceId).eq('brief_id', briefId)
      .order('created_at', { ascending: false })
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

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_edit_plans').insert({
      workspace_id: session.workspaceId,
      brief_id: parsed.data.briefId,
      variant_label: parsed.data.variantLabel ?? '기본안',
      timecodes: parsed.data.timecodes,
    }).select('id').single()

    return data ? ok(data) : fail('INTERNAL', '편집안을 만들지 못했습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}
