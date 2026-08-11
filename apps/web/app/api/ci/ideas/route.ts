import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { listIdeas, buildEvidenceBadge } from '@/lib/ci/queries/ideas'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  title: z.string().trim().min(1).max(200),
  topicId: z.string().uuid().nullable().optional(),
  note: z.string().max(4000).optional(),
  targetPlatforms: z.array(z.enum(['youtube','tiktok','instagram','facebook','x','threads'])).default([]),
  evidence: z.array(z.object({
    sourceType: z.enum(['content','pattern','signal']),
    sourceId: z.string().uuid(),
  })).default([]),
})

export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error
    return ok(await listIdeas(session.workspaceId))
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
    const { data: idea, error: insErr } = await adminClient.from('ci_ideas').insert({
      workspace_id: session.workspaceId,
      topic_id: parsed.data.topicId ?? null,
      title: parsed.data.title,
      note: parsed.data.note ?? null,
      target_platforms: parsed.data.targetPlatforms,
      stage: 'idea',
      created_by: session.userId,
    }).select('id').single()

    if (insErr || !idea) return fail('INTERNAL', '아이디어를 만들지 못했습니다')

    // 빵부스러기 — 어디서 왔는지 끊기지 않게 근거를 함께 저장한다
    if (parsed.data.evidence.length > 0) {
      await adminClient.from('ci_idea_evidence').insert(
        parsed.data.evidence.map((e) => ({
          idea_id: idea.id, source_type: e.sourceType, source_id: e.sourceId,
        })),
      )
    }

    return ok({
      id: idea.id,
      stage: 'idea',
      evidenceBadge: buildEvidenceBadge(parsed.data.evidence.map((e) => e.sourceType)),
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
