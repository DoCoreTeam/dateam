import { createHash } from 'node:crypto'

/**
 * Engine A(전체/개인/부서필터) 취합 스코프를 org_weekly_reports.scope_key로 인코딩(SSOT).
 * - 전체 조직: 'all'
 * - 개인(member): 'member:<user_id>'
 * - 부서필터(memberIds): 'dept:<sha1(sorted uids)>' — 멤버 구성이 같으면 항상 같은 키
 *
 * member와 memberIds가 함께 오면 memberIds(부서필터)를 우선한다(라우트 우선순위와 일치).
 */
export function orgScopeKey(member: string | null | undefined, memberIds: string[] | null | undefined): string {
  const ids = (memberIds ?? []).map((s) => s.trim()).filter(Boolean)
  if (ids.length > 0) {
    const norm = [...ids].sort().join(',')
    return `dept:${createHash('sha1').update(norm).digest('hex')}`
  }
  if (member) return `member:${member}`
  return 'all'
}
