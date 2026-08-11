// lib/ci/assets/link.ts — 링크 자료 메타 확보 (서버 전용)
//
// 왜: 영상 소스를 파일로만 받을 수 있었다. 링크로도 등록되게 하되,
// 원본 파일을 우리가 받아 보관하지는 않는다 — 주소와 눈에 보이는 메타만 남긴다.
// (플랫폼 영상 파일을 내려받아 보관하는 것은 이용약관 문제도 함께 만든다)
//
// 수집 경로는 이미 있는 것을 재사용한다: parseMeta/fetchHtml(Open Graph),
// youtube-page(설명문·썸네일). 새 파서를 또 만들지 않는다.

import { parseMeta, fetchHtml } from '../connectors/meta-tags.ts'
import { parseContentUrl } from '../ucm/url.ts'
import { CI_PLATFORM_LABEL } from '../types.ts'

export interface LinkMeta {
  title: string | null
  thumbnailUrl: string | null
  /** 어디 링크인지 — 화면에 출처를 밝힌다 */
  providerLabel: string | null
  platform: string | null
  externalId: string | null
  /** 메타를 못 읽었으면 그 사유. 등록은 막지 않는다 */
  note: string | null
}

const EMPTY: LinkMeta = {
  title: null, thumbnailUrl: null, providerLabel: null,
  platform: null, externalId: null, note: null,
}

/** http(s)만 받는다. javascript: 같은 스킴을 자료로 저장하지 않는다. */
export function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function hostLabel(raw: string): string | null {
  try {
    return new URL(raw).host.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * 링크에서 보이는 만큼만 메타를 확보한다.
 * 실패해도 등록은 진행한다 — 메타가 없다고 사용자의 자료를 거부하지 않는다.
 */
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  if (!isSafeHttpUrl(url)) return { ...EMPTY, note: '주소 형식을 확인해 주세요' }

  const parsed = parseContentUrl(url)
  const platform = parsed?.platform ?? null

  const html = await fetchHtml(url).catch(() => null)
  if (!html) {
    return {
      ...EMPTY,
      platform,
      externalId: parsed?.externalId ?? null,
      providerLabel: platform ? CI_PLATFORM_LABEL[parsed!.platform] : hostLabel(url),
      note: '페이지를 열지 못해 제목·썸네일을 가져오지 못했습니다',
    }
  }

  const meta = parseMeta(html)
  // 유튜브 og:image에는 서명 파라미터(?sqp=)가 붙어 만료·차단될 수 있다.
  // 규칙이 확정적이고 만료도 없는 주소를 먼저 쓴다.
  const ytThumb = parsed?.platform === 'youtube' && parsed.externalId
    ? `https://i.ytimg.com/vi/${parsed.externalId}/hqdefault.jpg`
    : null

  return {
    title: meta.title ?? null,
    thumbnailUrl: ytThumb ?? meta.image,
    providerLabel: platform ? CI_PLATFORM_LABEL[parsed!.platform] : hostLabel(url),
    platform,
    externalId: parsed?.externalId ?? null,
    note: meta.title ? null : '제목을 읽지 못했습니다',
  }
}
