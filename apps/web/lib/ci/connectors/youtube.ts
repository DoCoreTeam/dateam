// lib/ci/connectors/youtube.ts — YouTube 커넥터
// 방법 체인: official_api → oembed → meta_tags (02-ucm-and-connectors.md §3-2)
//
// 쿼터 정책(§3-3): search.list는 100유닛이라 쓰지 않는다. videos.list(1유닛)만 쓴다.
// API 키가 없거나 쿼터가 막히면 oembed(무료)로 내려간다 — 기능이 통째로 죽지 않게.

import type {
  Connector, ConnectorCtx, IngestMethod, UcmContent, UcmChannelRef,
} from './types.ts'
import { ConnectorError } from './types.ts'
import { fetchWatchMetrics, extractHashtags } from './youtube-page.ts'
import { parseTopicCategories } from '../analysis/signal-taxonomy.ts'
import type { CiContentFormat } from '../types.ts'

const API_BASE = 'https://www.googleapis.com/youtube/v3'
const OEMBED = 'https://www.youtube.com/oembed'

/** videos.list 1회 = 1유닛 */
const VIDEOS_LIST_UNITS = 1

/** 쇼츠 판정 상한. 설계상 180초 이하 세로 영상을 short로 본다. */
const SHORT_MAX_SEC = 180

interface YtVideoItem {
  id: string
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelId?: string
    channelTitle?: string
    defaultAudioLanguage?: string
    defaultLanguage?: string
    tags?: string[]
    categoryId?: string
    thumbnails?: Record<string, { url?: string }>
  }
  contentDetails?: { duration?: string }
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
  /**
   * 주제 신호. Wikipedia URL 배열로 온다.
   * part에 topicDetails를 넣지 않으면 이 필드가 통째로 오지 않는다 —
   * 실제로 그래서 321건이 주제 근거 없이 분류됐다.
   */
  topicDetails?: { topicCategories?: string[] }
}

/** ISO8601 기간(PT1M30S)을 초로. 파싱 실패는 null — 0으로 위장하지 않는다. */
export function parseIsoDuration(iso: string | undefined | null): number | null {
  if (!iso) return null
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!m) return null
  const [, d, h, min, s] = m
  const total = (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(min ?? 0) * 60) + Number(s ?? 0)
  return Number.isFinite(total) ? total : null
}

export function judgeFormat(durationSec: number | null, hint: CiContentFormat | null): CiContentFormat {
  if (hint === 'short' || hint === 'live') return hint
  if (durationSec != null && durationSec <= SHORT_MAX_SEC) return 'short'
  return 'long'
}

