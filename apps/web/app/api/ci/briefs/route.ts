import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { generateBriefDraft } from '@/lib/ci/ai/brief-server'
import { EMPTY_BRIEF } from '@/lib/ci/ai/brief'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({
  ideaId: z.string().uuid(),
  /** 비우면 빈 기획안을 만든다(AI 없이 직접 쓰기) */
  useAi: z.boolean().default(true),
  fields: z.array(z.enum(['titleOptions','hook','script','caption','tags','thumbnailIdeas'])).optional(),
})

export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data: idea } = await adminClient.from('ci_ideas')
      .select('id, title, note, topic_id, target_platforms')
      .eq('id', parsed.data.ideaId).eq('workspace_id', session.workspaceId).maybeSingle()
    if (!idea) return fail('NOT_FOUND', '아이디어를 찾을 수 없습니다')

    let draft = EMPTY_BRIEF
    let aiNote: string | null = null

    if (parsed.data.useAi) {
      const result = await generateBriefDraft({
        workspaceId: session.workspaceId,
        ideaId: idea.id,
        fields: parsed.data.fields,
      })
      if (result.ok) draft = result.draft
      else aiNote = result.error
    }

    const { data: last } = await adminClient.from('ci_briefs')
      .select('version').eq('idea_id', idea.id).order('version', { ascending: false }).limit(1)
    const version = ((last?.[0]?.version as number) ?? 0) + 1

    const { data: created, error: insErr } = await adminClient.from('ci_briefs').insert({
      workspace_id: session.workspaceId,
      idea_id: idea.id,
      version,
      title_options: draft.titleOptions,
      hook: draft.hook || null,
      script: draft.script || null,
      caption: draft.caption || null,
      tags: draft.tags,
      thumbnail_specs: { ideas: draft.thumbnailIdeas },
      status: 'draft',
      generated_by: parsed.data.useAi && !aiNote ? 'ai' : 'user',
      created_by: session.userId,
    }).select('id, version').single()

    if (insErr || !created) return fail('INTERNAL', '기획안을 만들지 못했습니다')

    // 아이디어를 기획 단계로 올린다 — 흐름이 끊기지 않게
    await adminClient.from('ci_ideas').update({ stage: 'brief' }).eq('id', idea.id)

    return ok({ id: created.id, version: created.version, aiNote })
  } catch (e) {
    return failUnexpected(e)
  }
}
