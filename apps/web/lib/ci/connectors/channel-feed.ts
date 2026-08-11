// lib/ci/connectors/channel-feed.ts — 채널의 게시물 목록 가져오기
//
// 왜 필요한가: 채널을 알아야 그 채널의 콘텐츠를 모으고, 모여야 "평소"가 생기고,
// 평소가 있어야 "평소 대비 몇 배"가 나온다. 콘텐츠 한 건만 넣으면 비교군이 없어
// 배수가 영원히 계산되지 않는다.
//
// YouTube RSS는 API 키도 쿼터도 쓰지 않는다(최근 15개). 쿼터 설계의 부담 없이
// 비교군을 만들 수 있는 유일한 경로라 1순위로 쓴다.

import type { CiPlatform } from '../types.ts'

const FETCH_TIMEOUT_MS = 12_000
const UA = 'Mozilla/5.0 (compatible; newAX-ContentIntelligence/1.0)'

export interface FeedEntry {
  externalId: string
  canonicalUrl: string
  title: string | null
  publishedAt: string | null
  thumbnailUrl: string | null
}

export type FeedResult =
  | { ok: true; entries: FeedEntry[]; method: string }
  | { ok: false; error: string }

function textBetween(xml: string, tag: string, from = 0): string | null {
  const open = xml.indexOf(`<${tag}`, from)
  if (open < 0) return null
  const gt = xml.indexOf('>', open)
  const close = xml.indexOf(`</${tag}>`, gt)
  if (gt < 0 || close < 0) return null
  return xml.slice(gt + 1, close)
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim()
}

/** YouTube RSS(Atom) 파싱. 실패는 예외가 아니라 빈 결과다. */
export function parseYoutubeFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = []
  const parts = xml.split('<entry>').slice(1)

  for (const raw of parts) {
    const entry = raw.split('</entry>')[0]
    const idRaw = textBetween(entry, 'yt:videoId')
    if (!idRaw) continue
    const id = decode(idRaw)

    const title = textBetween(entry, 'title')
    const published = textBetween(entry, 'published')

    // <media:thumbnail url="..."/>
    const thumbMatch = /<media:thumbnail[^>]+url="([^"]+)"/.exec(entry)

    out.push({
      externalId: id,
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      title: title ? decode(title) : null,
      publishedAt: published ? decode(published) : null,
      thumbnailUrl: thumbMatch?.[1] ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    })
  }
  return out
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 채널의 최근 게시물을 가져온다.
 * YouTube는 RSS(무료), 나머지 플랫폼은 아직 공개 목록 경로가 없어 빈 결과를 정직하게 돌려준다.
 */
export async function fetchChannelFeed(input: {
  platform: CiPlatform
  externalId: string | null
  handle: string | null
  profileUrl: string | null
}): Promise<FeedResult> {
  if (input.platform !== 'youtube') {
    return {
      ok: false,
      error: `${input.platform}는 공개 게시물 목록을 제공하지 않아 채널 일괄 수집을 할 수 없습니다. 게시물 링크를 직접 넣어 주세요`,
    }
  }

  // 채널 ID를 알면 바로, 핸들만 알면 채널 페이지에서 ID를 먼저 찾는다
  let channelId = input.externalId && !input.externalId.includes(':') ? input.externalId : null

  if (!channelId) {
    const pageUrl = input.profileUrl
      ?? (input.handle ? `https://www.youtube.com/${input.handle.startsWith('@') ? input.handle : '@' + input.handle}` : null)
    if (!pageUrl) return { ok: false, error: '채널 주소를 알 수 없습니다' }

    const html = await fetchText(pageUrl)
    if (!html) return { ok: false, error: '채널 페이지를 열지 못했습니다' }

    const m = /"channelId":"(UC[\w-]{20,})"/.exec(html)
      ?? /channel\/(UC[\w-]{20,})/.exec(html)
    if (!m) return { ok: false, error: '채널 식별자를 찾지 못했습니다' }
    channelId = m[1]
  }

  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
  if (!xml) return { ok: false, error: '채널 게시물 목록을 가져오지 못했습니다' }

  const entries = parseYoutubeFeed(xml)
  if (entries.length === 0) return { ok: false, error: '이 채널에서 가져올 게시물이 없습니다' }

  return { ok: true, entries, method: `youtube_rss:${channelId}` }
}
