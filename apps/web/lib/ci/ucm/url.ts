// lib/ci/ucm/url.ts — 플랫폼 판별과 정규 URL 산출 SSOT
// 설계: 02-ucm-and-connectors.md
// 링크 투입은 전역 추가·모바일 공유 시트·어시스턴트가 모두 같은 입구를 쓴다.
// 판별 규칙을 여러 곳에 복붙하면 플랫폼이 늘 때마다 누락이 생긴다.

import type { CiPlatform, CiContentFormat } from '../types.ts'

export interface ParsedUrl {
  platform: CiPlatform
  externalId: string
  canonicalUrl: string
  /** URL 형태만으로 확정 가능한 포맷. 불확실하면 null(수집 후 판정) */
  formatHint: CiContentFormat | null
}

function hostOf(u: URL): string {
  return u.hostname.replace(/^www\./, '').toLowerCase()
}

/**
 * 지원 플랫폼이면 파싱 결과를, 아니면 null을 돌려준다.
 * 예외를 던지지 않는다 — 잘못된 링크는 정상 흐름의 일부다.
 */
export function parseContentUrl(input: string): ParsedUrl | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let u: URL
  try {
    u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  const host = hostOf(u)
  const seg = u.pathname.split('/').filter(Boolean)

  // ── YouTube ──
  if (host === 'youtu.be' && seg[0]) {
    return yt(seg[0], null)
  }
  if (host.endsWith('youtube.com')) {
    const v = u.searchParams.get('v')
    if (v) return yt(v, 'long')
    if (seg[0] === 'shorts' && seg[1]) return yt(seg[1], 'short')
    if (seg[0] === 'live' && seg[1]) return yt(seg[1], 'live')
    if (seg[0] === 'embed' && seg[1]) return yt(seg[1], null)
  }

  // ── TikTok ── /@handle/video/{id}
  if (host.endsWith('tiktok.com')) {
    const i = seg.indexOf('video')
    if (i >= 0 && seg[i + 1]) {
      return {
        platform: 'tiktok', externalId: seg[i + 1],
        canonicalUrl: `https://www.tiktok.com/${seg[0]}/video/${seg[i + 1]}`,
        formatHint: 'short',
      }
    }
    // 단축 링크(vm.tiktok.com 등)는 ID를 알 수 없다 → 수집 단계에서 해석.
    //
    // `@핸들`은 여기서 제외한다. 프로필 주소인데 게시물로 담으면 영상 하나도 없는
    // 깡통 콘텐츠가 생기고, 정작 그 계정은 등록되지 않는다 —
    // 사용자는 "계정을 넣었는데 아무것도 안 모인다"고 겪는다.
    // 프로필은 parseChannelUrl이 받아 계정으로 등록한다.
    if (seg[0] && !seg[0].startsWith('@')) {
      return {
        platform: 'tiktok', externalId: `short:${seg[0]}`,
        canonicalUrl: u.toString(), formatHint: 'short',
      }
    }
  }

  // ── Instagram ── /p/{code} /reel/{code}
  if (host.endsWith('instagram.com') && seg[0] && seg[1]) {
    if (seg[0] === 'p' || seg[0] === 'reel' || seg[0] === 'tv') {
      return {
        platform: 'instagram', externalId: seg[1],
        canonicalUrl: `https://www.instagram.com/${seg[0]}/${seg[1]}/`,
        formatHint: seg[0] === 'reel' ? 'short' : seg[0] === 'p' ? 'image' : null,
      }
    }
  }

  // ── Threads ── /@handle/post/{code}
  if (host.endsWith('threads.net') || host.endsWith('threads.com')) {
    const i = seg.indexOf('post')
    if (i >= 0 && seg[i + 1]) {
      return {
        platform: 'threads', externalId: seg[i + 1],
        canonicalUrl: u.origin + u.pathname, formatHint: 'text',
      }
    }
  }

  // ── X ── /{handle}/status/{id}
  if (host === 'x.com' || host === 'twitter.com') {
    const i = seg.indexOf('status')
    if (i >= 0 && seg[i + 1]) {
      return {
        platform: 'x', externalId: seg[i + 1],
        canonicalUrl: `https://x.com/${seg[0]}/status/${seg[i + 1]}`,
        formatHint: 'text',
      }
    }
  }

  // ── Facebook ── /{page}/videos/{id} 또는 ?story_fbid=
  if (host.endsWith('facebook.com') || host === 'fb.watch') {
    const i = seg.indexOf('videos')
    if (i >= 0 && seg[i + 1]) {
      return {
        platform: 'facebook', externalId: seg[i + 1],
        canonicalUrl: u.origin + u.pathname, formatHint: 'long',
      }
    }
    const story = u.searchParams.get('story_fbid')
    if (story) {
      return {
        platform: 'facebook', externalId: story,
        canonicalUrl: u.origin + u.pathname + `?story_fbid=${story}`, formatHint: null,
      }
    }
    if (host === 'fb.watch' && seg[0]) {
      return {
        platform: 'facebook', externalId: `short:${seg[0]}`,
        canonicalUrl: u.toString(), formatHint: 'long',
      }
    }
  }

  return null
}

