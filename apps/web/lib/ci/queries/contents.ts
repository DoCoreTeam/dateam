// lib/ci/queries/contents.ts — 콘텐츠 목록 조회와 목록 아이템 변환 (서버 전용)
// 문장형 지표는 여기서 완성해 내려보낸다. 클라이언트가 다시 포맷하지 않는다.

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { formatOutlier, formatPercentile } from '../format/metrics.ts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import type { CiContentListItem } from '../contracts.ts'
import type { CiComparability, CiConfidence, CiContentFormat, CiIngestStatus, CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELECT = `
  id, platform, title, thumbnail_url, canonical_url, ingest_status, completeness,
  missing_fields, topic_confidence, comparability_class, published_at, first_seen_at,
  channel_id,
  ci_channels ( id, display_name ),
  ci_topics ( id, name ),
  ci_content_derived ( outlier_index, outlier_baseline_n, topic_percentile, confidence )
`

interface Row {
  id: string
  platform: CiPlatform
  title: string | null
  thumbnail_url: string | null
  canonical_url: string
  ingest_status: CiIngestStatus
  completeness: number | null
  missing_fields: string[] | null
  topic_confidence: number | null
  comparability_class: CiComparability | null
  published_at: string | null
  first_seen_at: string
  channel_id: string | null
  ci_channels: { id: string; display_name: string } | null
  ci_topics: { id: string; name: string } | null
  ci_content_derived: {
    outlier_index: number | null
    outlier_baseline_n: number | null
    topic_percentile: number | null
    confidence: CiConfidence | null
  } | null
}

/**
 * 목록 아이템으로 변환한다.
 * population은 백분위 표시 가능 여부 판정에 필요하다 — 호출자가 모집단 크기를 넘긴다.
 */
export function toListItem(row: Row, population: number): CiContentListItem {
  const d = row.ci_content_derived
  return {
    id: row.id,
    platform: row.platform,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    channelId: row.channel_id,
    channelName: row.ci_channels?.display_name ?? null,
    canonicalUrl: row.canonical_url,
    ingestStatus: row.ingest_status,
    completeness: row.completeness,
    missingFields: row.missing_fields ?? [],
    topic: row.ci_topics ? { id: row.ci_topics.id, name: row.ci_topics.name } : null,
    topicConfidence: row.topic_confidence,
    outlierText: formatOutlier(d?.outlier_index ?? null, d?.outlier_baseline_n ?? 0),
    percentileText: formatPercentile(d?.topic_percentile ?? null, population),
    comparability: row.comparability_class,
    confidence: d?.confidence ?? 'insufficient',
    publishedAtText: row.published_at ? formatKstDateTimeShort(row.published_at) : null,
    firstSeenAt: row.first_seen_at,
  }
}

export interface ContentListParams {
  workspaceId: string
  /** 'all' | 'review' | 'failed' — 수집함 탭 */
  tab?: 'all' | 'review' | 'failed'
  /** 통계 코퍼스만 볼지 (트렌드) */
  corpusOnly?: boolean
  topicId?: string | null
  platform?: CiPlatform | null
  format?: CiContentFormat | null
  windowDays?: number
  /**
   * 기간 창을 무엇에 걸지.
   * - 'published'(기본): 게시일. 시장 최신성이 기준인 트렌드용.
   * - 'discovered': 발견 시각. "나에게 새로 들어온 것"이 기준인 홈 브리핑용.
   *
   * 홈 미니맵 건수도 발견 시각으로 세므로, 브리핑을 게시일로 거르면
   * 게시일을 확보하지 못한 콘텐츠에서 "숫자는 2인데 목록은 0"이 된다.
   */
  windowBasis?: 'published' | 'discovered'
  sort?: 'outlier' | 'recent' | 'velocity'
  limit: number
  cursor?: string | null
}

export interface ContentListResult {
  items: CiContentListItem[]
  total: number
  cursor: string | null
  population: number
}

export async function listContents(p: ContentListParams): Promise<ContentListResult> {
  const adminClient = createAdminClient() as any

  let q = adminClient
    .from('ci_contents')
    .select(SELECT, { count: 'exact' })
    .eq('workspace_id', p.workspaceId)
    .is('deleted_at', null)

  if (p.corpusOnly) {
    q = q.eq('source', CORPUS_FILTER.source)
      .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
  }
  if (p.tab === 'review') q = q.eq('review_state', 'pending')
  if (p.tab === 'failed') q = q.in('ingest_status', ['failed', 'partial'])
  if (p.topicId) q = q.eq('topic_id', p.topicId)
  if (p.platform) q = q.eq('platform', p.platform)
  if (p.format) q = q.eq('format', p.format)

  if (p.windowDays) {
    const since = new Date(Date.now() - p.windowDays * 86400_000).toISOString()
    if (p.windowBasis === 'discovered') {
      q = q.gte('first_seen_at', since)
    } else {
      // 게시일을 확보하지 못한 콘텐츠(oembed 폴백 등)를 조용히 떨어뜨리지 않는다.
      // 시장 최신성 기준이므로 게시일이 있으면 그것으로 거르고, 없으면 발견 시각으로 대신 본다.
      q = q.or(`published_at.gte.${since},and(published_at.is.null,first_seen_at.gte.${since})`)
    }
  }

  // 정렬. 배수순은 파생 테이블 기준이라 조인 정렬을 쓴다.
  if (p.sort === 'outlier') {
    q = q.order('outlier_index', { ascending: false, foreignTable: 'ci_content_derived', nullsFirst: false })
  } else if (p.sort === 'velocity') {
    q = q.order('velocity_per_hour', { ascending: false, foreignTable: 'ci_content_derived', nullsFirst: false })
  } else {
    q = q.order('first_seen_at', { ascending: false })
  }

  const offset = p.cursor ? Number(p.cursor) : 0
  const start = Number.isFinite(offset) && offset > 0 ? offset : 0
  q = q.range(start, start + p.limit - 1)

  const { data, count } = await q
  const rows = (data ?? []) as Row[]
  const total = count ?? rows.length
  const population = p.corpusOnly ? total : 0

  const nextOffset = start + rows.length
  return {
    items: rows.map((r) => toListItem(r, population)),
    total,
    cursor: nextOffset < total ? String(nextOffset) : null,
    population,
  }
}
