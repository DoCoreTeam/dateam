// lib/ci/connectors/meta-tags.ts — Open Graph / oEmbed 기반 공통 수집기
// 설계: 02-ucm-and-connectors.md §3-2 방법 체인
//
// TikTok·Instagram·Facebook·X·Threads는 공식 API 제약이 커서 이 경로에 의존한다.
// 지표를 못 얻는 경우가 많으므로 비교 등급을 낮추고 미확보 필드를 그대로 노출한다.
// 없는 숫자를 만들어내지 않는 것이 이 파일의 유일한 규칙이다.

import type { IngestMethod, UcmChannelRef, UcmContent } from './types.ts'
import type { CiComparability, CiContentFormat, CiPlatform } from '../types.ts'

const UA = 'Mozilla/5.0 (compatible; newAX-ContentIntelligence/1.0)'
const FETCH_TIMEOUT_MS = 12_000

export interface MetaResult {
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
  author: string | null
  publishedAt: string | null
  durationSec: number | null
}

function pick(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(html)
    if (m?.[1]) return decodeEntities(m[1].trim())
  }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}

function metaRe(prop: string): RegExp[] {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i'),
  ]
}

/** HTML에서 Open Graph 계열 메타를 뽑는다. 없는 값은 null로 남긴다. */
export function parseMeta(html: string): MetaResult {
  const durationRaw = pick(html, [...metaRe('og:video:duration'), ...metaRe('video:duration')])
  const duration = durationRaw ? Number(durationRaw) : null

  return {
    title: pick(html, [
      ...metaRe('og:title'), ...metaRe('twitter:title'),
      /<title[^>]*>([^<]{1,300})<\/title>/i,
    ]),
    description: pick(html, [...metaRe('og:description'), ...metaRe('twitter:description'), ...metaRe('description')]),
    image: pick(html, [...metaRe('og:image'), ...metaRe('twitter:image')]),
    siteName: pick(html, metaRe('og:site_name')),
    author: pick(html, [...metaRe('author'), ...metaRe('og:video:director'), ...metaRe('article:author')]),
    publishedAt: pick(html, [
      ...metaRe('article:published_time'), ...metaRe('og:video:release_date'), ...metaRe('datePublished'),
    ]),
    durationSec: Number.isFinite(duration) && duration! > 0 ? duration! : null,
  }
}

export async function fetchHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export interface OEmbedResult {
  title: string | null
  authorName: string | null
  authorUrl: string | null
  thumbnailUrl: string | null
}

export async function fetchOEmbed(endpoint: string, signal?: AbortSignal): Promise<OEmbedResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  signal?.addEventListener('abort', () => controller.abort())
  try {
    const res = await fetch(endpoint, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!res.ok) return null
    const j = await res.json() as Record<string, unknown>
    return {
      title: typeof j.title === 'string' ? j.title : null,
      authorName: typeof j.author_name === 'string' ? j.author_name : null,
      authorUrl: typeof j.author_url === 'string' ? j.author_url : null,
      thumbnailUrl: typeof j.thumbnail_url === 'string' ? j.thumbnail_url : null,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 플랫폼별 필수 필드. 플랫폼이 원래 제공하지 않는 값은 분모에서 뺀다. */
export const REQUIRED_FIELDS: Record<CiPlatform, readonly string[]> = {
  youtube: ['title', 'published_at', 'views', 'likes', 'comments', 'thumbnail_url', 'duration_sec'],
  tiktok: ['title', 'published_at', 'views', 'likes', 'comments', 'thumbnail_url'],
  instagram: ['caption', 'published_at', 'likes', 'comments', 'thumbnail_url'],
  facebook: ['caption', 'published_at', 'likes', 'comments'],
  x: ['caption', 'published_at', 'likes', 'comments'],
  threads: ['caption', 'published_at', 'likes', 'comments'],
}

export function completenessFor(platform: CiPlatform, missing: readonly string[]): number {
  const total = REQUIRED_FIELDS[platform].length
  if (total === 0) return 1
  return Math.max(0, (total - missing.length) / total)
}

export function missingFor(
  platform: CiPlatform,
  got: { title?: string | null; caption?: string | null; publishedAt?: string | null; thumbnailUrl?: string | null; durationSec?: number | null },
): string[] {
  const have: Record<string, boolean> = {
    title: Boolean(got.title),
    caption: Boolean(got.caption),
    published_at: Boolean(got.publishedAt),
    thumbnail_url: Boolean(got.thumbnailUrl),
    duration_sec: got.durationSec != null,
    // 렌더 경로에서는 지표를 얻지 못한다. 확보한 척하지 않는다.
    views: false, likes: false, comments: false,
  }
  return REQUIRED_FIELDS[platform].filter((f) => !have[f])
}

/**
 * 메타 기반 UCM 생성.
 * 지표를 확보하지 못하므로 비교 등급은 플랫폼 기본값보다 높아지지 않는다.
 */
export function buildUcmFromMeta(input: {
  platform: CiPlatform
  externalId: string
  canonicalUrl: string
  format: CiContentFormat
  meta: MetaResult
  oembed: OEmbedResult | null
  attempted: IngestMethod[]
  method: IngestMethod
  baseComparability: CiComparability
}): UcmContent {
  const { platform, meta, oembed } = input
  const now = new Date().toISOString()

  const title = oembed?.title ?? meta.title
  const thumbnailUrl = oembed?.thumbnailUrl ?? meta.image
  const authorName = oembed?.authorName ?? meta.author

  const channel: UcmChannelRef | null = authorName
    ? {
      platform,
      externalId: null,
      handle: null,
      displayName: authorName,
      profileUrl: oembed?.authorUrl ?? null,
      avatarUrl: null,
      subscriberCount: null,
    }
    : null

  const missing = missingFor(platform, {
    title,
    caption: meta.description,
    publishedAt: meta.publishedAt,
    thumbnailUrl,
    durationSec: meta.durationSec,
  })

  return {
    platform,
    externalId: input.externalId,
    canonicalUrl: input.canonicalUrl,
    channel,
    format: input.format,
    title,
    caption: meta.description,
    publishedAt: meta.publishedAt,
    durationSec: meta.durationSec,
    language: null,
    thumbnailUrl,
    // 조회수를 못 얻었으면 조회수 비교는 불가능하다 — 등급을 C로 낮춘다
    comparability: 'C' as CiComparability,
    metrics: { views: null, likes: null, comments: null, shares: null, saves: null, capturedAt: now },
    provenance: {
      method: input.method,
      attemptedMethods: [...input.attempted],
      fetchedAt: now,
      verified: 'platform',
      missingFields: missing,
      notes: '공개 페이지의 메타 정보만 확보했습니다. 조회수·좋아요는 얻지 못했습니다.',
    },
  }
}
