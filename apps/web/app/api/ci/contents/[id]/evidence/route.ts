import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { formatBasis } from '@/lib/ci/format/metrics'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 산출 근거 — 포함 표본, 제외 사유, 수집 방법. 수치가 어디서 왔는지 끝까지 밝힌다. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const { id } = await ctx.params
    const adminClient = createAdminClient() as any

    const { data: content } = await adminClient
      .from('ci_contents')
      .select('id, missing_fields, provenance, ci_content_derived ( window_days, sample_json, outlier_baseline_n )')
      .eq('id', id).eq('workspace_id', session.workspaceId).is('deleted_at', null)
      .maybeSingle()

    if (!content) return fail('NOT_FOUND', '콘텐츠를 찾을 수 없습니다')

    const derived = content.ci_content_derived ?? null
    const sample = (derived?.sample_json ?? {}) as Record<string, unknown>
    const provenance = (content.provenance ?? {}) as Record<string, unknown>
    const windowDays = derived?.window_days ?? 28
    const included = Number(sample.baselineSize ?? 0)

    const excluded: { reason: string; count: number }[] = Array.isArray(sample.excluded)
      ? (sample.excluded as { reason: string; count: number }[])
      : []

    return ok({
      windowDays,
      sampleSize: included,
      basisText: formatBasis(windowDays, included),
      includedCount: included,
      excludedReasons: excluded,
      method: typeof provenance.method === 'string' ? provenance.method : null,
      fetchedAt: typeof provenance.fetchedAt === 'string' ? provenance.fetchedAt : null,
      missingFields: content.missing_fields ?? [],
    })
  } catch (e) {
    return failUnexpected(e)
  }
}
