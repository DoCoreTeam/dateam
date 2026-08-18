// lib/ci/queries/contents.ts — 콘텐츠 목록 조회와 목록 아이템 변환 (서버 전용)
// 문장형 지표는 여기서 완성해 내려보낸다. 클라이언트가 다시 포맷하지 않는다.

import { createAdminClient } from '@/lib/supabase/server'
import { CORPUS_FILTER } from '../corpus.ts'
import { formatOutlier, formatPercentile } from '../format/metrics.ts'
import { getCreativeMap } from './creative.ts'
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
  /** "왜 터졌나"를 함께 붙일지. 떡상 목록처럼 그게 본론인 화면에서만 켠다. */
  withCreative?: boolean
  /**
   * 검색어. 제목·설명뿐 아니라 **영상에서 읽은 대사·화면 자막**까지 함께 찾는다
   * (ci_search_contents RPC, 마이그 212·213).
   *
   * 숏폼은 제목이 짧고 설명문이 비어 있어(실측 423건 중 227건) 제목 검색만으로는
   * 사실상 아무것도 못 찾는다. 대사를 읽어 둔 것이 여기서 값을 한다.
   */
  q?: string | null
  /**
   * 한 채널로 좁힌다. 채널별 보기에서 그룹을 펼 때 쓴다 —
   * 채널 전용 조회를 따로 두면 검색·필터·정렬이 목록과 갈린다
   * (실측: 그룹은 검색으로 좁혔는데 펴 보면 그 채널 전부가 나왔다).
   */
  channelId?: string | null
}

export interface ContentListResult {
  items: CiContentListItem[]
  total: number
  cursor: string | null
  population: number
}

/** 검색어가 걸린 자리를 사람 말로. 화면이 "왜 이게 나왔는지"를 말할 수 있어야 한다. */
export function matchedInLabel(where: string | null): string | null {
  switch (where) {
    case 'title': return '제목'
    case 'caption': return '설명'
    case 'transcript': return '영상 대사'
    case 'on_screen_text': return '화면 자막'
    default: return null
  }
}

export interface SearchHit {
  contentId: string
  matchedIn: string
  snippet: string | null
}

/**
 * 통합 검색. 제목·설명·대사·화면 자막을 한 번에 본다(DB의 ci_search_contents가 SSOT).
 * 같은 게시물이 여러 자리에서 걸리면 **영상 쪽을 앞세운다** — 제목 일치는 사용자가 이미 알고 있고,
 * 대사에서 걸린 것이 새로운 정보다.
 */
const MATCH_PRIORITY: Record<string, number> = {
  transcript: 0, on_screen_text: 1, title: 2, caption: 3,
}

export async function searchContentIds(
  workspaceId: string, query: string, limit = 200,
): Promise<Map<string, SearchHit>> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient.rpc('ci_search_contents', {
    p_workspace_id: workspaceId,
    p_query: query,
    p_limit: limit,
  })

  const out = new Map<string, SearchHit>()
  for (const row of (data ?? []) as { content_id: string; matched_in: string; snippet: string | null }[]) {
    const prev = out.get(row.content_id)
    if (prev && (MATCH_PRIORITY[prev.matchedIn] ?? 9) <= (MATCH_PRIORITY[row.matched_in] ?? 9)) continue
    out.set(row.content_id, {
      contentId: row.content_id, matchedIn: row.matched_in, snippet: row.snippet,
    })
  }
  return out
}

export async function listContents(p: ContentListParams): Promise<ContentListResult> {
  const adminClient = createAdminClient() as any

  // 검색어가 있으면 먼저 후보를 좁힌다. 결과가 0건이면 조회 자체를 하지 않는다 —
  // 빈 in() 필터는 PostgREST에서 전체 조회가 되어 "검색했는데 전부 나오는" 사고가 된다.
  let searchHits: Map<string, SearchHit> | null = null
  if (p.q && p.q.trim()) {
    searchHits = await searchContentIds(p.workspaceId, p.q.trim())
    if (searchHits.size === 0) {
      return { items: [], total: 0, cursor: null, population: 0 }
    }
  }

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
  // 실패는 **진짜 실패**만이다. partial(일부만 확보)을 실패로 세면
  // 댓글 수 하나 못 얻은 것까지 실패로 보여 제품이 고장난 것처럼 보인다.
  if (p.tab === 'failed') q = q.eq('ingest_status', 'failed')
  if (searchHits) q = q.in('id', Array.from(searchHits.keys()))
  if (p.channelId) q = q.eq('channel_id', p.channelId)
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

  let items = rows.map((r) => toListItem(r, population))

  if (p.withCreative && items.length > 0) {
    const map = await getCreativeMap(p.workspaceId, items.map((i) => i.id))
    items = items.map((i) => ({ ...i, creative: map[i.id] ?? null }))
  }

  // 검색으로 좁혔으면 **왜 걸렸는지**를 함께 내려보낸다.
  // 이유 없는 결과는 빈 결과보다 나쁘다 — 제품이 엉뚱한 걸 찾았다고 읽힌다.
  // (실측: '우니'로 검색하니 제목에 없는 게시물이 나왔는데, 실제로는 설명문 138번째 글자였다)
  if (searchHits) {
    items = items.map((i) => {
      const hit = searchHits.get(i.id)
      return hit
        ? { ...i, matchedIn: matchedInLabel(hit.matchedIn), matchedSnippet: hit.snippet }
        : i
    })
  }

  const nextOffset = start + rows.length
  return {
    items,
    total,
    cursor: nextOffset < total ? String(nextOffset) : null,
    population,
  }
}
