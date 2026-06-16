import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveOrgScope } from '@/lib/org-scope'
import { listDeptTasks, getDeptTaskActors } from './actions'
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

  // 작성자/담당자 이름 맵 + 원본 일일 인용 (SSOT — getDeptTaskActors 재사용)
  const { origins, nameMap } = await getDeptTaskActors(
    tasks.map((t: DailyLog) => ({
      id: t.id,
      user_id: t.user_id,
      assignee_user_id: t.assignee_user_id,
      promoted_from_log_id: t.promoted_from_log_id,
    })),
  )

  return (
    <DeptTasksClient
      initialTasks={tasks}
      creatableDepts={creatableDepts}
      editableDeptIds={editableDeptIds}
      currentUserId={user.id}
      nameMap={nameMap}
      deptNameMap={deptNameMap}
      origins={origins}
    />
  )
}
