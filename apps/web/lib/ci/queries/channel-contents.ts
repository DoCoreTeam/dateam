// lib/ci/queries/channel-contents.ts — 채널 게시물 조회 (서버 전용)

import { createAdminClient } from '@/lib/supabase/server'
import { formatOutlier, formatPercentile } from '../format/metrics.ts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { getCreativeMap } from './creative.ts'
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

export interface ChannelContentsPage {
  items: CiContentListItem[]
  /** 이 채널이 가진 전체 건수 — 화면이 "50건 중 50건"이 아니라 진짜 수를 말해야 한다 */
  total: number
}

/**
 * 채널의 게시물 한 페이지.
 *
 * 예전에는 limit 50 고정에 페이지가 없었다. 그래서 114건짜리 채널을 열면
 * **뒤쪽 64건에 화면에서 도달할 방법이 아예 없었다**(실측으로 잡음).
 * 목록 표준(§2-6)대로 페이지를 두고, 총 건수를 함께 돌려준다.
 */
export async function listChannelContents(
  workspaceId: string,
  channelId: string,
  limit = 50,
  offset = 0,
): Promise<ChannelContentsPage> {
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
    .range(offset, offset + limit - 1)

  const population = count ?? 0
  const rows = (data ?? []) as Row[]

  // 채널 상세는 "이 채널에서 뭐가 통했나"를 보는 화면이다 — 떡상 목록과 같은 것을 보여준다.
  const creativeMap = await getCreativeMap(workspaceId, rows.map((r) => r.id))

  const items = rows.map((row) => {
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
      creative: creativeMap[row.id] ?? null,
    }
  })

  return { items, total: population }
}
