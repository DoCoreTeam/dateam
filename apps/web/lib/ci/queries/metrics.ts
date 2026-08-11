// lib/ci/queries/metrics.ts — 최신 지표 스냅샷 조회 (서버 전용)
//
// ci_content_metrics는 append-only 스냅샷이다. 화면이 "지금 조회수"를 물으면
// 가장 최근 스냅샷을 준다. 문장은 서버가 완성한다(§4.3) — 클라이언트가 다시 포맷하지 않는다.

import { createAdminClient } from '@/lib/supabase/server'
import { formatCount } from '../format/metrics.ts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CiMetricsSnapshot {
  viewsText: string | null
  likesText: string | null
  commentsText: string | null
  capturedAtText: string | null
  /** 어떤 경로로 얻었는지 — 화면이 근거를 밝힐 수 있게 */
  sourceMethod: string | null
  isEstimated: boolean
}

export async function getLatestMetrics(contentId: string): Promise<CiMetricsSnapshot | null> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_content_metrics')
    .select('views, likes, comments, captured_at, source_method, is_estimated')
    .eq('content_id', contentId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return {
    viewsText: formatCount(data.views),
    likesText: formatCount(data.likes),
    commentsText: formatCount(data.comments),
    capturedAtText: data.captured_at ? formatKstDateTimeShort(data.captured_at) : null,
    sourceMethod: data.source_method ?? null,
    isEstimated: Boolean(data.is_estimated),
  }
}
