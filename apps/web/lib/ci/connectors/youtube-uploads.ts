// lib/ci/connectors/youtube-uploads.ts — 채널의 **전체** 업로드 목록
//
// 왜 필요한가: RSS는 최근 15개만 준다. 543개 올린 채널을 15개로 판단하면
// "평소"가 최근 2주로 좁혀지고, 배수도 그 좁은 기준으로 나온다.
// 채널을 분석한다면서 3%만 보는 셈이다. (실측 사고: 추성훈 543개 중 15개)
//
// 공식 API의 uploads 재생목록은 전량을 페이지로 준다. 쿼터도 싸다 —
// playlistItems.list 1회(50개)당 1유닛이라 543개는 11유닛. 일일 한도 10,000.
// 키가 없으면 이 경로를 쓰지 못한다. 그때는 RSS 15개로 내려가되 **그 사실을 숨기지 않는다.**

const API_BASE = 'https://www.googleapis.com/youtube/v3'
const PAGE_SIZE = 50
/** 한 채널에서 가져올 상한. 수만 개 채널이 워커를 붙잡지 않게 한다. */
export const MAX_UPLOADS = 1000

export interface UploadItem {
  externalId: string
  canonicalUrl: string
  title: string | null
  publishedAt: string | null
  thumbnailUrl: string | null
}

export type UploadsResult =
  | { ok: true; items: UploadItem[]; total: number | null; truncated: boolean; quotaUnits: number }
  | { ok: false; error: string; needsKey: boolean }

interface PlaylistItemsResponse {
  items?: {
    snippet?: {
      title?: string
      publishedAt?: string
      resourceId?: { videoId?: string }
      thumbnails?: Record<string, { url?: string }>
    }
  }[]
  nextPageToken?: string
  pageInfo?: { totalResults?: number }
}

/** 썸네일은 큰 것부터 고른다. 카드에서 흐릿하게 보이는 게 더 나쁘다. */
export function bestThumbnail(thumbs: Record<string, { url?: string }> | undefined): string | null {
  if (!thumbs) return null
  for (const key of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = thumbs[key]?.url
    if (url) return url
  }
  return null
}

/** 재생목록 응답 → 업로드 항목. 영상 ID가 없는 행(비공개·삭제)은 버린다. */
export function parsePlaylistItems(json: PlaylistItemsResponse): UploadItem[] {
  return (json.items ?? []).flatMap((it) => {
    const id = it.snippet?.resourceId?.videoId
    if (!id) return []
    return [{
      externalId: id,
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      title: it.snippet?.title ?? null,
      publishedAt: it.snippet?.publishedAt ?? null,
      thumbnailUrl: bestThumbnail(it.snippet?.thumbnails),
    }]
  })
}

/**
 * 채널 ID → uploads 재생목록 ID.
 * 규칙상 UC... → UU...로 바꾸면 되지만, 규칙에 기대지 않고 API가 알려준 값을 쓴다.
 */
async function uploadsPlaylistId(channelId: string, apiKey: string): Promise<string | null> {
  const res = await fetch(
    `${API_BASE}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`,
  )
  if (!res.ok) return null
  const json = await res.json() as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
  }
  return json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null
}

/**
 * 채널의 전체 업로드를 가져온다.
 * 상한에 걸리면 truncated=true로 **잘렸다는 사실을 함께** 돌려준다 — 조용히 자르지 않는다.
 */
export async function fetchAllUploads(
  channelId: string, apiKey: string | undefined,
): Promise<UploadsResult> {
  if (!apiKey) {
    return {
      ok: false,
      needsKey: true,
      error: 'YouTube API 키가 없어 최근 15개(RSS)까지만 수집할 수 있습니다',
    }
  }

  let quotaUnits = 1 // channels.list
  const playlistId = await uploadsPlaylistId(channelId, apiKey)
  if (!playlistId) {
    return { ok: false, needsKey: false, error: '채널의 업로드 목록을 찾지 못했습니다' }
  }

  const items: UploadItem[] = []
  let pageToken: string | undefined
  let total: number | null = null

  do {
    const url = `${API_BASE}/playlistItems?part=snippet&playlistId=${playlistId}`
      + `&maxResults=${PAGE_SIZE}&key=${apiKey}`
      + (pageToken ? `&pageToken=${pageToken}` : '')

    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url)
    quotaUnits += 1
    if (!res.ok) {
      // 일부라도 건졌으면 버리지 않는다
      if (items.length > 0) {
        return { ok: true, items, total, truncated: true, quotaUnits }
      }
      return {
        ok: false, needsKey: res.status === 403,
        error: `업로드 목록을 가져오지 못했습니다(HTTP ${res.status})`,
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const json = await res.json() as PlaylistItemsResponse
    total = json.pageInfo?.totalResults ?? total
    items.push(...parsePlaylistItems(json))
    pageToken = json.nextPageToken
  } while (pageToken && items.length < MAX_UPLOADS)

  return {
    ok: true,
    items: items.slice(0, MAX_UPLOADS),
    total,
    truncated: Boolean(pageToken) || items.length > MAX_UPLOADS,
    quotaUnits,
  }
}
