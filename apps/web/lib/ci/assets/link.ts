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
import { checkUrlIsPublic } from '../net/ssrf.ts'
import { parseDriveFileId } from './drive-link.ts'

export interface LinkMeta {
  title: string | null
  thumbnailUrl: string | null
  /** 어디 링크인지 — 화면에 출처를 밝힌다 */
  providerLabel: string | null
  platform: string | null
  externalId: string | null
  /**
   * 드라이브 링크면 그 파일 ID. 이게 있어야 우리 스트리밍 경로로 열 수 있고,
   * 그래야 편집점 분석이 링크만으로 성립한다.
   */
  driveFileId: string | null
  /** 메타를 못 읽었으면 그 사유. 등록은 막지 않는다 */
  note: string | null
  /** 내부망 주소라 서버가 열기를 거부했는가 — 등록 자체를 막을지 판단하는 근거 */
  blocked: boolean
}

const EMPTY: LinkMeta = {
  title: null, thumbnailUrl: null, providerLabel: null,
  platform: null, externalId: null, driveFileId: null, note: null, blocked: false,
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
  const driveFileId = parseDriveFileId(url)

  // 사용자가 직접 넣은 주소다 — 서버가 대신 열기 전에 내부망·메타데이터 주소를 막는다(SSRF).
  const verdict = await checkUrlIsPublic(url)
  if (!verdict.ok) {
    return { ...EMPTY, note: verdict.reason, blocked: verdict.code === 'PRIVATE' }
  }

  const html = await fetchHtml(url, undefined, { guard: true }).catch(() => null)
  if (!html) {
    return {
      ...EMPTY,
      platform,
      driveFileId,
      externalId: parsed?.externalId ?? null,
      providerLabel: platform ? CI_PLATFORM_LABEL[parsed!.platform] : hostLabel(url),
      note: driveFileId
        // 드라이브는 로그인 없이 열리지 않는 게 정상이다. 실패처럼 말하면 사용자가 겁먹는다.
        ? '드라이브 파일로 등록했습니다 — 편집점에서 바로 분석할 수 있습니다'
        : '페이지를 열지 못해 제목·썸네일을 가져오지 못했습니다',
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
    driveFileId,
    blocked: false,
    note: driveFileId
      ? '드라이브 파일로 등록했습니다 — 편집점에서 바로 분석할 수 있습니다'
      : (meta.title ? null : '제목을 읽지 못했습니다'),
  }
}
