'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { DailyLog, DailyLogEntryType } from '@/types/database'
import type { DeptTaskOrigin } from './actions'
import { STATUS_COLORS } from '@/lib/tokens/status-colors'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import WorkPageShell from '@/components/ui/WorkPageShell'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import { listDeptTasks } from './actions'
import DeptTaskFormModal from './DeptTaskFormModal'
import DeptTaskDetail from './DeptTaskDetail'
import DeptTaskSuggestPanel from './DeptTaskSuggestPanel'
import { consumeWorkflowHandoff } from '@/lib/ai-chat/workflow-handoff'

export interface DeptOption { id: string; name: string }

interface Props {
  initialTasks: DailyLog[]
  creatableDepts: DeptOption[]
  editableDeptIds: string[]
  currentUserId: string
  nameMap: Record<string, string>
  deptNameMap: Record<string, string>
  origins: Record<string, DeptTaskOrigin>
}

const STATUS_FILTERS: Array<{ value: DailyLogEntryType | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'planned', label: '예정' },
  { value: 'doing', label: '진행중' },
  { value: 'blocker', label: '블로커' },
  { value: 'done', label: '완료' },
]

export default function DeptTasksClient({
  initialTasks, creatableDepts, editableDeptIds, currentUserId, nameMap, deptNameMap, origins,
}: Props) {
  const searchParams = useSearchParams()
  const [tasks, setTasks] = useState<DailyLog[]>(initialTasks)
  const [filter, setFilter] = useState<DailyLogEntryType | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(false)
  const [handoffContent, setHandoffContent] = useState<string | null>(null)

  // 일일업무 "부서업무 연결됨" 뱃지 → /dept-tasks?task=ID 진입 시 해당 업무 자동 선택
  const taskParam = searchParams.get('task')
  useEffect(() => {
    if (taskParam && tasks.some((t) => t.id === taskParam)) setSelectedId(taskParam)
  }, [taskParam, tasks])

  // §FR-11-3 업무 흐름 연계 — 목록 심층분석에서 "부서업무로 전달" 시 새 업무 폼을 프리필해 자동으로 연다.
  // 자동 등록 금지: 폼만 열고 채운다. 저장은 사용자가 직접 확정.
  useEffect(() => {
    if (searchParams.get('handoff') !== '1') return
    const payload = consumeWorkflowHandoff('dept-task')
    if (!payload) return
    setHandoffContent(`${payload.title}\n\n${payload.bodyMd}`)
    setShowCreate(true)
  }, [searchParams])

  const refresh = useCallback(async () => {
    const next = await listDeptTasks()
    setTasks(next)
  }, [])

  const visible = filter === 'all' ? tasks : tasks.filter((t) => t.entry_type === filter)
  const selected = tasks.find((t) => t.id === selectedId) ?? null
  const canCreate = creatableDepts.length > 0
  // 코어 필드 수정 권한: 작성자 또는 부서장
  const selectedDeptEditable = !!selected?.department_id && editableDeptIds.includes(selected.department_id)
  const canEditSelected = !!selected && (selected.user_id === currentUserId || selectedDeptEditable)

  return (
    <WorkPageShell
      title="부서 업무"
      description="부서 단위 업무를 등록하고 담당자·진행을 관리합니다"
      actions={canCreate ? <NbButton onClick={() => setShowCreate(true)} aria-label="새 부서 업무 등록">+ 새 업무</NbButton> : undefined}
      subTabs={
        <WorkSubTabs
          items={STATUS_FILTERS.map((f) => ({ key: f.value, label: f.label }))}
          activeKey={filter}
          onSelect={(k) => setFilter(k as DailyLogEntryType | 'all')}
          ariaLabel="상태 필터"
        />
      }
    >
      {canCreate && (
        <DeptTaskSuggestPanel creatableDepts={creatableDepts} editableDeptIds={editableDeptIds} onRegistered={refresh} />
      )}

      <div className="responsive-grid-2">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {visible.length === 0 ? (
            <p style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
              표시할 부서 업무가 없습니다.
            </p>
          ) : (
            <table className="table-base table-card" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>업무</th><th>부서</th><th>담당자</th><th>상태</th><th>진행률</th><th>마감</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${t.content} 상세 보기`}
                    onClick={() => setSelectedId(t.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(t.id) } }}
                    style={{ cursor: 'pointer', background: t.id === selectedId ? 'var(--surface-bg)' : undefined }}
                  >
                    <td className="card-header"><span>{t.content}</span></td>
                    <td data-label="부서">{t.department_id ? deptNameMap[t.department_id] ?? '—' : '—'}</td>
                    <td data-label="담당자">{t.assignee_user_id ? nameMap[t.assignee_user_id] ?? '—' : '미지정'}</td>
                    <td data-label="상태"><NbBadge status={t.entry_type}>{STATUS_COLORS[t.entry_type]?.label ?? t.entry_type}</NbBadge></td>
                    <td data-label="진행률">{t.progress}%</td>
                    <td data-label="마감" className="card-hide">{t.target_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside>
          {selected ? (
            <DeptTaskDetail
              key={selected.id}
              task={selected}
              currentUserId={currentUserId}
              canAssign={selectedDeptEditable}
              canEdit={canEditSelected}
              nameMap={nameMap}
              deptNameMap={deptNameMap}
              originContent={origins[selected.id]?.originContent ?? null}
              onChanged={refresh}
              onEdit={() => setEditing(true)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="card" style={{ padding: 'var(--space-6)', color: 'var(--text-muted)', textAlign: 'center' }}>
              업무를 선택하면 상세·댓글이 표시됩니다.
            </div>
          )}
        </aside>
      </div>

      {showCreate && (
        <DeptTaskFormModal
          creatableDepts={creatableDepts}
          initialContent={handoffContent ?? undefined}
          onClose={() => { setShowCreate(false); setHandoffContent(null) }}
          onSaved={async () => { setShowCreate(false); setHandoffContent(null); await refresh() }}
        />
      )}

      {editing && selected && (
        <DeptTaskFormModal
          creatableDepts={creatableDepts}
          task={selected}
          canEditDept={selectedDeptEditable}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); await refresh() }}
        />
      )}
    </WorkPageShell>
  )
}
