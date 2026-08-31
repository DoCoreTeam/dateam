// lib/ci/types.ts — 콘텐츠 인텔리전스 도메인 타입 SSOT
// 설계: docs/2026-08-11-v0.5.0-content-intelligence-schema/01-db-schema.md
// DB ENUM과 1:1로 대응한다. 값 추가 시 마이그레이션과 함께 갱신할 것.

export type CiMemberRole = 'owner' | 'admin' | 'member' | 'viewer'
export type CiSettingScope = 'system' | 'workspace' | 'user'
export type CiPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'x' | 'threads'
export type CiContentFormat = 'short' | 'long' | 'image' | 'text' | 'live'
export type CiChannelOwnership = 'owned' | 'tracked'
export type CiIngestStatus = 'queued' | 'running' | 'done' | 'partial' | 'failed'
export type CiContentSource = 'inbox' | 'monitoring'
export type CiReviewState = 'none' | 'pending' | 'resolved'
export type CiComparability = 'A' | 'B' | 'C'
export type CiConfidence = 'high' | 'medium' | 'insufficient'
export type CiTopicSource = 'auto' | 'ai_verified' | 'user'
export type CiPipelineStage = 'idea' | 'brief' | 'edit' | 'ready'
export type CiPublishRoute = 'manual' | 'api'
export type CiPublishStatus = 'draft' | 'scheduled' | 'exported' | 'published' | 'failed'
/**
 * 잡 단계.
 *
 * 'signals' 는 콘텐츠 파이프라인의 한 칸이 아니라 **워크스페이스 단위 주기 작업**이다
 * (바깥 웹을 훑어 이슈 후보를 모은다). 큐에 태우는 이유는 재시도·백오프·실패 큐를
 * 새로 짜지 않기 위해서다. 체인은 여기서 끝난다(policy.nextStage 가 null 을 준다).
 */
export type CiJobStage =
  | 'ingest' | 'normalize' | 'enrich' | 'classify' | 'verify' | 'project'
  | 'signals'

/** 이슈의 종류. DB의 ci_signals.kind check 제약과 같은 값이다. */
export type CiSignalKind = 'news' | 'search_spike' | 'community'
export type CiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'
export type CiCorrectionKind =
  | 'topic' | 'group_unlink' | 'outlier_dismiss' | 'channel_link' | 'field_fix'

export const CI_PLATFORMS: readonly CiPlatform[] =
  ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'threads'] as const

export const CI_PIPELINE_STAGES: readonly CiPipelineStage[] =
  ['idea', 'brief', 'edit', 'ready'] as const

export const CI_JOB_STAGES: readonly CiJobStage[] =
  ['ingest', 'normalize', 'enrich', 'classify', 'verify', 'project', 'signals'] as const

/** 역할 서열. 숫자가 클수록 권한이 넓다. */
export const CI_ROLE_RANK: Record<CiMemberRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

export function ciRoleAtLeast(role: CiMemberRole | null, min: CiMemberRole): boolean {
  if (!role) return false
  return CI_ROLE_RANK[role] >= CI_ROLE_RANK[min]
}

/** 화면 라벨 SSOT — 컴포넌트마다 문자열을 복붙하지 않는다. */
export const CI_PLATFORM_LABEL: Record<CiPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  threads: 'Threads',
}

export const CI_INGEST_STATUS_LABEL: Record<CiIngestStatus, string> = {
  queued: '수집 중',
  running: '수집 중',
  done: '완료',
  partial: '일부만 수집됨',
  failed: '실패',
}

export const CI_STAGE_LABEL: Record<CiPipelineStage, string> = {
  idea: '아이디어',
  brief: '기획',
  edit: '편집',
  ready: '게시 준비',
}
