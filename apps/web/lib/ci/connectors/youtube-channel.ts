// lib/ci/connectors/youtube-channel.ts — 채널 자체의 정보 수집
//
// 왜 필요한가: 지금까지 채널은 "이름과 URL"만 있었다. 구독자·소개문·아바타를
// 한 번도 가져온 적이 없어 채널 상세가 "—"만 보여줬다.
// 채널을 알아야 그 채널의 콘텐츠를 판단할 수 있는데, 정작 채널을 몰랐다.
//
// 공개 채널 페이지를 읽는다. API 키가 있으면 공식 API가 정확하지만,
// 키 없이도 채널이 비어 보이지 않게 하는 것이 이 경로의 목적이다.
// 구독자 수는 "구독자 137만명"처럼 **반올림 표기**로만 나온다 —
// 정확한 값인 척하지 않고 provenance='estimated'로 남긴다.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT_MS = 12_000
const MAX_DESCRIPTION = 1500

export interface ChannelMeta {
  externalId: string | null
  handle: string | null
  displayName: string | null
  description: string | null
  avatarUrl: string | null
  /** 반올림된 근사값. 정확값이 아니다. */
  subscriberCount: number | null
  subscriberText: string | null
  videoCount: number | null
  /** ISO 3166-1 alpha-2. 시간대·계절·날씨 판정의 출발점 */
  country: string | null
}

export type ChannelMetaResult =
  | { ok: true; meta: ChannelMeta; method: string }
  | { ok: false; error: string }

/** "137만", "1.2천", "3.4M", "12,345" 같은 표기를 수로 바꾼다. 못 읽으면 null. */
export function parseCompactCount(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = raw.replace(/[,\s]/g, '')

  const unit: [RegExp, number][] = [
    [/([\d.]+)억/, 100_000_000],
    [/([\d.]+)만/, 10_000],
    [/([\d.]+)천/, 1_000],
    [/([\d.]+)B/i, 1_000_000_000],
    [/([\d.]+)M/i, 1_000_000],
    [/([\d.]+)K/i, 1_000],
  ]
  for (const [re, mul] of unit) {
    const m = re.exec(s)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n)) return Math.round(n * mul)
    }
  }

  const plain = /(\d+)/.exec(s)
  if (!plain) return null
  const n = Number(plain[1])
  return Number.isFinite(n) ? n : null
}

/**
 * 구독자 수 표기. 유튜브가 레이아웃을 바꿔 `subscriberCountText`가 사라지고
 * `metadataParts`의 `"content":"구독자 207만명"` 형태로 들어간다 —
 * 신규 형태를 앞에 두고 구 형태를 뒤에 남겨 둘 다 받는다.
 */
const SUBSCRIBER_PATTERNS: readonly RegExp[] = [
  /"(?:content|accessibilityLabel)":"구독자\s*([\d.,]+\s*[만천억]?)명"/,
  /"(?:content|accessibilityLabel)":"([\d.,]+\s*[KMB]?)\s*subscribers?"/i,
  /"subscriberCountText":\{"accessibilityData":\{"accessibilityData":\{"label":"([^"]+)"/,
  /"subscriberCountText":\{"simpleText":"([^"]+)"/,
  /"subscriberCountText":\{"content":"([^"]+)"/,
]

