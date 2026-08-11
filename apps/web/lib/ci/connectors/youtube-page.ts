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
 * 시청 페이지 HTML에서 지표를 뽑는다.
 * 값이 없으면 0이 아니라 null이다 — 못 얻은 것과 0인 것은 다르다.
 */
export function parseWatchPage(html: string): PageMetrics {
  const publishedMatch = /"uploadDate":\s*"([^"]+)"/.exec(html)
    ?? /"publishDate":\s*"([^"]+)"/.exec(html)

  const durationMatch = /"lengthSeconds":\s*"(\d+)"/.exec(html)
  const duration = durationMatch ? Number(durationMatch[1]) : null

  const channelIdMatch = /"channelId":\s*"(UC[\w-]{20,})"/.exec(html)
  const channelNameMatch = /"ownerChannelName":\s*"([^"]+)"/.exec(html)
    ?? /"author":\s*"([^"]+)"/.exec(html)

  return {
    views: firstNumber(html, VIEW_PATTERNS),
    likes: firstNumber(html, LIKE_PATTERNS),
    comments: firstNumber(html, COMMENT_PATTERNS),
    publishedAt: publishedMatch?.[1] ?? null,
    durationSec: Number.isFinite(duration) && duration! > 0 ? duration! : null,
    channelId: channelIdMatch?.[1] ?? null,
    channelName: channelNameMatch?.[1] ?? null,
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
