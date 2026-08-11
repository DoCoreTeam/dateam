import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { parseContentUrl } from '@/lib/ci/ucm/url'
import { enqueueJob } from '@/lib/ci/jobs/queue'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Body = z.object({ url: z.string().trim().min(1) })

/**
 * 게시 URL 기록 → 즉시 추적 시작.
 * 과거에 올린 게시물도 URL만 있으면 소급 추적된다 — 게시 경로와 무관하게 루프가 닫힌다.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '주소를 확인해 주세요', parsed.error.issues)

    const link = parseContentUrl(parsed.data.url)
    if (!link) return fail('VALIDATION_FAILED', '지원하지 않는 주소입니다')

    const adminClient = createAdminClient() as any
    const { data: pub } = await adminClient.from('ci_publications').select('id')
      .eq('id', id).eq('workspace_id', session.workspaceId).maybeSingle()
    if (!pub) return fail('NOT_FOUND', '게시 항목을 찾을 수 없습니다')

    // 이미 수집된 콘텐츠면 재사용한다
    const { data: existing } = await adminClient.from('ci_contents').select('id')
      .eq('workspace_id', session.workspaceId).eq('platform', link.platform)
      .eq('external_id', link.externalId).is('deleted_at', null).maybeSingle()

    let contentId = existing?.id ?? null
    if (!contentId) {
      const { data: created } = await adminClient.from('ci_contents').insert({
        workspace_id: session.workspaceId,
        platform: link.platform,
        external_id: link.externalId,
        canonical_url: link.canonicalUrl,
        format: link.formatHint ?? 'long',
        source: 'monitoring',
        ingest_status: 'queued',
        created_by: session.userId,
      }).select('id').single()
      contentId = created?.id ?? null
    }

    if (!contentId) return fail('INTERNAL', '추적을 시작하지 못했습니다')

    const { jobId } = await enqueueJob({
      workspaceId: session.workspaceId,
      stage: 'ingest', targetType: 'content', targetId: contentId, version: Date.now(),
    })

    await adminClient.from('ci_publications').update({
      published_url: link.canonicalUrl,
      external_content_id: link.externalId,
      tracked_content_id: contentId,
      status: 'published',
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    return ok({ publicationId: id, trackedContentId: contentId, jobId, message: '추적을 시작했습니다' })
  } catch (e) {
    return failUnexpected(e)
  }
}
