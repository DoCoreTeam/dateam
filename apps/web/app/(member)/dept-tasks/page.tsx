import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveOrgScope } from '@/lib/org-scope'
import { listDeptTasks } from './actions'
import DeptTasksClient from './DeptTasksClient'
import type { DailyLog } from '@/types/database'

export const dynamic = 'force-dynamic'

export default async function DeptTasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const scope = await resolveOrgScope(admin, user.id)
  const deptNodes = scope.nodes.filter((n) => n.type === 'department')
  const deptNameMap: Record<string, string> = Object.fromEntries(deptNodes.map((n) => [n.id, n.name]))

  // 내가 등록 가능한 부서(=가시 부서), 담당자 지정 가능 부서(=내가 head인 부서/전사)
  const creatableDepts = deptNodes
    .filter((n) => scope.isExecutive || scope.readableDeptIds.includes(n.id))
    .map((n) => ({ id: n.id, name: n.name }))
  const editableDeptIds = scope.isExecutive ? deptNodes.map((n) => n.id) : scope.editableDeptIds

  const tasks = await listDeptTasks()

  // 작성자/담당자 이름 맵 (profiles는 인증자 전체 열람 가능)
  const ids = Array.from(
    new Set(tasks.flatMap((t: DailyLog) => [t.user_id, t.assignee_user_id]).filter(Boolean) as string[]),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profs } = await (supabase.from('profiles') as any)
    .select('id,name')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const nameMap: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((profs ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  )

  return (
    <DeptTasksClient
      initialTasks={tasks}
      creatableDepts={creatableDepts}
      editableDeptIds={editableDeptIds}
      currentUserId={user.id}
      nameMap={nameMap}
      deptNameMap={deptNameMap}
    />
  )
}
