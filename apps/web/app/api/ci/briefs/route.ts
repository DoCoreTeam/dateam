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

/** 목록에 한 번에 실을 기획안 수. 고르기용이라 최근 것만 있으면 된다. */
const BRIEF_PICK_LIMIT = 30

/**
 * 기획안 목록 — 편집점을 어디에 붙일지 고르기 위한 최소 조회.
 * 제목이 따로 없어 `title_options[0] → hook` 순으로 표시명을 만든다.
 */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_briefs')
      .select('id, version, hook, title_options, created_at')
      .eq('workspace_id', session.workspaceId)
      .order('created_at', { ascending: false })
      .limit(BRIEF_PICK_LIMIT)

    const items = ((data ?? []) as any[]).map((b) => {
      const first = Array.isArray(b.title_options) ? b.title_options[0] : null
      const label = (typeof first === 'string' && first.trim())
        || (typeof b.hook === 'string' && b.hook.trim())
        || '제목 없는 기획안'
      return { id: b.id as string, label: String(label).slice(0, 80), version: b.version as number }
    })

    return ok(items)
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
