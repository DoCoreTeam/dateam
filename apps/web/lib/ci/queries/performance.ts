// lib/ci/queries/performance.ts — A01 성과 데이터 (서버 전용)
// 설계: 03-screen-a01-performance.md

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { formatBasis, formatOutlier, formatPercentile } from '../format/metrics.ts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { suggestRulePromotions, type RulePromotion } from '../analysis/corrections.ts'
import type { CiConfidence, CiPlatform } from '../types.ts'
import { formatDiscoveryBasis } from '../analysis/discovery.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MinePerfRow {
  id: string
  title: string | null
  platform: CiPlatform
  publishedAtText: string | null
  views: number | null
  outlierText: string | null
  percentileText: string | null
  velocity: number | null
  confidence: CiConfidence
  route: string | null
}

export interface MinePerf {
  rows: MinePerfRow[]
  summary: { published: number; medianOutlier: string | null; best: string | null; tracking: number }
  basisText: string
}

const WINDOW_DAYS = 28

async function latestViewsMap(adminClient: any, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const { data } = await adminClient
    .from('ci_content_metrics').select('content_id, views, captured_at')
    .in('content_id', ids).order('captured_at', { ascending: false })
  for (const m of (data ?? []) as { content_id: string; views: number | null }[]) {
    if (m.views != null && !out.has(m.content_id)) out.set(m.content_id, m.views)
  }
  return out
}

