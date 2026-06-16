'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgScopeUserIds } from '@/lib/work/project-members-scope'

// 프로젝트 투입인원 후보 = 내가 조회 가능한 조직 범위(readableDeptIds 서브트리)의 person.
// dept-tasks listAssigneeCandidates 패턴 재사용(org-scope SSOT) — 부서 단위가 아닌 내 가시 범위 전체.
// 전사 권한이면 모든 person. 이름순 정렬, deleted 제외.

export interface MemberCandidate {
  userId: string
  name: string
}

export async function listProjectMemberCandidates(): Promise<MemberCandidate[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const admin = createAdminClient()
  // 내 가시 부서들의 person user_id 합집합(+ 본인 포함) — org-scope SSOT
  const ids = await getOrgScopeUserIds(admin, user.id)
  if (ids.size === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('profiles')
    .select('id, name')
    .in('id', Array.from(ids))
    .is('deleted_at', null)

  return ((data ?? []) as Array<{ id: string; name: string }>)
    .map((p) => ({ userId: p.id, name: p.name ?? '(이름없음)' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
