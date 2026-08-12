// lib/ci/queries/success-evidence.ts — "잘 된 방식" 근거 수집 (서버 전용)
//
// 편집점 제안이 조언이 아니라 **근거 있는 지시**가 되려면,
// 우리가 실제로 모은 잘된 콘텐츠에서 숫자를 꺼내 와야 한다.
// 근거가 없으면 없다고 말한다 — 그럴듯한 일반론으로 채우지 않는다.

import { createAdminClient } from '@/lib/supabase/server'
import { OUTLIER_MIN_BASELINE } from '../format/metrics.ts'
import { CREATIVE_MIN_INDEX } from '../jobs/stages.ts'
import type { SuccessEvidence } from '../production/edit-points.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 중앙값. 빈 배열이면 null — 0으로 위장하지 않는다. */
export function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid]
}

/** 많이 나온 순으로 상위 N개. */
export function topByCount(values: (string | null)[], limit = 3): string[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (!v) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k)
}

/**
 * 이 워크스페이스가 지금까지 모은 "통한 방식"을 모은다.
 * 기준은 크리에이티브 분석과 같다 — 평소 대비 1.5배를 넘긴 것만 잘 된 것으로 본다.
 */
export async function getSuccessEvidence(workspaceId: string): Promise<SuccessEvidence> {
  const adminClient = createAdminClient() as any

  const { data: hot } = await adminClient
    .from('ci_content_derived')
    .select('content_id, outlier_index, ci_contents!inner(workspace_id, deleted_at, duration_sec)')
    .eq('ci_contents.workspace_id', workspaceId)
    .is('ci_contents.deleted_at', null)
    .gte('outlier_index', CREATIVE_MIN_INDEX)
    .gte('outlier_baseline_n', OUTLIER_MIN_BASELINE)
    .order('outlier_index', { ascending: false })
    .limit(100)

  const rows = (hot ?? []) as { content_id: string; ci_contents: { duration_sec: number | null } }[]
  const ids = rows.map((r) => r.content_id)

  const [creativeRes, patternRes] = await Promise.all([
    ids.length > 0
      ? adminClient.from('ci_content_creative').select('hook_type').in('content_id', ids)
      : Promise.resolve({ data: [] }),
    adminClient.from('ci_patterns')
      .select('statement').eq('workspace_id', workspaceId).eq('is_archived', false)
      .order('lift', { ascending: false }).limit(5),
  ])

  const hookTypes = ((creativeRes.data ?? []) as { hook_type: string | null }[]).map((r) => r.hook_type)
  const durations = rows
    .map((r) => r.ci_contents?.duration_sec)
    .filter((v): v is number => typeof v === 'number')

  return {
    medianDurationSec: median(durations),
    topHookTypes: topByCount(hookTypes),
    patternStatements: ((patternRes.data ?? []) as { statement: string }[]).map((r) => r.statement),
    sampleSize: rows.length,
  }
}
