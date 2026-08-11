// lib/ci/queries/channel-contents.ts — 채널 게시물 조회 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import { formatOutlier, formatPercentile } from '../format/metrics.ts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import type { CiContentListItem } from '../contracts.ts'
import type { CiComparability, CiConfidence, CiIngestStatus, CiPlatform } from '../types.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  ci_topics: { id: string; name: string } | null
  ci_content_derived: {
    outlier_index: number | null
    outlier_baseline_n: number | null
    topic_percentile: number | null
    confidence: CiConfidence | null
  } | null
}

export async function listChannelContents(
  workspaceId: string,
  channelId: string,
  limit = 50,
): Promise<CiContentListItem[]> {
  const adminClient = createAdminClient() as any
  const { data, count } = await adminClient
    .from('ci_contents')
    .select(`
      id, platform, title, thumbnail_url, canonical_url, ingest_status, completeness,
      missing_fields, topic_confidence, comparability_class, published_at, first_seen_at,
      ci_topics ( id, name ),
      ci_content_derived ( outlier_index, outlier_baseline_n, topic_percentile, confidence )
    `, { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('first_seen_at', { ascending: false })
    .limit(limit)

  const population = count ?? 0

  return ((data ?? []) as Row[]).map((row) => {
    const d = row.ci_content_derived
    return {
      id: row.id,
      platform: row.platform,
      title: row.title,
      thumbnailUrl: row.thumbnail_url,
      channelId,
      channelName: null,
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
  })
}
