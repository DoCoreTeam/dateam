// lib/ci/media/capability.ts — "이 게시물의 영상 실체에 닿을 수 있는가" 능력표 (SSOT)
//
// 왜 이 파일이 따로 있나:
// 지금까지 CI의 분석은 **플랫폼이 알려준 것**(제목·설명·태그)만 증거로 썼다.
// 숏폼은 플랫폼이 알려주는 것이 거의 없다 — 실측 423건 중 227건이 설명문 없음, 키워드 0건.
// 그래서 "설명문을 확보하지 못했습니다"라는 화면이 나왔는데, 그건 정보가 없는 게 아니라
// **영상을 안 본 것**이었다. 영상 32초 안에 대사·자막·구성·연출이 전부 들어 있다.
//
// 다만 영상에 닿는 방법은 플랫폼마다 다르고, 닿을 수 없는 플랫폼도 있다.
// 그 차이를 코드 여기저기의 if 문으로 흩으면 "왜 이건 되고 저건 안 되나"를 아무도 답할 수 없다.
// 그래서 **능력을 데이터로 선언**하고, 호출부는 이 표만 읽는다.

import type { CiPlatform } from '../types.ts'

/** 영상 실체에 닿는 방법. 위에 있을수록 얻는 것이 많다. */
export type MediaAccess =
  /** 모델에 영상 주소를 그대로 넘겨 영상을 통째로 읽힌다 (대사·자막·컷·오디오 전부) */
  | 'remote_video'
  /** 영상은 못 읽고 정지 이미지(썸네일/커버)만 읽는다 */
  | 'still_image'
  /** 영상에도 이미지에도 닿지 못한다 */
  | 'none'

export interface PlatformMediaCapability {
  access: MediaAccess
  /**
   * 사용자에게 보여줄 한 문장. 못 하는 경우 **왜 못 하는지**를 말한다.
   * 빈 화면에 아무 설명이 없으면 사용자는 고장으로 읽는다.
   */
  note: string
}

/**
 * 플랫폼별 능력.
 *
 * remote_video가 YouTube뿐인 것은 게으름이 아니다 — 실측 기준이다.
 * Gemini는 공개 YouTube 주소를 직접 받아 영상을 읽는다(fileData.fileUri).
 * TikTok·Instagram·Facebook은 영상 파일에 인증 없이 닿을 수 없어, 지금은 커버 이미지가 최선이다.
 * 새 방법이 생기면 **이 표만** 고친다.
 */
export const MEDIA_CAPABILITY: Record<CiPlatform, PlatformMediaCapability> = {
  youtube: {
    access: 'remote_video',
    note: '영상을 직접 보고 분석합니다',
  },
  tiktok: {
    access: 'still_image',
    note: 'TikTok은 영상 파일을 공개하지 않아 커버 이미지까지만 분석합니다',
  },
  instagram: {
    access: 'still_image',
    note: 'Instagram은 영상 파일을 공개하지 않아 커버 이미지까지만 분석합니다',
  },
  facebook: {
    access: 'still_image',
    note: 'Facebook은 영상 파일을 공개하지 않아 커버 이미지까지만 분석합니다',
  },
  x: {
    access: 'still_image',
    note: 'X는 영상 파일을 공개하지 않아 첨부 이미지까지만 분석합니다',
  },
  threads: {
    access: 'still_image',
    note: 'Threads는 영상 파일을 공개하지 않아 첨부 이미지까지만 분석합니다',
  },
}

export function mediaCapability(platform: CiPlatform): PlatformMediaCapability {
  return MEDIA_CAPABILITY[platform] ?? { access: 'none', note: '지원하지 않는 플랫폼입니다' }
}

/**
 * 이 게시물에 실제로 쓸 방법을 정한다.
 *
 * 능력표는 "플랫폼이 무엇을 허락하는가"이고, 이 함수는 "이 한 건에 무엇이 있는가"를 함께 본다.
 * 능력이 remote_video여도 주소가 없으면 영상을 읽을 수 없다.
 */
export function resolveAccess(input: {
  platform: CiPlatform
  canonicalUrl: string | null
  thumbnailUrl: string | null
}): { access: MediaAccess; note: string } {
  const cap = mediaCapability(input.platform)

  if (cap.access === 'remote_video' && input.canonicalUrl) {
    return { access: 'remote_video', note: cap.note }
  }
  if (input.thumbnailUrl) {
    return {
      access: 'still_image',
      note: cap.access === 'remote_video'
        ? '영상 주소가 없어 커버 이미지까지만 분석합니다'
        : cap.note,
    }
  }
  return { access: 'none', note: '분석할 영상도 이미지도 확보하지 못했습니다' }
}
