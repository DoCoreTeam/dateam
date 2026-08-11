import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { generateBriefDraft } from '@/lib/ci/ai/brief-server'
import type { BriefDraft } from '@/lib/ci/ai/brief'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  fields: z.array(z.enum(['titleOptions','hook','script','caption','tags','thumbnailIdeas'])).min(1),
})

/**
 * 부분 재생성. 요청한 필드만 다시 만들고 나머지는 사용자가 고친 내용을 그대로 둔다.
 * 전체를 덮어써서 사용자의 편집을 날리지 않는다.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '다시 만들 항목을 선택해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data: brief } = await adminClient.from('ci_briefs')
      .select('id, idea_id, title_options, hook, script, caption, tags, thumbnail_specs')
      .eq('id', id).eq('workspace_id', session.workspaceId).maybeSingle()
    if (!brief) return fail('NOT_FOUND', '기획안을 찾을 수 없습니다')

    const base: BriefDraft = {
      titleOptions: brief.title_options ?? [],
      hook: brief.hook ?? '',
      script: brief.script ?? '',
      caption: brief.caption ?? '',
      tags: brief.tags ?? [],
      thumbnailIdeas: brief.thumbnail_specs?.ideas ?? [],
    }

    const result = await generateBriefDraft({
      workspaceId: session.workspaceId,
      ideaId: brief.idea_id,
      fields: parsed.data.fields as (keyof BriefDraft)[],
      base,
    })
    if (!result.ok) return fail('AI_BUDGET_EXCEEDED', result.error)

    // 미리보기로 돌려준다. 저장은 사용자가 확인한 뒤 PATCH로 한다(자동 확정 저장 금지).
    return ok({ preview: result.draft, fields: parsed.data.fields })
  } catch (e) {
    return failUnexpected(e)
  }
}
