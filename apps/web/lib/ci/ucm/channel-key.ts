// lib/ci/ucm/channel-key.ts — 채널 식별 키 SSOT
//
// 왜 필요한가: 콘텐츠는 반드시 채널에 귀속되어야 한다.
// 배수(평소 대비)는 "같은 채널·같은 포맷"을 비교군으로 삼으므로,
// 채널을 못 만들면 비교군이 영원히 비고 배수가 나오지 않는다.
// (실제 사고: oembed가 채널 ID를 주지 않아 채널이 0개 → 전 콘텐츠 배수 미산출)
//
// 플랫폼이 안정적인 ID를 안 주면 핸들, 그것도 없으면 표시 이름으로 키를 만든다.
// 나중에 진짜 ID를 확보하면 승격할 수 있도록 접두사로 출처를 남긴다.

import type { CiPlatform } from '../types.ts'

export type ChannelKeySource = 'platform_id' | 'handle' | 'profile_url' | 'display_name'

export interface ChannelKey {
  externalId: string
  source: ChannelKeySource
}

/** YouTube 채널 URL에서 채널 ID나 핸들을 뽑는다. */
export function channelRefFromUrl(url: string | null | undefined): { id?: string; handle?: string } {
  if (!url) return {}
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean)
    if (seg[0] === 'channel' && seg[1]) return { id: seg[1] }
    if (seg[0]?.startsWith('@')) return { handle: seg[0] }
    if ((seg[0] === 'c' || seg[0] === 'user') && seg[1]) return { handle: seg[1] }
    // 그 외 플랫폼(@handle 경로)
    if (seg[0] && !['p', 'reel', 'tv', 'video', 'status', 'post'].includes(seg[0])) {
      return { handle: seg[0].startsWith('@') ? seg[0] : `@${seg[0]}` }
    }
  } catch {
    // 잘못된 URL은 조용히 무시한다 — 채널 식별 실패가 수집을 막지 않는다
  }
  return {}
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80)
}

/**
 * 채널 식별 키를 만든다. 어떤 단서든 있으면 키가 나온다.
 * 전부 없을 때만 null — 그때는 채널 없이 콘텐츠만 남는다.
 */
export function buildChannelKey(input: {
  platform: CiPlatform
  externalId?: string | null
  handle?: string | null
  profileUrl?: string | null
  displayName?: string | null
}): ChannelKey | null {
  if (input.externalId) {
    return { externalId: input.externalId, source: 'platform_id' }
  }

  const fromUrl = channelRefFromUrl(input.profileUrl)
  if (fromUrl.id) return { externalId: fromUrl.id, source: 'platform_id' }

  const handle = input.handle ?? fromUrl.handle
  if (handle) return { externalId: `handle:${slug(handle)}`, source: 'handle' }

  if (input.profileUrl) {
    try {
      const u = new URL(input.profileUrl)
      return { externalId: `url:${slug(u.host + u.pathname)}`, source: 'profile_url' }
    } catch {
      // URL 파싱 실패 시 이름으로 내려간다
    }
  }

  if (input.displayName) {
    return { externalId: `name:${slug(input.displayName)}`, source: 'display_name' }
  }

  return null
}

/**
 * 임시 키(handle/url/name 기반)를 진짜 플랫폼 ID로 승격할 수 있는지.
 * 나중에 API로 실제 ID를 얻으면 채널을 합칠 근거가 된다.
 */
export function isProvisionalKey(externalId: string): boolean {
  return /^(handle|url|name):/.test(externalId)
}
