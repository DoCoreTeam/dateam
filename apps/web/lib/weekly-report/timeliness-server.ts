import 'server-only'
import { judgeTimeliness, summarizeActivity, type MemberTimeliness, type ActivityEntry } from './timeliness'
import { deptMemberUserIds, type OrgScope } from '@/lib/org-scope'

// 부서별 멤버 적시성 집계(서버) — 활동로그(최초/최종) + 취합 confirmed_at + judgeTimeliness(SSOT).
// 읽기는 기존 패턴(admin client + resolveOrgScope)을 따른다. RLS는 admin client가 우회하므로
// 호출처(page)에서 scope로 가시 범위를 이미 제한해 넘긴다.

interface ActivityRow { user_id: string; occurred_at: string; action: string }
interface ProfileRow { id: string; name: string | null }
interface ConfRow { department_id: string; confirmed_at: string | null }

const NIL = '00000000-0000-0000-0000-000000000000'

export async function computeDeptTimeliness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  scope: OrgScope,
  deptIds: string[],
  weekStart: string,
): Promise<Record<string, MemberTimeliness[]>> {
  const allMembers = Array.from(new Set(deptIds.flatMap((d) => deptMemberUserIds(scope, d))))
  if (allMembers.length === 0) return {}

  const [actsRes, profsRes, snapsRes] = await Promise.all([
    admin.from('weekly_report_activity').select('user_id, occurred_at, action')
      .eq('week_start', weekStart).in('user_id', allMembers) as Promise<{ data: ActivityRow[] | null }>,
    admin.from('profiles').select('id, name').in('id', allMembers) as Promise<{ data: ProfileRow[] | null }>,
    admin.from('dept_weekly_reports').select('department_id, confirmed_at')
      .eq('week_start', weekStart).in('department_id', deptIds.length ? deptIds : [NIL]) as Promise<{ data: ConfRow[] | null }>,
  ])

  // 멤버별 활동로그 수집 → summarizeActivity(SSOT 순수함수)로 최초/최종 작성시각 산출.
  const byUser = new Map<string, ActivityEntry[]>()
  for (const a of actsRes.data ?? []) {
    const arr = byUser.get(a.user_id) ?? []
    arr.push({ occurredAt: a.occurred_at, action: a.action as ActivityEntry['action'] })
    byUser.set(a.user_id, arr)
  }
  const nameMap = new Map((profsRes.data ?? []).map((p) => [p.id, p.name ?? '알 수 없음']))
  const confMap = new Map((snapsRes.data ?? []).map((s) => [s.department_id, s.confirmed_at]))
  const now = new Date().toISOString()

  const out: Record<string, MemberTimeliness[]> = {}
  for (const deptId of deptIds) {
    const conf = confMap.get(deptId) ?? null
    out[deptId] = deptMemberUserIds(scope, deptId).map((uid) => {
      const { firstAt, lastAt } = summarizeActivity(byUser.get(uid) ?? [])
      const j = judgeTimeliness({ firstAt, lastAt, confirmedAt: conf, weekStart, now })
      return {
        userId: uid, name: nameMap.get(uid) ?? '알 수 없음',
        status: j.status, delayMinutes: j.delayMinutes,
        firstAt, lastAt, confirmedAt: conf,
      }
    })
  }
  return out
}