const VIDEO_COUNT_PATTERNS: readonly RegExp[] = [
  /"(?:content|accessibilityLabel)":"동영상\s*([\d.,]+\s*[만천억]?)개"/,
  /"(?:content|accessibilityLabel)":"([\d.,]+\s*[KMB]?)\s*videos?"/i,
  /"videosCountText":\{"runs":\[\{"text":"([\d,]+)"/,
  /"videoCountText":\{"simpleText":"([^"]+)"/,
]

function firstMatch(html: string, patterns: readonly RegExp[]): RegExpExecArray | null {
  for (const re of patterns) {
    const m = re.exec(html)
    if (m) return m
  }
  return null
}

function unescapeJsonString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n').replace(/\\r/g, '')
    .replace(/\\"/g, '"').replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\\/g, '\\')
    .trim()
}

/**
 * 채널 페이지 HTML에서 메타를 뽑는다.
 * 항목마다 독립적으로 실패할 수 있고, 실패는 null이다 — 하나 못 읽었다고 전부 버리지 않는다.
 */
export function parseChannelPage(html: string): ChannelMeta {
  // 채널 ID는 **이 페이지의 주인**만 읽는다.
  //
  // 예전에는 HTML 전체에서 첫 번째 `"channelId":"UC…"`를 취했다. 그런데 채널 페이지에는
  // 추천 채널 · 피처드 영상 소유자 · 커뮤니티 게시물 작성자의 channelId가 함께 실려 있어
  // **남의 채널 ID를 주인 것으로 저장**했다.
  // (실측 사고: `@jawed` → UCPszuZ3hR89D4NqFd7g3mDQ 저장. 진짜는 UC4QobU6STFB0P71PMvOGN5A.
  //  LuisFonsiVEVO·OneRepublicVEVO도 같은 채널이 서로 다른 UC 두 개로 쪼개져 있었다.)
  //
  // 그래서 **주인임이 문법적으로 보장되는 자리**만 순서대로 본다:
  //   1) channelMetadataRenderer.externalId — 페이지 메타데이터 블록(주인 확정)
  //   2) <link rel="canonical" href=".../channel/UC…"> — 이 문서의 정본 주소(주인 확정)
  //   3) <meta itemprop="identifier" content="UC…"> — 구조화 데이터(주인 확정)
  //   4) og:url의 /channel/UC… — 공유용 주소(주인 확정)
  // 전부 실패하면 **null이다.** 아무 UC나 주워 담지 않는다 — 틀린 ID는 없는 것보다 나쁘다.
  const idMatch = /"channelMetadataRenderer":\{[^}]*?"externalId":"(UC[\w-]{20,})"/.exec(html)
    ?? /"externalId":"(UC[\w-]{20,})"/.exec(html)
    ?? /<link[^>]+rel="canonical"[^>]+href="[^"]*\/channel\/(UC[\w-]{20,})"/i.exec(html)
    ?? /<link[^>]+href="[^"]*\/channel\/(UC[\w-]{20,})"[^>]+rel="canonical"/i.exec(html)
    ?? /<meta[^>]+itemprop="identifier"[^>]+content="(UC[\w-]{20,})"/i.exec(html)
    ?? /<meta[^>]+property="og:url"[^>]+content="[^"]*\/channel\/(UC[\w-]{20,})"/i.exec(html)

  const handleMatch = /"channelHandle":\{"runs":\[\{"text":"(@[^"]+)"/.exec(html)
    ?? /"canonicalBaseUrl":"\/(@[^"]+)"/.exec(html)
    ?? /"vanityChannelUrl":"https:\/\/www\.youtube\.com\/(@[^"]+)"/.exec(html)

  const nameMatch = /<meta\s+property="og:title"\s+content="([^"]*)"/i.exec(html)
    ?? /"title":"([^"]+)","description"/.exec(html)

  const descMatch = /<meta\s+property="og:description"\s+content="([^"]*)"/i.exec(html)
    ?? /"description":"((?:[^"\\]|\\.)*)","(?:availableCountryCodes|isFamilySafe)/.exec(html)

  const avatarMatch = /<meta\s+property="og:image"\s+content="([^"]*)"/i.exec(html)

  const subsMatch = firstMatch(html, SUBSCRIBER_PATTERNS)
  const videosMatch = firstMatch(html, VIDEO_COUNT_PATTERNS)

  const description = descMatch ? unescapeJsonString(descMatch[1]).slice(0, MAX_DESCRIPTION) : null

  return {
    externalId: idMatch?.[1] ?? null,
    handle: handleMatch?.[1] ?? null,
    displayName: nameMatch ? unescapeJsonString(nameMatch[1]) : null,
    description: description || null,
    avatarUrl: avatarMatch?.[1] ?? null,
    subscriberCount: parseCompactCount(subsMatch?.[1] ?? null),
    subscriberText: subsMatch?.[1] ?? null,
    videoCount: parseCompactCount(videosMatch?.[1] ?? null),
    // 채널 국가는 여기서 읽지 않는다.
    // 페이지의 countryCode·gl은 **보는 사람**의 국가라, 그걸 채널에 붙이면
    // 내 위치를 남의 채널에 덮어씌우는 셈이 된다. 공식 API(snippet.country)로만 확보한다.
    country: null,
  }
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' },
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 채널 주소를 만든다. ID > 핸들 > 저장된 프로필 URL 순으로 확실한 것을 쓴다. */
export function channelPageUrl(input: {
  externalId: string | null
  handle: string | null
  profileUrl: string | null
}): string | null {
  if (input.externalId && /^UC[\w-]{20,}$/.test(input.externalId)) {
    return `https://www.youtube.com/channel/${input.externalId}`
  }
  if (input.handle) {
    const h = input.handle.startsWith('@') ? input.handle : `@${input.handle}`
    return `https://www.youtube.com/${h}`
  }
  if (input.profileUrl?.startsWith('https://www.youtube.com/')) return input.profileUrl
  return null
}

export async function fetchChannelMeta(input: {
  externalId: string | null
  handle: string | null
  profileUrl: string | null
}): Promise<ChannelMetaResult> {
  const url = channelPageUrl(input)
  if (!url) return { ok: false, error: '채널 주소를 알 수 없어 정보를 가져오지 못했습니다' }

  const html = await fetchText(url)
  if (!html) return { ok: false, error: '채널 페이지를 열지 못했습니다' }

  const meta = parseChannelPage(html)
  // 아무것도 못 읽었으면 성공이라고 하지 않는다
  if (!meta.displayName && meta.subscriberCount == null && !meta.description) {
    return { ok: false, error: '채널 페이지에서 정보를 읽지 못했습니다(구조 변경 가능성)' }
  }
  return { ok: true, meta, method: `youtube_channel_page` }
}
