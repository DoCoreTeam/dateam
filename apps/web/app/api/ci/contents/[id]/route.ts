import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { toListItem } from '@/lib/ci/queries/contents'
import { getCreative } from '@/lib/ci/queries/creative'
import { getLatestMetrics } from '@/lib/ci/queries/metrics'
import { allowsAssertiveNarrative, formatDuration } from '@/lib/ci/format/metrics'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT = `
  id, platform, title, caption, keywords, duration_sec, language,
  thumbnail_url, canonical_url, ingest_status, completeness,
  missing_fields, topic_confidence, comparability_class, published_at, first_seen_at,
  content_group_id, provenance, channel_id,
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
    const [creative, metrics] = await Promise.all([
      getCreative(session.workspaceId, id),
      getLatestMetrics(id),
    ])

    return ok({
      ...base,
      caption: row.caption ?? null,
      // Slice 1에는 AI 분석 서술이 없다. 근거가 충분해도 지어내지 않는다(설계서 §7.4).
      // AI 서술이 붙는 시점에도 이 게이트를 통과한 경우에만 단정 문구를 허용한다.
      analysis: null,
      analysisAllowed: allowsAssertiveNarrative(base.confidence),
      // "왜 터졌나"는 지어낸 서술이 아니라 관측한 요소다 — 위 게이트와 무관하게 있으면 준다.
      creative,
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
