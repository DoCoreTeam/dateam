import { createClient } from '@/lib/supabase/server'
import { listDeptTasks } from '../dept-tasks/actions'
import { STATUS_COLORS } from '@/lib/tokens/status-colors'
import NbBadge from '@/components/ui/nb/NbBadge'
import { ClipboardList } from 'lucide-react'
import type { DailyLog } from '@/types/database'

/**
 * 주간보고 조직현황 — 부서 업무 현재 진행 스냅샷 (read-only).
 * 단방향: 표시만 하며 부서업무를 수정하지 않는다. listDeptTasks(RLS 가시범위) 재사용.
 */
export default async function DeptTaskWeeklyPanel({ deptNameMap }: { deptNameMap: Record<string, string> }) {
  const tasks = await listDeptTasks()
  if (tasks.length === 0) return null

  const supabase = await createClient()
  const assigneeIds = Array.from(new Set(tasks.map((t) => t.assignee_user_id).filter(Boolean) as string[]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profs } = await (supabase.from('profiles') as any)
    .select('id,name')
    .in('id', assigneeIds.length ? assigneeIds : ['00000000-0000-0000-0000-000000000000'])
  const nameMap: Record<string, string> = Object.fromEntries(
    ((profs ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  )

  // 부서별 그룹
  const byDept = new Map<string, DailyLog[]>()
  for (const t of tasks) {
    const key = t.department_id ?? 'none'
    if (!byDept.has(key)) byDept.set(key, [])
    byDept.get(key)!.push(t)
  }

  return (
    <div className="card" style={{ padding: 'var(--space-6)', width: '100%', boxSizing: 'border-box', marginTop: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1.25rem' }}>
        <ClipboardList size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>부서 업무 진행 현황</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {Array.from(byDept.entries()).map(([deptId, items]) => {
          const done = items.filter((t) => t.entry_type === 'done').length
          return (
            <div key={deptId}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                <strong>{deptNameMap[deptId] ?? '부서 미지정'}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm, 0.875rem)' }}>완료 {done}/{items.length}</span>
              </div>
              <table className="table-base table-card" style={{ width: '100%' }}>
                <thead>
                  <tr><th>업무</th><th>담당자</th><th>상태</th><th>진행률</th></tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td className="card-header"><span>{t.content}</span></td>
                      <td data-label="담당자">{t.assignee_user_id ? nameMap[t.assignee_user_id] ?? '—' : '미지정'}</td>
                      <td data-label="상태"><NbBadge status={t.entry_type}>{STATUS_COLORS[t.entry_type]?.label ?? t.entry_type}</NbBadge></td>
                      <td data-label="진행률">{t.progress}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}
