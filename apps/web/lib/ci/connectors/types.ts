// lib/ci/connectors/types.ts — 커넥터 계약 (설계: 02-ucm-and-connectors.md §3)

import type { CiComparability, CiContentFormat, CiPlatform } from '../types.ts'

export type IngestMethod = 'official_api' | 'oembed' | 'meta_tags' | 'render'

export interface UcmMetrics {
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  capturedAt: string
}

export interface UcmProvenance {
  method: IngestMethod
  attemptedMethods: IngestMethod[]
  fetchedAt: string
  verified: 'platform' | 'web_verified' | 'estimated'
  missingFields: string[]
  notes?: string
}

export interface UcmChannelRef {
  platform: CiPlatform
  externalId: string | null
  handle: string | null
  displayName: string | null
  profileUrl: string | null
  avatarUrl: string | null
  subscriberCount: number | null
}

export interface UcmContent {
  platform: CiPlatform
  externalId: string
  canonicalUrl: string
  channel: UcmChannelRef | null
  format: CiContentFormat
  title: string | null
  caption: string | null
  publishedAt: string | null
  durationSec: number | null
  language: string | null
  thumbnailUrl: string | null
  comparability: CiComparability
  metrics: UcmMetrics
  provenance: UcmProvenance
}

export class ConnectorError extends Error {
  readonly code = 'CONNECTOR_FAILED'
  // 파라미터 프로퍼티는 node --test의 strip-only 모드가 지원하지 않는다 → 명시 필드로 둔다
  readonly platform: CiPlatform
  readonly attempted: IngestMethod[]

  constructor(platform: CiPlatform, attempted: IngestMethod[], message: string) {
    super(message)
    this.name = 'ConnectorError'
    this.platform = platform
    this.attempted = attempted
  }
}

export interface ConnectorCtx {
  /** 플랫폼 API 키 (없으면 커넥터가 다음 방법으로 폴백) */
  apiKey?: string
  /** 쿼터 소모를 기록하는 콜백 */
  onQuotaSpend?: (units: number) => void
  signal?: AbortSignal
}

export interface Connector {
  platform: CiPlatform
  methodChain: IngestMethod[]
  fetchContent(externalId: string, canonicalUrl: string, ctx: ConnectorCtx): Promise<UcmContent>
}
