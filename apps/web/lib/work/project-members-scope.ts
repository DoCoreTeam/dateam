import 'server-only'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'

// 프로젝트 멤버 org-scope SSOT — listProjectMemberCandidates(actions.ts)와 동일 규칙.
//  멤버 추가/이름 resolve 시 "호출자가 볼 수 있는 조직 범위(가시 person) + 본인"으로 제한.
//  타 조직 user_id 추가(IDOR)·외조직 profile 이름 무차별 수확 차단에 사용.

/** 호출자(callerId)의 org-scope 가시 user_id 집합(+ 본인 포함)을 반환한다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOrgScopeUserIds(admin: any, callerId: string): Promise<Set<string>> {
  const scope = await resolveOrgScope(admin, callerId)
  const ids = new Set<string>([callerId])
  for (const deptId of scope.readableDeptIds) {
    for (const uid of deptMemberUserIds(scope, deptId)) ids.add(uid)
  }
  return ids
}

/** targetId가 callerId의 org-scope 가시 범위 내인지(본인 항상 허용). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isUserInOrgScope(admin: any, callerId: string, targetId: string): Promise<boolean> {
  if (callerId === targetId) return true
  const ids = await getOrgScopeUserIds(admin, callerId)
  return ids.has(targetId)
}