function toNumber(v: string | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function bestThumb(thumbs: Record<string, { url?: string }> | undefined): string | null {
  if (!thumbs) return null
  for (const k of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const u = thumbs[k]?.url
    if (u) return u
  }
  return null
}

const REQUIRED_FIELDS = [
  'title', 'published_at', 'views', 'likes', 'comments', 'thumbnail_url', 'duration_sec',
] as const

function missingOf(c: {
  title: string | null; publishedAt: string | null; views: number | null
  likes: number | null; comments: number | null; thumbnailUrl: string | null
  durationSec: number | null
}): string[] {
  const miss: string[] = []
  if (!c.title) miss.push('title')
  if (!c.publishedAt) miss.push('published_at')
  if (c.views == null) miss.push('views')
  if (c.likes == null) miss.push('likes')
  if (c.comments == null) miss.push('comments')
  if (!c.thumbnailUrl) miss.push('thumbnail_url')
  if (c.durationSec == null) miss.push('duration_sec')
  return miss
}

export function completenessOf(missing: string[]): number {
  return Math.max(0, (REQUIRED_FIELDS.length - missing.length) / REQUIRED_FIELDS.length)
}

async function viaOfficialApi(
  externalId: string, canonicalUrl: string, ctx: ConnectorCtx, attempted: IngestMethod[],
): Promise<UcmContent | null> {
  if (!ctx.apiKey) return null
  attempted.push('official_api')

  // topicDetails는 **같은 호출**에 얹힌다 — videos.list는 part 개수와 무관하게 1유닛이므로
  // 주제 신호를 얻는 데 드는 추가 쿼터는 0이다. 예전엔 이걸 빼고 부르면서
  // "주제를 알 수 없다"며 96.6%를 사람에게 넘겼다.
  const url = `${API_BASE}/videos?part=snippet,contentDetails,statistics,topicDetails&id=${encodeURIComponent(externalId)}&key=${ctx.apiKey}`
  const res = await fetch(url, { signal: ctx.signal })
  ctx.onQuotaSpend?.(VIDEOS_LIST_UNITS)

  if (!res.ok) return null
  const json = await res.json() as { items?: YtVideoItem[] }
  const item = json.items?.[0]
  if (!item) return null

  const durationSec = parseIsoDuration(item.contentDetails?.duration)
  const channel: UcmChannelRef | null = item.snippet?.channelId
    ? {
      platform: 'youtube',
      externalId: item.snippet.channelId,
      handle: null,
      displayName: item.snippet.channelTitle ?? null,
      profileUrl: `https://www.youtube.com/channel/${item.snippet.channelId}`,
      avatarUrl: null,
      subscriberCount: null,
    }
    : null

  const core = {
    title: item.snippet?.title ?? null,
    publishedAt: item.snippet?.publishedAt ?? null,
    views: toNumber(item.statistics?.viewCount),
    likes: toNumber(item.statistics?.likeCount),
    comments: toNumber(item.statistics?.commentCount),
    thumbnailUrl: bestThumb(item.snippet?.thumbnails),
    durationSec,
  }
  const missing = missingOf(core)
  const now = new Date().toISOString()

  return {
    platform: 'youtube',
    externalId,
    canonicalUrl,
    channel,
    format: judgeFormat(durationSec, null),
    title: core.title,
    caption: item.snippet?.description ?? null,
    keywords: item.snippet?.tags ?? extractHashtags(item.snippet?.description ?? null),
    platformCategory: item.snippet?.categoryId ?? null,
    topicSignals: parseTopicCategories(item.topicDetails?.topicCategories),
    publishedAt: core.publishedAt,
    durationSec,
    language: item.snippet?.defaultAudioLanguage ?? item.snippet?.defaultLanguage ?? null,
    thumbnailUrl: core.thumbnailUrl,
    comparability: 'A',
    metrics: {
      views: core.views, likes: core.likes, comments: core.comments,
      shares: null, saves: null, capturedAt: now,
    },
    provenance: {
      method: 'official_api', attemptedMethods: [...attempted],
      fetchedAt: now, verified: 'platform', missingFields: missing,
    },
  }
}

async function viaOembed(
  externalId: string, canonicalUrl: string, ctx: ConnectorCtx, attempted: IngestMethod[],
): Promise<UcmContent | null> {
  attempted.push('oembed')

  const res = await fetch(`${OEMBED}?url=${encodeURIComponent(canonicalUrl)}&format=json`, { signal: ctx.signal })
  if (!res.ok) return null
  const json = await res.json() as {
    title?: string; author_name?: string; author_url?: string; thumbnail_url?: string
  }

  const core = {
    title: json.title ?? null,
    publishedAt: null,
    views: null, likes: null, comments: null,
    thumbnailUrl: json.thumbnail_url ?? null,
    durationSec: null,
  }
  const now = new Date().toISOString()

  return {
    platform: 'youtube',
    externalId,
    canonicalUrl,
    channel: json.author_name
      ? {
        platform: 'youtube', externalId: null, handle: null,
        displayName: json.author_name, profileUrl: json.author_url ?? null,
        avatarUrl: null, subscriberCount: null,
      }
      : null,
    format: 'long',
    title: core.title,
    caption: null,
    publishedAt: null,
    durationSec: null,
    language: null,
    thumbnailUrl: core.thumbnailUrl,
    // 지표를 못 얻었으므로 조회수 비교 불가 — 등급을 낮춘다. 숨기지 않는다.
    comparability: 'C',
    metrics: { views: null, likes: null, comments: null, shares: null, saves: null, capturedAt: now },
    provenance: {
      method: 'oembed', attemptedMethods: [...attempted],
      fetchedAt: now, verified: 'platform', missingFields: missingOf(core),
      notes: 'API 키가 없거나 응답하지 않아 oembed로 수집했습니다. 지표는 확보되지 않았습니다.',
    },
  }
}

/**
 * 공개 시청 페이지에서 지표를 읽는다.
 * oEmbed와 RSS는 조회수를 주지 않는다 — 조회수가 없으면 배수가 영원히 안 나오므로,
 * API 키가 없을 때 이 경로가 제품을 살리는 유일한 길이다.
 */
async function viaWatchPage(
  externalId: string, canonicalUrl: string, ctx: ConnectorCtx, attempted: IngestMethod[],
): Promise<UcmContent | null> {
  attempted.push('meta_tags')

  const [page, oembed] = await Promise.all([
    fetchWatchMetrics(externalId),
    // 제목·썸네일은 oEmbed가 더 안정적이라 함께 쓴다
    viaOembed(externalId, canonicalUrl, ctx, []).catch(() => null),
  ])
  if (!page && !oembed) return null

  const durationSec = page?.durationSec ?? null
  const now = new Date().toISOString()

  const core = {
    title: oembed?.title ?? null,
    publishedAt: page?.publishedAt ?? null,
    views: page?.views ?? null,
    likes: page?.likes ?? null,
    comments: page?.comments ?? null,
    thumbnailUrl: oembed?.thumbnailUrl ?? `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
    durationSec,
  }
  const missing = missingOf(core)

  const channel: UcmChannelRef | null = page?.channelId
    ? {
      platform: 'youtube',
      externalId: page.channelId,
      handle: null,
      displayName: page.channelName ?? oembed?.channel?.displayName ?? null,
      profileUrl: `https://www.youtube.com/channel/${page.channelId}`,
      avatarUrl: null,
      subscriberCount: null,
    }
    : oembed?.channel ?? null

  return {
    platform: 'youtube',
    externalId,
    canonicalUrl,
    channel,
    format: page?.isShort ? 'short' : judgeFormat(durationSec, null),
    title: core.title,
    // 설명문은 시청 페이지에만 있다 — oEmbed는 주지 않는다.
    caption: page?.description ?? oembed?.caption ?? null,
    keywords: page?.keywords ?? [],
    publishedAt: core.publishedAt,
    durationSec,
    language: null,
    thumbnailUrl: core.thumbnailUrl,
    // 조회수를 얻었으면 같은 플랫폼끼리 비교 가능하다
    comparability: core.views != null ? 'A' : 'C',
    metrics: {
      views: core.views, likes: core.likes, comments: core.comments,
      shares: null, saves: null, capturedAt: now,
    },
    provenance: {
      method: 'meta_tags', attemptedMethods: [...attempted],
      fetchedAt: now, verified: 'platform', missingFields: missing,
      notes: core.views != null
        ? '공개 시청 페이지에서 지표를 읽었습니다.'
        : '지표를 읽지 못했습니다. 페이지 구조가 바뀌었거나 접근이 제한되었습니다.',
    },
  }
}

export const youtubeConnector: Connector = {
  platform: 'youtube',
  methodChain: ['official_api', 'meta_tags', 'oembed'],

  async fetchContent(externalId, canonicalUrl, ctx) {
    const attempted: IngestMethod[] = []

    // 체인은 앞 단계가 실패해야만 다음으로 내려간다.
    // 공식 API(지표 정확) → 시청 페이지(지표 확보 가능) → oEmbed(제목만)
    for (const step of [viaOfficialApi, viaWatchPage, viaOembed]) {
      try {
        const result = await step(externalId, canonicalUrl, ctx, attempted)
        if (result) return result
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e
        // 다음 방법으로 폴백. 시도 이력은 attempted에 남는다.
      }
    }

    throw new ConnectorError(
      'youtube', attempted,
      '이 영상의 정보를 가져오지 못했습니다. 비공개이거나 삭제되었을 수 있습니다',
    )
  },
}
