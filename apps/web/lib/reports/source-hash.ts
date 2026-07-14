import { createHash } from 'node:crypto'

export interface SourceHashRow {
  user_id: string
  category: string
  performance: string
  plan: string
  issues: string
}

/**
 * 주간보고 원본 N건 기준 SHA1 해시 (재취합 필요 감지 — SSOT).
 * 부서 취합(org-actions.aggregateDept)과 전체/개인 취합(api/reports/preview)이 공유한다.
 * 원본 스키마(구분·성과·계획·이슈) 변경 시 이 한 곳만 고치면 두 취합 경로가 동시 반영된다.
 */
export function reportsSourceHash(rows: SourceHashRow[]): string {
  const norm = rows
    .map((r) => `${r.user_id}|${r.category}|${r.performance}|${r.plan}|${r.issues}`)
    .sort()
    .join('\n')
  return createHash('sha1').update(norm).digest('hex')
}
