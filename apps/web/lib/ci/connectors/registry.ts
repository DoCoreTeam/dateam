// lib/ci/connectors/registry.ts — 플랫폼별 커넥터 등록소 (SSOT)
// 플랫폼을 추가할 때 손대는 곳은 여기 하나다. 잡 핸들러는 이 등록소만 본다.

import { youtubeConnector } from './youtube.ts'
import { fetchHtml, fetchOEmbed, parseMeta, buildUcmFromMeta } from './meta-tags.ts'
import { ConnectorError, type Connector, type IngestMethod, type UcmContent } from './types.ts'
import type { CiContentFormat, CiPlatform } from '../types.ts'

interface MetaConnectorSpec {
  platform: CiPlatform
  /** oEmbed 엔드포인트 생성기. 없으면 메타 태그만 쓴다. */
  oembed?: (canonicalUrl: string) => string
  defaultFormat: CiContentFormat
  chain: IngestMethod[]
}

/**
 * oEmbed → meta_tags 체인을 도는 공통 커넥터를 만든다.
 * 앞 단계가 실패해야만 다음으로 내려간다(설계서 §3-2).
 */
function makeMetaConnector(spec: MetaConnectorSpec): Connector {
  return {
    platform: spec.platform,
    methodChain: spec.chain,

    async fetchContent(externalId, canonicalUrl, ctx) {
      const attempted: IngestMethod[] = []

      // 1) oEmbed — 제공하는 플랫폼만
      let oembed = null
      if (spec.oembed) {
        attempted.push('oembed')
        oembed = await fetchOEmbed(spec.oembed(canonicalUrl), ctx.signal)
      }

      // 2) 메타 태그
      attempted.push('meta_tags')
      const html = await fetchHtml(canonicalUrl, ctx.signal)
      const meta = html
        ? parseMeta(html)
        : { title: null, description: null, image: null, siteName: null, author: null, publishedAt: null, durationSec: null }

      const gotSomething = Boolean(oembed?.title || meta.title || meta.description || meta.image)
      if (!gotSomething) {
        throw new ConnectorError(
          spec.platform, attempted,
          '이 게시물의 정보를 가져오지 못했습니다. 비공개이거나 삭제되었을 수 있습니다',
        )
      }

      return buildUcmFromMeta({
        platform: spec.platform,
        externalId,
        canonicalUrl,
        format: spec.defaultFormat,
        meta,
        oembed,
        attempted,
        method: oembed?.title ? 'oembed' : 'meta_tags',
        baseComparability: 'C',
      }) as UcmContent
    },
  }
}

const tiktokConnector = makeMetaConnector({
  platform: 'tiktok',
  oembed: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  defaultFormat: 'short',
  chain: ['oembed', 'meta_tags', 'render'],
})

const instagramConnector = makeMetaConnector({
  platform: 'instagram',
  defaultFormat: 'image',
  chain: ['official_api', 'oembed', 'meta_tags', 'render'],
})

const facebookConnector = makeMetaConnector({
  platform: 'facebook',
  defaultFormat: 'long',
  chain: ['official_api', 'meta_tags', 'render'],
})

const xConnector = makeMetaConnector({
  platform: 'x',
  defaultFormat: 'text',
  chain: ['meta_tags', 'render'],
})

const threadsConnector = makeMetaConnector({
  platform: 'threads',
  defaultFormat: 'text',
  chain: ['meta_tags', 'render'],
})

export const CONNECTORS: Record<CiPlatform, Connector> = {
  youtube: youtubeConnector,
  tiktok: tiktokConnector,
  instagram: instagramConnector,
  facebook: facebookConnector,
  x: xConnector,
  threads: threadsConnector,
}

export function getConnector(platform: CiPlatform): Connector {
  return CONNECTORS[platform]
}
