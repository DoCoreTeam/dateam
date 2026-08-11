import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { parseContentUrl } from '@/lib/ci/ucm/url'
import { enqueueJob } from '@/lib/ci/jobs/queue'
import type { CiIngestAccepted, CiIngestRejected } from '@/lib/ci/contracts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한 번에 받을 수 있는 링크 수 — 무제한이면 한 요청이 큐를 독점한다 */
const MAX_URLS = 50

const Body = z.object({
  urls: z.array(z.string().min(1)).min(1).max(MAX_URLS),
  source: z.enum(['inbox', 'monitoring']).default('inbox'),
  topicId: z.string().uuid().optional(),
})

/**
 * 링크 투입 — 전역 추가·모바일 공유 시트·어시스턴트가 모두 쓰는 단일 입구.
 *
 * 동기 처리하지 않는다. 행을 만들고 잡을 걸고 즉시 반환한다.
 * (설계서 §11.1이 지목한 1차 실패의 직접 원인이 요청 경로 동기 처리였다)
 */
export async function POST(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Body.safeParse(await req.json())
    if (!parsed.success) {
      return fail('VALIDATION_FAILED', '링크를 확인해 주세요', parsed.error.issues)
    }
    const { urls, source, topicId } = parsed.data
    const adminClient = createAdminClient() as any

    const accepted: CiIngestAccepted[] = []
    const rejected: CiIngestRejected[] = []

    for (const raw of urls) {
      const parsedUrl = parseContentUrl(raw)
      if (!parsedUrl) {
        rejected.push({
          url: raw,
          code: raw.trim().startsWith('http') ? 'UNSUPPORTED_PLATFORM' : 'INVALID_URL',
          message: '유튜브, 틱톡, 인스타, 페북, X, 스레드 링크만 받을 수 있습니다',
        })
        continue
      }

      // 이미 있는 콘텐츠면 새로 만들지 않고 재수집만 건다
      const { data: existing } = await adminClient
        .from('ci_contents')
        .select('id')
        .eq('workspace_id', session.workspaceId)
        .eq('platform', parsedUrl.platform)
        .eq('external_id', parsedUrl.externalId)
        .is('deleted_at', null)
        .maybeSingle()

      let contentId: string | null = existing?.id ?? null

      if (!contentId) {
        const { data: created, error: insertErr } = await adminClient
          .from('ci_contents')
          .insert({
            workspace_id: session.workspaceId,
            platform: parsedUrl.platform,
            external_id: parsedUrl.externalId,
            canonical_url: parsedUrl.canonicalUrl,
            format: parsedUrl.formatHint ?? 'long',
            source,
            topic_id: topicId ?? null,
            ingest_status: 'queued',
            created_by: session.userId,
          })
          .select('id')
          .single()

        if (insertErr || !created) {
          rejected.push({ url: raw, code: 'DUPLICATE', message: '이미 담은 링크입니다' })
          continue
        }
        contentId = created.id
      }

      // 재수집이면 버전을 올려 멱등키를 새로 만든다
      const version = existing ? Date.now() : 1
      const { jobId } = await enqueueJob({
        workspaceId: session.workspaceId,
        stage: 'ingest',
        targetType: 'content',
        targetId: contentId!,
        payload: { url: parsedUrl.canonicalUrl },
        version,
      })

      accepted.push({ url: raw, contentId: contentId!, jobId: jobId ?? '', status: 'queued' })
    }

    return ok({ accepted, rejected })
  } catch (e) {
    return failUnexpected(e)
  }
}
