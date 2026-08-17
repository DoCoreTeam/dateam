// lib/ci/contracts.ts — API 응답 계약 (서버·클라이언트 공용 타입)
// 설계: docs/2026-08-11-v0.6.0-content-intelligence-api/01-api-contract.md
//
// 핵심 규약: 문장형 지표는 서버가 완성해 내려보낸다.
// 클라이언트가 배수를 다시 계산하거나 포맷하지 않는다(§4.3 규격을 한 곳에서만 강제).

import type {
  CiComparability, CiConfidence, CiIngestStatus, CiPipelineStage, CiPlatform,
} from './types.ts'

// ── 공통 봉투 ────────────────────────────────────────────────────

export interface ApiMeta {
  total?: number
  cursor?: string | null
  [k: string]: unknown
}

export type ApiResponse<T> =
  | { success: true; data: T; meta?: ApiMeta }
  | { success: false; error: ApiError }

export interface ApiError {
  code: CiErrorCode
  message: string
  details?: unknown
}

export type CiErrorCode =
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'WORKSPACE_REQUIRED' | 'VALIDATION_FAILED'
  | 'NOT_FOUND' | 'CONFLICT' | 'PLAN_LIMIT_EXCEEDED' | 'QUOTA_EXHAUSTED'
  | 'CONNECTOR_FAILED' | 'AI_BUDGET_EXCEEDED' | 'SETTING_ENCRYPTION_UNAVAILABLE'
  | 'INTERNAL'

export const CI_ERROR_STATUS: Record<CiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  WORKSPACE_REQUIRED: 400,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PLAN_LIMIT_EXCEEDED: 402,
  QUOTA_EXHAUSTED: 429,
  CONNECTOR_FAILED: 502,
  AI_BUDGET_EXCEEDED: 402,
  SETTING_ENCRYPTION_UNAVAILABLE: 500,
  INTERNAL: 500,
}

// ── 콘텐츠 ───────────────────────────────────────────────────────

export interface CiContentListItem {
  id: string
  platform: CiPlatform
  title: string | null
  thumbnailUrl: string | null
  channelId: string | null
  channelName: string | null
  canonicalUrl: string
  ingestStatus: CiIngestStatus
  completeness: number | null
  missingFields: string[]
  topic: { id: string; name: string } | null
  topicConfidence: number | null
  /** 서버가 완성한 문장. 표시 불가면 null */
  outlierText: string | null
  percentileText: string | null
  comparability: CiComparability | null
  confidence: CiConfidence
  publishedAtText: string | null
  firstSeenAt: string
  /**
   * "왜 터졌나" — 배수가 나온 콘텐츠에만 붙는다.
   * 요청한 화면(트렌드 떡상·상세)에서만 채워 내려보낸다. 없으면 undefined.
   */
  creative?: CiCreativeInfo | null
}

/**
 * 크리에이티브 분석 결과의 표시용 형태.
 * 저장은 `ci_content_creative`, 채우는 곳은 `lib/ci/queries/creative.ts`(SSOT).
 */
export interface CiCreativeInfo {
  thumbnailText: string | null
  thumbnailStyle: string[]
  thumbnailSummary: string | null
  hookMessage: string | null
  hookType: string | null
  titlePattern: string[]
  /** 'ai' = 썸네일을 실제로 읽음, 'rules' = 제목 규칙만 */
  source: 'ai' | 'rules'
  /** AI 실패·키 부재 등 한계 고지. 없으면 null */
  note: string | null
  analyzedAtText: string | null
}

export interface CiEvidence {
  windowDays: number
  sampleSize: number
  basisText: string
  includedCount: number
  excludedReasons: { reason: string; count: number }[]
  method: string | null
  fetchedAt: string | null
  missingFields: string[]
}

// ── 홈 ───────────────────────────────────────────────────────────

export interface CiLoopMinimap {
  review: number
  newOutliers: number
  producing: number
  ready: number
  tracking: number
}

export interface CiRefreshState {
  status: 'idle' | 'running' | 'failed'
  progress: number
  newCount: number
  failedCount: number
  lastRunAt: string | null
}

export type CiColdStartStep = 'topic' | 'samples' | 'channels' | 'schedule'

export interface CiHomeData {
  workspaceId: string
  workspaceName: string
  minimap: CiLoopMinimap
  briefing: CiContentListItem[]
  refresh: CiRefreshState
  coldStart: { needed: boolean; step: CiColdStartStep | null }
}

// ── 트렌드 ───────────────────────────────────────────────────────

export interface CiTrendMeta extends ApiMeta {
  population: number
  windowDays: number
  insufficient: boolean
  basisText: string
}

// ── 채널 ─────────────────────────────────────────────────────────

export interface CiChannelListItem {
  id: string
  platform: CiPlatform
  displayName: string
  handle: string | null
  avatarUrl: string | null
  subscriberCount: number | null
  isMonitored: boolean
  ownership: 'owned' | 'tracked'
  sizeBand: string | null
  topic: { id: string; name: string } | null
  lastSeenAt: string | null
  /** 채널 소개문 — 이 채널이 뭐 하는 곳인지 */
  description: string | null
  videoCount: number | null
  profileUrl: string | null
  /** 구독자 수의 출처. 'estimated'는 공개 페이지의 반올림 표기 */
  subscriberProvenance: 'platform' | 'web_verified' | 'estimated' | null
  metaFetchedAt: string | null
  metaError: string | null
  /** 이 채널에서 가져올 기간 ('1m'|'3m'|'1y'|'all') */
  collectWindow: string
  /**
   * 채널 주제 판정 근거 (L1). 사람이 확정했으면 source='user'.
   *
   * 왜 계약에 넣나: 사람이 답할 질문은 "이 채널 뭐 하는 채널이에요?" 하나이고,
   * 그 판단에 필요한 근거가 화면에 없으면 물어봐도 답할 수가 없다.
   */
  topicConfidence: number | null
  topicSource: 'auto' | 'ai_verified' | 'user' | null
  /** 신호 집계를 사람 말로 옮긴 한 문장. 판정 못 하면 null */
  identityText: string | null
  /** 최빈 카테고리 일치도 0~1. 1.0이면 전 게시물이 같은 카테고리다 */
  identityAgreement: number | null
  /** 판정에 쓰인 게시물 수 */
  identitySampleSize: number | null
}

// ── 수집 ─────────────────────────────────────────────────────────

export interface CiIngestAccepted {
  url: string
  /** 링크가 무엇이었는지 — 시스템이 판별한 결과(사용자가 고르지 않는다) */
  kind: 'content' | 'channel'
  /** 게시물 링크였을 때만 */
  contentId: string | null
  /** 채널·프로필 링크였을 때만 */
  channelId: string | null
  jobId: string
  status: 'queued'
}

export interface CiIngestRejected {
  url: string
  code: 'UNSUPPORTED_PLATFORM' | 'DUPLICATE' | 'INVALID_URL'
  message: string
}

export interface CiIngestResult {
  accepted: CiIngestAccepted[]
  rejected: CiIngestRejected[]
}

// ── 파이프라인 ───────────────────────────────────────────────────

export interface CiIdeaCard {
  id: string
  title: string
  stage: CiPipelineStage
  evidenceBadge: string | null
  targetPlatforms: CiPlatform[]
  daysInStage: number
}
