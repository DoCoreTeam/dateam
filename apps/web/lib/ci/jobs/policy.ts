// lib/ci/jobs/policy.ts — 잡 재시도·멱등 정책 (순수 함수)
// DB 클라이언트를 임포트하지 않는다. 정책만 담아 단위 테스트가 붙을 수 있게 분리한다.

import type { CiJobStage, CiJobStatus } from '../types.ts'

/** 지수 백오프 3회 (설계서 §11.2) */
export const MAX_ATTEMPTS = 3

/** 1분 → 4분 → 9분. 상한 1시간 — 재시도가 무한정 밀리지 않게. */
export function backoffSeconds(attempt: number): number {
  return Math.min(3600, 60 * attempt * attempt)
}

/**
 * 멱등키. 같은 대상에 같은 단계를 두 번 넣어도 잡은 하나만 산다.
 * DB의 unique 인덱스가 최종 방어선이고, 이 함수가 키를 만드는 SSOT다.
 */
export function idempotencyKey(stage: CiJobStage, targetId: string, version = 1): string {
  return `${stage}:${targetId}:${version}`
}

/** 실패한 잡의 다음 상태. 한도를 넘으면 실패 큐(DLQ)로 간다. */
export function nextStatusAfterFailure(attempt: number, maxAttempts: number): CiJobStatus {
  return attempt >= maxAttempts ? 'dead' : 'failed'
}

/** 파이프라인 단계 순서 — 한 단계가 끝나면 다음 단계 잡을 건다. */
const CHAIN: CiJobStage[] = ['ingest', 'normalize', 'enrich', 'classify', 'verify', 'project']

export function nextStage(current: CiJobStage): CiJobStage | null {
  const i = CHAIN.indexOf(current)
  return i >= 0 && i < CHAIN.length - 1 ? CHAIN[i + 1] : null
}
