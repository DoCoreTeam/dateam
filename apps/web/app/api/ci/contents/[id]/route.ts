import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { toListItem } from '@/lib/ci/queries/contents'
import { getCreative } from '@/lib/ci/queries/creative'
import { getMedia } from '@/lib/ci/queries/media'
import { getLatestMetrics } from '@/lib/ci/queries/metrics'
import { getDiscoveriesForContent } from '@/lib/ci/queries/discovery-evidence'
import { allowsAssertiveNarrative, formatDuration } from '@/lib/ci/format/metrics'
import { deleteCiEntity } from '@/lib/ci/queries/delete'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT = `
  id, platform, title, caption, keywords, duration_sec, language,
  thumbnail_url, canonical_url, ingest_status, completeness,
  missing_fields, topic_confidence, comparability_class, published_at, first_seen_at,
  content_group_id, provenance, channel_id, is_stat_excluded,
  ci_channels ( display_name ),
  ci_topics ( id, name ),
  ci_content_derived ( outlier_index, outlier_baseline_n, topic_percentile, confidence )
`

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const { id } = await ctx.params
    const adminClient = createAdminClient() as any

    const { data: row } = await adminClient
      .from('ci_contents').select(SELECT)
      .eq('id', id).eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .maybeSingle()

    if (!row) return fail('NOT_FOUND', '콘텐츠를 찾을 수 없습니다')

    // 백분위 표시 판정을 위해 같은 주제 모집단 크기를 센다
    let population = 0
    if (row.ci_topics?.id) {
      const { count } = await adminClient
        .from('ci_contents').select('id', { count: 'exact', head: true })
        .eq('workspace_id', session.workspaceId).eq('topic_id', row.ci_topics.id)
        .eq('source', 'monitoring').eq('is_stat_excluded', false).is('deleted_at', null)
      population = count ?? 0
    }

    const base = toListItem(row, population)

    // 같은 소재 묶음
    let groupSiblings: { id: string; platform: string; title: string | null }[] = []
    if (row.content_group_id) {
      const { data: sibs } = await adminClient
        .from('ci_contents').select('id, platform, title')
        .eq('content_group_id', row.content_group_id).neq('id', id).is('deleted_at', null).limit(20)
      groupSiblings = sibs ?? []
    }

    const provenance = (row.provenance ?? {}) as Record<string, unknown>
    const [creative, media, metrics, discoveries] = await Promise.all([
      getCreative(session.workspaceId, id),
      // 영상 실체 — 숏폼에서는 이것이 사실상 유일한 본문이다
      getMedia(session.workspaceId, id),
      getLatestMetrics(id),
      // "이 게시물이 무엇의 근거였나" — 상세가 원본 덤프로 끝나던 자리다.
      // 인덱스 idx_ci_discovery_evidence_content 가 이 조회를 위해 이미 있었다.
      getDiscoveriesForContent(session.workspaceId, id),
    ])

    return ok({
      ...base,
      caption: row.caption ?? null,
      // 통계 제외 여부 — 화면이 현재 상태를 알아야 토글을 정확히 그린다.
      // 예전엔 안 내려줘서 "빼기는 되는데 빠졌는지 모르는" 상태였다.
      isStatExcluded: Boolean(row.is_stat_excluded),
      // Slice 1에는 AI 분석 서술이 없다. 근거가 충분해도 지어내지 않는다(설계서 §7.4).
      // AI 서술이 붙는 시점에도 이 게이트를 통과한 경우에만 단정 문구를 허용한다.
      analysis: null,
      analysisAllowed: allowsAssertiveNarrative(base.confidence),
      // 지어낸 서술이 아니라 **관측을 근거로 승격된 발견**이다 — 위 게이트와 무관하게 있으면 준다.
      discoveries,
      // "왜 터졌나"는 지어낸 서술이 아니라 관측한 요소다 — 위 게이트와 무관하게 있으면 준다.
      creative,
      media,
      // 메타 정보 — 상세는 "무엇을 근거로 이 판단이 나왔나"를 보여주는 자리다.
      keywords: (row.keywords ?? []) as string[],
      durationText: formatDuration(row.duration_sec),
      language: row.language ?? null,
      metrics,
      groupSiblings,
      provenanceMethod: typeof provenance.method === 'string' ? provenance.method : null,
      fetchedAt: typeof provenance.fetchedAt === 'string' ? provenance.fetchedAt : null,
    })
  } catch (e) {
    return failUnexpected(e)
  }
}

/**
 * 제목만 고친다.
 *
 * ⚠️ **다른 필드를 여기에 얹지 않는다.** 주제와 통계 제외는 전용 경로가 따로 있고,
 *    그 경로들은 단순 갱신이 아니라 **정정 이력(`ci_corrections`)을 남기고 재분류에 반영**한다:
 *      · 주제      → `POST /api/ci/contents/[id]/topic`
 *                    (topic_source='user' · topic_confidence · review_state까지 함께 바꾼다)
 *      · 통계 제외 → `POST /api/ci/contents/[id]/exclude` (제외 사유를 남긴다)
 *    여기서 같은 컬럼을 건드리면 **그 부수효과를 조용히 건너뛴 두 번째 경로**가 생긴다.
 *    (실제로 v0.7.494에서 그렇게 만들었다가 v0.7.496에서 되돌렸다)
 *
 * ⚠️ **수집값(조회수·게시일·채널·플랫폼)은 열지 않는다.** 그 값들은 지표의 근거라
 *    손으로 고치는 순간 배수와 백분위가 거짓이 된다. 잘못 수집된 것은 고치는 게 아니라
 *    **다시 수집하거나(retry) 지운다(DELETE)**.
 *    (설계 근거: docs/2026-08-16-ci-crud-audit/AUDIT.md §5)
 */
const Patch = z.object({
  title: z.string().trim().min(1).max(500),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const parsed = Patch.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const adminClient = createAdminClient() as any
    const { data } = await adminClient.from('ci_contents')
      .update({ title: parsed.data.title })
      .eq('id', id).eq('workspace_id', session.workspaceId)
      .select('id, title').maybeSingle()

    return data ? ok(data) : fail('NOT_FOUND', '게시물을 찾을 수 없습니다')
  } catch (e) {
    return failUnexpected(e)
  }
}

/** 진짜로 지운다. 되돌릴 수 없다 — 지표 기록·분석 결과·보드 항목이 함께 사라진다. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const { id } = await ctx.params
    const res = await deleteCiEntity('content', id, session.workspaceId) // x
    if (!res.ok) return fail(res.code ?? 'INTERNAL', res.errorMessage ?? '지우지 못했습니다')
    if (res.deleted === 0) return fail('NOT_FOUND', '게시물을 찾을 수 없습니다')
    return ok({ id, deleted: res.deleted })
  } catch (e) {
    return failUnexpected(e)
  }
}
