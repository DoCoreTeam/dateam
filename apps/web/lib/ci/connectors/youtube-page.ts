// lib/ci/connectors/youtube-page.ts — 공개 시청 페이지에서 지표 읽기
//
// 왜 필요한가: oEmbed와 RSS는 조회수를 주지 않는다. 조회수가 없으면
// "평소 대비 몇 배"가 영원히 계산되지 않고, 그러면 이 제품이 하는 일이 없다.
// API 키가 있으면 공식 API(1유닛)를 쓰고, 없으면 이 경로가 유일한 대안이다.
//
// 설계서 §13이 인정한 리스크: 페이지 구조가 바뀌면 깨진다.
// 그래서 실패를 예외로 만들지 않고, 못 읽은 값은 null로 남겨 화면이 정직하게 말하게 한다.

export interface PageMetrics {
  views: number | null
  likes: number | null
  comments: number | null
  publishedAt: string | null
  durationSec: number | null
  channelId: string | null
  channelName: string | null
  isShort: boolean
  /** 영상 설명문 원문. 상세에서 "무슨 문장으로 설명했나"를 보여주는 근거다. */
  description: string | null
  /** 업로더가 붙인 키워드 + 설명문의 해시태그 */
  keywords: string[]
}

function toInt(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw.replace(/[^\d]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function firstNumber(html: string, patterns: readonly RegExp[]): number | null {
  for (const re of patterns) {
    const m = re.exec(html)
    const n = toInt(m?.[1])
    if (n != null) return n
  }
  return null
}

/**
 * "다른 사용자 32,098,651명과 함께 이 동영상에 좋아요 표시" 같은 접근성 문구에서 숫자를 뽑는다.
 * "좋아요 3209만개"처럼 축약된 표기는 쓰지 않는다 — 반올림된 값이라 정확하지 않다.
 */
const LIKE_PATTERNS: readonly RegExp[] = [
  /"accessibilityText":"[^"]*?([\d,]{2,})명[^"]*?좋아요/,
  /"accessibilityText":"([\d,]{2,})\s*likes?"/i,
  /"accessibilityText":"[^"]*?along with ([\d,]{2,}) other people/i,
  /"likeCount":\s*"(\d+)"/,
]

const VIEW_PATTERNS: readonly RegExp[] = [
  /"viewCount":\s*"(\d+)"/,
  /"viewCount":\s*\{\s*"simpleText":\s*"([\d,]+)/,
  /"videoViewCountRenderer":[\s\S]{0,200}?"simpleText":"([\d,]+)/,
]

const COMMENT_PATTERNS: readonly RegExp[] = [
  /"commentCount":\s*\{\s*"simpleText":\s*"([\d,]+)"/,
  /"commentCount":\s*"(\d+)"/,
  /"contextualInfo":\{"runs":\[\{"text":"([\d,]+)"\}\]\},"trackingParams":"[^"]*"\}\},"targetId":"comments-section/,
  /댓글\s*([\d,]+)개/,
]

/**
 * JSON 문자열 리터럴의 이스케이프를 되돌린다.
 * `shortDescription`은 줄바꿈이 `\n`으로 들어 있어 그대로 쓰면 한 줄로 뭉개진다.
 */
function unescapeJsonString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n').replace(/\\r/g, '')
    .replace(/\\"/g, '"').replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\\/g, '\\')
    .trim()
}

const MAX_DESCRIPTION = 2000
const MAX_KEYWORDS = 20

/** 설명문에서 해시태그를 뽑는다. 업로더가 직접 붙인 주제어라 키워드로서 값이 높다. */
export function extractHashtags(text: string | null): string[] {
  if (!text) return []
  const out: string[] = []
  const re = /#([^\s#.,!?()[\]{}<>"']{1,40})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tag = m[1].trim()
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

/**
 * 영상 본문 블록(`videoDetails`)을 잘라낸다.
 *
 * 왜 이 블록을 쓰는가: 시청 페이지에는 추천 영상들의 정보도 함께 들어 있어
 * `"channelId"`를 그냥 처음부터 찾으면 **남의 채널 ID를 잡는다**.
 * (실측 사고: 같은 채널이 서로 다른 ID 두 행으로 쪼개짐)
 * videoDetails는 이 영상 자신의 정보만 담는다.
 */
export function sliceVideoDetails(html: string): string | null {
  const start = html.indexOf('"videoDetails":{')
  if (start < 0) return null
  // 블록 전체를 정확히 괄호 매칭할 필요는 없다 — 뒤쪽 일정 길이면 필요한 필드가 다 들어온다
  return html.slice(start, start + 4000)
}

/** videoDetails의 keywords 배열. 업로더가 직접 넣은 값이라 가장 정확하다. */
function keywordsFromVideoDetails(details: string | null): string[] {
  if (!details) return []
  const m = /"keywords":\[((?:[^\]\\]|\\.)*)\]/.exec(details)
  if (!m) return []
  return Array.from(m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g))
    .map((x) => unescapeJsonString(x[1]))
    .filter(Boolean)
}

/**
 * 유튜브가 모든 시청 페이지에 똑같이 박아 두는 `<meta name="keywords">` 값.
 * 이 영상의 키워드가 아니라 유튜브 사이트의 상투어다 —
 * 그대로 쓰면 화면에 "동영상·공유·카메라폰"이 키워드랍시고 뜬다(실측 사고).
 */
const YOUTUBE_BOILERPLATE_KEYWORDS = new Set([
  '동영상', '공유', '카메라폰', '동영상폰', '무료', '올리기',
  'video', 'sharing', 'camera phone', 'video phone', 'free', 'upload',
])

/**
 * 키워드. 업로더가 실제로 넣은 것만 쓴다 — videoDetails, 그리고 설명문 해시태그.
 * meta 태그는 유튜브 상투어라 쓰지 않는다.
 */
export function parseKeywords(html: string, description: string | null): string[] {
  const fromDetails = keywordsFromVideoDetails(sliceVideoDetails(html))

  const merged: string[] = []
  for (const k of [...fromDetails, ...extractHashtags(description)]) {
    if (YOUTUBE_BOILERPLATE_KEYWORDS.has(k.trim().toLowerCase())) continue
    if (!merged.some((x) => x.toLowerCase() === k.toLowerCase())) merged.push(k)
  }
  return merged.slice(0, MAX_KEYWORDS)
}

/** 시청 페이지에서 설명문을 뽑는다. 못 읽으면 null — 제목으로 대신 채우지 않는다. */
export function parseDescription(html: string): string | null {
  const m = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(html)
  if (!m) return null
  const text = unescapeJsonString(m[1])
  return text ? text.slice(0, MAX_DESCRIPTION) : null
}

/**
 * 시청 페이지 HTML에서 지표를 뽑는다.
 * 값이 없으면 0이 아니라 null이다 — 못 얻은 것과 0인 것은 다르다.
 */
export function parseWatchPage(html: string): PageMetrics {
  const publishedMatch = /"uploadDate":\s*"([^"]+)"/.exec(html)
    ?? /"publishDate":\s*"([^"]+)"/.exec(html)

  const durationMatch = /"lengthSeconds":\s*"(\d+)"/.exec(html)
  const duration = durationMatch ? Number(durationMatch[1]) : null

  // 소유자 채널 ID는 반드시 이 영상 자신의 블록에서 읽는다.
  // 페이지 전체에서 찾으면 추천 영상의 채널을 잡아 채널이 쪼개진다.
  const details = sliceVideoDetails(html)
  const channelIdMatch = /"externalChannelId":\s*"(UC[\w-]{20,})"/.exec(html)
    ?? (details ? /"channelId":\s*"(UC[\w-]{20,})"/.exec(details) : null)

  const channelNameMatch = (details ? /"author":\s*"((?:[^"\\]|\\.)*)"/.exec(details) : null)
    ?? /"ownerChannelName":\s*"((?:[^"\\]|\\.)*)"/.exec(html)

  const description = parseDescription(html)

  return {
    description,
    keywords: parseKeywords(html, description),
    views: firstNumber(html, VIEW_PATTERNS),
    likes: firstNumber(html, LIKE_PATTERNS),
    comments: firstNumber(html, COMMENT_PATTERNS),
    publishedAt: publishedMatch?.[1] ?? null,
    durationSec: Number.isFinite(duration) && duration! > 0 ? duration! : null,
    channelId: channelIdMatch?.[1] ?? null,
    channelName: channelNameMatch ? unescapeJsonString(channelNameMatch[1]) : null,
    isShort: /"isShortsEligible":true/.test(html) || (duration != null && duration <= 60),
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT_MS = 15_000

export async function fetchWatchMetrics(videoId: string): Promise<PageMetrics | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'ko,en;q=0.8',
      },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const html = await res.text()
    const parsed = parseWatchPage(html)
    // 조회수도 채널도 못 읽었으면 이 경로는 실패로 본다
    if (parsed.views == null && !parsed.channelId) return null
    return parsed
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
