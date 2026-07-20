// 조직 현황 탭 데이터 로드(서버 전용) — 부서 카드 통계 + 취합본 + 적시성 + admin 게이트.
// weekly-report/page.tsx에서 분리(300줄 제약). orgWeekStart는 무제한 과거 허용(org 탭 화살표 네비).

import { deptMemberUserIds, type OrgScope } from '../org-scope'
import { computeDeptTimeliness } from './timeliness-server'
import type { MemberTimeliness } from './timeliness'

interface AuthorBlock { name: string; rank?: string; performance: string; plan: string; issues: string }
export interface MergedRow { category: string; authors: AuthorBlock[] }
export interface OrgDeptStat { memberCount: number; reportedCount: number; agg: 'none' | 'draft' | 'confirmed' }

export interface OrgWeeklyData {
  orgDeptStats: Record<string, OrgDeptStat>
  orgDeptBodies: Record<string, MergedRow[]>
  orgDeptTimeliness: Record<string, MemberTimeliness[]>
  isAdmin: boolean
}

const EMPTY: OrgWeeklyData = { orgDeptStats: {}, orgDeptBodies: {}, orgDeptTimeliness: {}, isAdmin: false }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

/** 조직 현황 탭 데이터 일괄 로드. 조직 스코프의 readable 부서 전체 기준(배치 조회 — N+1 없음). */
export async function loadOrgWeeklyData(
  admin: AdminClient,
  orgScope: OrgScope,
  orgWeekStart: string,
  userId: string,
): Promise<OrgWeeklyData> {
  const readable = orgScope.readableDeptIds
  const [{ data: weekReps }, { data: snaps }, { data: meRole }] = await Promise.all([
    admin.from('weekly_reports').select('user_id').eq('week_start', orgWeekStart).is('deleted_at', null),
    admin.from('dept_weekly_reports').select('department_id, body, status').eq('week_start', orgWeekStart)
      .in('department_id', readable.length ? readable : ['00000000-0000-0000-0000-000000000000']),
    admin.from('profiles').select('role').eq('id', userId).single(),
  ])
  const reporters = new Set<string>((weekReps ?? []).map((r: { user_id: string }) => r.user_id))
  const snapMap = new Map(
    (snaps ?? []).map((s: { department_id: string; body: MergedRow[]; status: 'draft' | 'confirmed' }) => [s.department_id, s]),
  )
  const orgDeptStats: Record<string, OrgDeptStat> = {}
  const orgDeptBodies: Record<string, MergedRow[]> = {}
  for (const deptId of readable) {
    const members = deptMemberUserIds(orgScope, deptId)
    const snap = snapMap.get(deptId) as { body: MergedRow[]; status: 'draft' | 'confirmed' } | undefined
    orgDeptStats[deptId] = {
      memberCount: members.length,
      reportedCount: members.filter((m) => reporters.has(m)).length,
      agg: snap ? snap.status : 'none',
    }
    if (snap) orgDeptBodies[deptId] = snap.body ?? []
  }
  const orgDeptTimeliness = await computeDeptTimeliness(admin, orgScope, readable, orgWeekStart)
  return { orgDeptStats, orgDeptBodies, orgDeptTimeliness, isAdmin: (meRole as { role?: string } | null)?.role === 'admin' }
}

export { EMPTY as EMPTY_ORG_WEEKLY }
