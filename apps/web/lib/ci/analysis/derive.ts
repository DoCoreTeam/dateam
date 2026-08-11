// lib/ci/analysis/derive.ts — 파생값 계산의 DB 어댑터 (서버 전용)
// 계산 규칙은 outlier.ts(순수)가 갖고, 여기서는 데이터만 모아 넘긴다.

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { computeAll, type VelocityPoint } from './outlier.ts'
import type { CiComparability } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 배수 비교군 크기 — 같은 채널·같은 포맷 최근 N개 (설계서 §4.3) */
const BASELINE_WINDOW = 20

/** 백분위 모집단 상한 — 너무 큰 창은 쿼리를 무겁게 만든다 */
const POPULATION_LIMIT = 500

async function latestViews(adminClient: any, contentId: string): Promise<number | null> {
  const { data } = await adminClient
    .from('ci_content_metrics')
    .select('views')
    .eq('content_id', contentId)
    .order('captured_at', { ascending: false })
    .limit(1)
  return data?.[0]?.views ?? null
}

/**
 * 한 콘텐츠의 파생값을 계산해 저장한다.
 * 계산에 실패해도 예외를 던지지 않는다 — 파생값이 없는 것은 화면이 '—'로 정직하게 표시한다.
 */
export async function computeDerived(contentId: string): Promise<void> {
  const adminClient = createAdminClient() as any

  const { data: content } = await adminClient
    .from('ci_contents')
    .select('id, workspace_id, channel_id, platform, format, topic_id, completeness, comparability_class, published_at, source, is_stat_excluded')
    .eq('id', contentId)
    .maybeSingle()

  if (!content) return

  const windowDays = 28

  // 1) 대상 조회수
  const views = await latestViews(adminClient, contentId)

  // 2) 비교군 — 같은 채널·같은 포맷 최근 20개 (자기 자신 제외)
  let baselineViews: number[] = []
  if (content.channel_id) {
    const { data: siblings } = await adminClient
      .from('ci_contents')
      .select('id')
      .eq('workspace_id', content.workspace_id)
      .eq('channel_id', content.channel_id)
      .eq('format', content.format)
      .eq('source', CORPUS_FILTER.source)
      .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
      .is('deleted_at', null)
      .neq('id', contentId)
      .order('published_at', { ascending: false })
      .limit(BASELINE_WINDOW)

    const ids = (siblings ?? []).map((s: { id: string }) => s.id)
    if (ids.length > 0) {
      const { data: metrics } = await adminClient
        .from('ci_content_metrics')
        .select('content_id, views, captured_at')
        .in('content_id', ids)
        .order('captured_at', { ascending: false })

      // 콘텐츠별 최신 스냅샷 1개씩만 쓴다
      const seen = new Set<string>()
      baselineViews = (metrics ?? [])
        .filter((m: { content_id: string; views: number | null }) => {
          if (seen.has(m.content_id) || m.views == null) return false
          seen.add(m.content_id)
          return true
        })
        .map((m: { views: number }) => m.views)
    }
  }

  // 3) 주제 모집단 — 같은 주제·플랫폼·포맷·기간 창
  let topicPopulation: number[] = []
  if (content.topic_id) {
    const since = new Date(Date.now() - windowDays * 86400_000).toISOString()
    const { data: peers } = await adminClient
      .from('ci_contents')
      .select('id')
      .eq('workspace_id', content.workspace_id)
      .eq('topic_id', content.topic_id)
      .eq('platform', content.platform)
      .eq('format', content.format)
      .eq('source', CORPUS_FILTER.source)
      .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
      .is('deleted_at', null)
      .gte('published_at', since)
      .limit(POPULATION_LIMIT)

    const ids = (peers ?? []).map((p: { id: string }) => p.id)
    if (ids.length > 0) {
      const { data: metrics } = await adminClient
        .from('ci_content_metrics')
        .select('content_id, views, captured_at')
        .in('content_id', ids)
        .order('captured_at', { ascending: false })

      const seen = new Set<string>()
      topicPopulation = (metrics ?? [])
        .filter((m: { content_id: string; views: number | null }) => {
          if (seen.has(m.content_id) || m.views == null) return false
          seen.add(m.content_id)
          return true
        })
        .map((m: { views: number }) => m.views)
    }
  }

  // 4) 속도용 스냅샷
  const { data: snaps } = await adminClient
    .from('ci_content_metrics')
    .select('captured_at, views')
    .eq('content_id', contentId)
    .order('captured_at', { ascending: true })
    .limit(50)

  const derived = computeAll({
    views,
    baselineViews,
    topicPopulation,
    snapshots: (snaps ?? []) as VelocityPoint[],
    completeness: Number(content.completeness ?? 0),
    comparability: (content.comparability_class ?? null) as CiComparability | null,
  })

  await adminClient.from('ci_content_derived').upsert({
    content_id: contentId,
    outlier_index: derived.outlierIndex,
    outlier_baseline_n: derived.outlierBaselineN,
    topic_percentile: derived.topicPercentile,
    velocity_per_hour: derived.velocityPerHour,
    confidence: derived.confidence,
    window_days: windowDays,
    sample_json: {
      baselineSize: baselineViews.length,
      population: topicPopulation.length,
      snapshots: (snaps ?? []).length,
      excluded: [
        { reason: '수집함 단건(통계 제외)', count: 0 },
      ],
    },
    computed_at: new Date().toISOString(),
  }, { onConflict: 'content_id' })
}
