/**
 * 조직과 역할 (설계서 F12)
 *
 * ## 역할이 셋인 이유
 *
 *   admin  — 설정과 키와 요금제를 만진다
 *   member — 케이스를 만들고 분석을 건다
 *   viewer — 읽기만 한다
 *
 * viewer 를 두는 이유는 **비용 때문**이다. 분석 한 번이 돈이라 아무나 걸면 안 되는데,
 * 리포트는 여러 사람이 본다. 읽기만 하는 자리가 없으면 그 사람들에게 member 를 주게 되고
 * 그러면 아무나 분석을 건다.
 */

export type OrgRole = 'admin' | 'member' | 'viewer'

export const ORG_ROLES: readonly OrgRole[] = ['admin', 'member', 'viewer']

/** 무엇을 할 수 있나 */
export type Capability =
  | 'read'
  | 'create_case'
  | 'run_analysis'
  | 'run_cross'
  | 'edit_profile'
  | 'manage_members'
  | 'manage_settings'
  | 'manage_billing'

const ROLE_CAPS: Record<OrgRole, readonly Capability[]> = {
  viewer: ['read'],
  member: ['read', 'create_case', 'run_analysis', 'run_cross', 'edit_profile'],
  admin: ['read', 'create_case', 'run_analysis', 'run_cross', 'edit_profile',
          'manage_members', 'manage_settings', 'manage_billing'],
}

export function can(role: OrgRole | null, cap: Capability): boolean {
  if (!role) return false
  return ROLE_CAPS[role].includes(cap)
}

export function capsOf(role: OrgRole): readonly Capability[] {
  return ROLE_CAPS[role]
}

export interface Org {
  id: string
  name: string
  planId: string
}

export type OrgProblem = 'no_name' | 'name_too_long' | 'unknown_plan'

export const MAX_ORG_NAME = 100

/**
 * 조직 만들기 값을 검사한다.
 *
 * 모르는 요금제를 받지 않는다 — 받으면 상한이 없는 조직이 생기고
 * 그 조직의 비용이 아무 데도 안 걸린다.
 */
export function validateOrg(
  raw: unknown,
  knownPlans: readonly string[],
): { org: Partial<Org>; problems: OrgProblem[] } {
  const body = (raw ?? {}) as Record<string, unknown>
  const problems: OrgProblem[] = []

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) problems.push('no_name')
  if (name.length > MAX_ORG_NAME) problems.push('name_too_long')

  const planId = typeof body.planId === 'string' ? body.planId : 'starter'
  if (!knownPlans.includes(planId)) problems.push('unknown_plan')

  return { org: { name: name.slice(0, MAX_ORG_NAME), planId }, problems }
}

/** 마지막 관리자를 못 내리게 한다 — 내리면 아무도 설정을 못 만진다 */
export function canDemote(members: readonly { userId: string; role: OrgRole }[], userId: string): boolean {
  const admins = members.filter((m) => m.role === 'admin')
  if (admins.length > 1) return true
  return !admins.some((m) => m.userId === userId)
}