function yt(id: string, formatHint: CiContentFormat | null): ParsedUrl {
  return {
    platform: 'youtube',
    externalId: id,
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    formatHint,
  }
}

/** 채널/프로필 URL 판별 — 관심 채널 추가 입력에 쓴다. */
export interface ParsedChannelRef {
  platform: CiPlatform
  handle: string | null
  externalId: string | null
  url: string
}

/**
 * 링크 하나를 받아 **무엇인지 시스템이 판별한다** — 사용자가 종류를 알려주지 않는다.
 *
 * 왜 필요한가: 예전에는 수집 입구가 `parseContentUrl`만 써서 채널·프로필 링크를
 * "지원하지 않는 주소"로 거부했다. 채널 등록은 다른 화면의 다른 API로만 가능해
 * **입구가 둘이고 서로를 몰랐다.** 사용자가 기대한 것은 "링크를 넣으면 알아서"다.
 *
 * 판별 순서에 이유가 있다: **게시물이 먼저**다.
 * `youtube.com/@handle/video/xxx` 같은 주소는 채널 판별에도 걸릴 수 있는데,
 * 게시물을 채널로 오인하면 그 채널 전체를 훑어 엉뚱한 비용이 든다. 반대는 손해가 없다.
 */
export type ParsedCiLink =
  | { kind: 'content'; content: ParsedUrl }
  | { kind: 'channel'; channel: ParsedChannelRef }

export function parseAnyCiUrl(input: string): ParsedCiLink | null {
  const content = parseContentUrl(input)
  if (content) return { kind: 'content', content }

  const channel = parseChannelUrl(input)
  if (channel) return { kind: 'channel', channel }

  return null
}

/** `youtube.com/@handle/…` 뒤에 올 수 있는 채널 탭. 이 밖은 채널로 보지 않는다. */
const YOUTUBE_CHANNEL_TABS = new Set([
  'videos', 'shorts', 'streams', 'live', 'playlists', 'community', 'about', 'featured', 'posts', 'store',
])

export function parseChannelUrl(input: string): ParsedChannelRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // @handle 만 입력한 경우는 플랫폼을 알 수 없다 — URL을 요구한다
  let u: URL
  try {
    u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  const host = hostOf(u)
  const seg = u.pathname.split('/').filter(Boolean)

  if (host.endsWith('youtube.com')) {
    if (seg[0]?.startsWith('@')) {
      // `@handle` 뒤에 올 수 있는 것은 **채널 안의 탭**뿐이다.
      // 그 밖의 것이 붙어 있으면 채널이라고 단정하지 않는다 —
      // 게시물을 채널로 오인하면 그 한 건 대신 **계정 전체를 훑어** 엉뚱한 비용이 든다.
      // (반대 방향 오인은 손해가 없다: 채널을 못 알아보면 사용자가 다시 넣으면 된다)
      if (seg.length === 1 || YOUTUBE_CHANNEL_TABS.has(seg[1])) {
        return { platform: 'youtube', handle: seg[0], externalId: null, url: u.toString() }
      }
      return null
    }
    if (seg[0] === 'channel' && seg[1]) {
      return { platform: 'youtube', handle: null, externalId: seg[1], url: u.toString() }
    }
    if ((seg[0] === 'c' || seg[0] === 'user') && seg[1]) {
      return { platform: 'youtube', handle: seg[1], externalId: null, url: u.toString() }
    }
  }
  if (host.endsWith('tiktok.com') && seg[0]?.startsWith('@')) {
    return { platform: 'tiktok', handle: seg[0], externalId: null, url: u.toString() }
  }
  if (host.endsWith('instagram.com') && seg[0] && !['p', 'reel', 'tv'].includes(seg[0])) {
    return { platform: 'instagram', handle: seg[0], externalId: null, url: u.toString() }
  }
  if ((host.endsWith('threads.net') || host.endsWith('threads.com')) && seg[0]?.startsWith('@')) {
    return { platform: 'threads', handle: seg[0], externalId: null, url: u.toString() }
  }
  if ((host === 'x.com' || host === 'twitter.com') && seg[0] && seg[0] !== 'i') {
    return { platform: 'x', handle: seg[0], externalId: null, url: u.toString() }
  }
  if (host.endsWith('facebook.com') && seg[0]) {
    return { platform: 'facebook', handle: seg[0], externalId: null, url: u.toString() }
  }
  return null
}