export async function getMinePerformance(workspaceId: string): Promise<MinePerf> {
  const adminClient = createAdminClient() as any

  const { data: owned } = await adminClient
    .from('ci_channels').select('id')
    .eq('workspace_id', workspaceId).eq('ownership', 'owned').is('deleted_at', null)
  const ownedIds = (owned ?? []).map((c: { id: string }) => c.id)

  if (ownedIds.length === 0) {
    return {
      rows: [],
      summary: { published: 0, medianOutlier: null, best: null, tracking: 0 },
      basisText: formatBasis(WINDOW_DAYS, 0),
    }
  }

  const { data, count } = await adminClient
    .from('ci_contents')
    .select(`
      id, title, platform, published_at,
      ci_content_derived ( outlier_index, outlier_baseline_n, topic_percentile, velocity_per_hour, confidence ),
      ci_publications ( route )
    `, { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .in('channel_id', ownedIds)
    .is('deleted_at', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(200)

  const rowsRaw = (data ?? []) as any[]
  const viewsMap = await latestViewsMap(adminClient, rowsRaw.map((r) => r.id))
  const population = count ?? rowsRaw.length

  const rows: MinePerfRow[] = rowsRaw.map((r) => {
    const d = r.ci_content_derived
    return {
      id: r.id,
      title: r.title,
      platform: r.platform,
      publishedAtText: r.published_at ? formatKstDateTimeShort(r.published_at) : null,
      views: viewsMap.get(r.id) ?? null,
      outlierText: formatOutlier(d?.outlier_index ?? null, d?.outlier_baseline_n ?? 0),
      percentileText: formatPercentile(d?.topic_percentile ?? null, population),
      velocity: d?.velocity_per_hour ?? null,
      confidence: (d?.confidence ?? 'insufficient') as CiConfidence,
      route: r.ci_publications?.[0]?.route ?? null,
    }
  })

  const indices = rowsRaw
    .map((r) => r.ci_content_derived)
    .filter((d) => d?.outlier_index != null && (d?.outlier_baseline_n ?? 0) >= 8)
    .map((d) => d.outlier_index as number)
    .sort((a, b) => a - b)

  const median = indices.length
    ? (indices.length % 2 ? indices[(indices.length - 1) / 2]
      : (indices[indices.length / 2 - 1] + indices[indices.length / 2]) / 2)
    : null
  const best = indices.length ? indices[indices.length - 1] : null

  return {
    rows,
    summary: {
      published: rows.length,
      medianOutlier: median != null ? formatOutlier(median, 8) : null,
      best: best != null ? formatOutlier(best, 8) : null,
      tracking: rows.length,
    },
    basisText: formatBasis(WINDOW_DAYS, rows.length),
  }
}

export interface MarketPerf {
  population: number
  insufficient: boolean
  basisText: string
  myBest: string | null
  topPeers: { id: string; title: string | null; outlierText: string | null }[]
}

export async function getMarketPerformance(workspaceId: string): Promise<MarketPerf> {
  const adminClient = createAdminClient() as any

  const { data, count } = await adminClient
    .from('ci_contents')
    .select('id, title, ci_content_derived ( outlier_index, outlier_baseline_n )', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('source', CORPUS_FILTER.source)
    .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
    .is('deleted_at', null)
    .limit(200)

  const rows = (data ?? []) as any[]
  const population = count ?? rows.length

  const ranked = rows
    .filter((r) => r.ci_content_derived?.outlier_index != null
      && (r.ci_content_derived?.outlier_baseline_n ?? 0) >= 8)
    .sort((a, b) => b.ci_content_derived.outlier_index - a.ci_content_derived.outlier_index)
    .slice(0, 10)

  return {
    population,
    insufficient: population < 30,
    basisText: formatBasis(WINDOW_DAYS, population),
    myBest: null,
    topPeers: ranked.map((r) => ({
      id: r.id,
      title: r.title,
      outlierText: formatOutlier(r.ci_content_derived.outlier_index, r.ci_content_derived.outlier_baseline_n),
    })),
  }
}

export interface LearningPerf {
  patterns: { id: string; statement: string; liftText: string | null; confidence: CiConfidence }[]
  corrections: { kind: string; count: number }[]
  /** 반복 정정 → 규칙 승격 제안 (설계서 §11.4). 확정은 사람이 한다. */
  promotions: RulePromotion[]
  slo: { autoConfirmRate: number | null; reviewQueueRate: number | null; total: number }
}

const CORRECTION_LABEL: Record<string, string> = {
  topic: '주제 정정',
  group_unlink: '묶음 해제',
  outlier_dismiss: '이상치 해제',
  channel_link: '채널 연결',
  field_fix: '값 수정',
}

export async function getLearningPerformance(workspaceId: string): Promise<LearningPerf> {
  const adminClient = createAdminClient() as any

  const [{ data: patterns }, { data: corrections }, { data: contents }, { data: topics }] = await Promise.all([
    // 발견(ci_discoveries)을 읽는다. 옛 ci_patterns 는 하드코딩 규칙 7개의 중복이라
    // 전부 보관 처리돼 이 화면도 늘 0건이었다 — 소스를 옮기는 것이 폐기의 첫 단계다(M-4).
    adminClient.from('ci_discoveries')
      .select('id, statement, evidence_count, channel_count')
      .eq('workspace_id', workspaceId).eq('is_archived', false)
      .order('channel_count', { ascending: false })
      .order('evidence_count', { ascending: false }).limit(20),
    adminClient.from('ci_corrections')
      .select('kind, before_value, after_value, created_at')
      .eq('workspace_id', workspaceId).limit(1000),
    adminClient.from('ci_contents').select('topic_source, review_state')
      .eq('workspace_id', workspaceId).is('deleted_at', null).limit(1000),
    adminClient.from('ci_topics').select('id, name')
      .eq('workspace_id', workspaceId).is('deleted_at', null).is('merged_into_id', null),
  ])

  const counts = new Map<string, number>()
  for (const c of (corrections ?? []) as { kind: string }[]) {
    counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1)
  }

  // 반복 정정을 규칙으로 굳힐 후보. 제목은 여기서 쓰지 않으므로 조회하지 않는다.
  const topicNameById = Object.fromEntries(
    ((topics ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]),
  )
  const promotions = suggestRulePromotions(
    ((corrections ?? []) as any[])
      .filter((c) => c.kind === 'topic')
      .map((c) => ({
        title: null,
        fromTopicId: (c.before_value?.topicId as string | null) ?? null,
        toTopicId: (c.after_value?.topicId as string | null) ?? null,
        createdAt: c.created_at,
      })),
    topicNameById,
  )

  const all = (contents ?? []) as { topic_source: string; review_state: string }[]
  const total = all.length
  const auto = all.filter((c) => c.topic_source === 'auto' || c.topic_source === 'ai_verified').length
  const review = all.filter((c) => c.review_state === 'pending').length

  return {
    patterns: ((patterns ?? []) as any[]).map((p) => ({
      id: p.id,
      statement: p.statement,
      // 발견에는 배수가 없다 — 없는 숫자를 만들지 않고 근거의 넓이를 그대로 쓴다
      liftText: formatDiscoveryBasis(p.evidence_count, p.channel_count),
      confidence: (p.channel_count >= 5 ? 'high' : 'medium') as CiConfidence,
    })),
    corrections: Array.from(counts.entries()).map(([kind, count]) => ({
      kind: CORRECTION_LABEL[kind] ?? kind, count,
    })),
    promotions,
    // 표본이 없으면 비율을 만들지 않는다 — 0%는 "완벽하다"로 오독된다
    slo: {
      autoConfirmRate: total > 0 ? Math.round((auto / total) * 100) : null,
      reviewQueueRate: total > 0 ? Math.round((review / total) * 100) : null,
      total,
    },
  }
}
