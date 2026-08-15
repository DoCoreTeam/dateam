import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { parseAnyCiUrl } from '@/lib/ci/ucm/url'
import { enqueueJob } from '@/lib/ci/jobs/queue'
import { addChannel } from '@/lib/ci/queries/channels'
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
 * 링크 투입 — 콘텐츠든 프로필이든 채널이든 **하나의 입구**가 받는다.
 *
 * 동기 처리하지 않는다. 행을 만들고 잡을 걸고 즉시 반환한다.
 * (설계서 §11.1이 지목한 1차 실패의 직접 원인이 요청 경로 동기 처리였다)
 *
 * 링크 종류는 `parseAnyCiUrl`(SSOT)이 판별한다. 사용자가 알려주지 않는다.
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
      const link = parseAnyCiUrl(raw)
      if (!link) {
        rejected.push({
          url: raw,
          code: raw.trim().startsWith('http') ? 'UNSUPPORTED_PLATFORM' : 'INVALID_URL',
          message: '유튜브, 틱톡, 인스타, 페북, X, 스레드의 게시물 또는 채널 주소를 넣어 주세요',
        })
        continue
      }

      // ── 채널·프로필 링크 → 그 계정을 등록하고 게시물을 훑는다 ──
      if (link.kind === 'channel') {
        const r = await addChannel({
          workspaceId: session.workspaceId,
          urlOrHandle: link.channel.url,
          topicId: topicId ?? null,
          // 링크를 직접 넣은 것은 "이 계정을 보겠다"는 뜻이다. 지켜보기를 켠다.
          // 플랜 한도에 걸리면 addChannel이 거부하고, 그 이유를 화면이 그대로 말한다.
          monitor: true,
        })
        if (!r.ok) {
          rejected.push({
            url: raw,
            code: r.code === 'PLAN_LIMIT_EXCEEDED' ? 'UNSUPPORTED_PLATFORM' : 'INVALID_URL',
            message: r.message,
          })
          continue
        }
        accepted.push({
          url: raw, kind: 'channel', channelId: r.item.id, contentId: null,
          jobId: '', status: 'queued',
        })
        continue
      }

      // ── 게시물 링크 → 콘텐츠를 담고, **그 계정 전체 훑기를 동반한다** ──
      // 왜 동반하는가: "잘 됨"은 그 계정의 평소 대비로만 정의된다. 형제 게시물이 없으면
      // 비교군이 비어 배수가 영원히 나오지 않고, 배수가 없으면 "왜 잘됐나"도 발화하지 않는다.
      // (실측 사고: 콘텐츠 21건 중 12건만 배수 산출, 그나마 전부 채널 1곳)
      const url = link.content
      const { data: existing } = await adminClient
        .from('ci_contents')
        .select('id')
        .eq('workspace_id', session.workspaceId)
        .eq('platform', url.platform)
        .eq('external_id', url.externalId)
        .is('deleted_at', null)
        .maybeSingle()

      let contentId: string | null = existing?.id ?? null

      if (!contentId) {
        const { data: created, error: insertErr } = await adminClient
          .from('ci_contents')
          .insert({
            workspace_id: session.workspaceId,
            platform: url.platform,
            external_id: url.externalId,
            canonical_url: url.canonicalUrl,
            format: url.formatHint ?? 'long',
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
        // 수집이 끝나 채널을 알아낸 뒤 그 계정을 훑으라는 표식.
        // 여기서 채널을 미리 알 수 없으므로(링크만으로는 모른다) 수집 단계가 이어받는다.
        payload: { url: url.canonicalUrl, sweepChannel: true },
        version,
      })

      accepted.push({
        url: raw, kind: 'content', contentId: contentId!, channelId: null,
        jobId: jobId ?? '', status: 'queued',
      })
    }

    return ok({ accepted, rejected })
  } catch (e) {
    return failUnexpected(e)
  }
}
