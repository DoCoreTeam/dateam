'use client'

import { useState, useCallback } from 'react'
import type { DailyLog, DailyLogEntryType } from '@/types/database'
import { STATUS_COLORS } from '@/lib/tokens/status-colors'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import WorkTabBar from '@/components/ui/WorkTabBar'
import PageHeader from '@/components/ui/PageHeader'
import { listDeptTasks } from './actions'
import DeptTaskFormModal from './DeptTaskFormModal'
import DeptTaskDetail from './DeptTaskDetail'
import DeptTaskSuggestPanel from './DeptTaskSuggestPanel'

export interface DeptOption { id: string; name: string }

interface Props {
  initialTasks: DailyLog[]
  creatableDepts: DeptOption[]
  editableDeptIds: string[]
  currentUserId: string
  nameMap: Record<string, string>
  deptNameMap: Record<string, string>
}

const STATUS_FILTERS: Array<{ value: DailyLogEntryType | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'planned', label: '예정' },
  { value: 'doing', label: '진행중' },
  { value: 'blocker', label: '블로커' },
  { value: 'done', label: '완료' },
]

export default function DeptTasksClient({
  initialTasks, creatableDepts, editableDeptIds, currentUserId, nameMap, deptNameMap,
}: Props) {
  const [tasks, setTasks] = useState<DailyLog[]>(initialTasks)
  const [filter, setFilter] = useState<DailyLogEntryType | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const refresh = useCallback(async () => {
    const next = await listDeptTasks()
    setTasks(next)
  }, [])

  const visible = filter === 'all' ? tasks : tasks.filter((t) => t.entry_type === filter)
  const selected = tasks.find((t) => t.id === selectedId) ?? null
  const canCreate = creatableDepts.length > 0

  return (
    <div className="page-inner">
      <WorkTabBar />
      <PageHeader
        title="부서 업무"
        description="부서 단위 업무를 등록하고 담당자·진행을 관리합니다"
        actions={canCreate ? <NbButton onClick={() => setShowCreate(true)} aria-label="새 부서 업무 등록">+ 새 업무</NbButton> : undefined}
      />

      {canCreate && (
        <DeptTaskSuggestPanel creatableDepts={creatableDepts} editableDeptIds={editableDeptIds} onRegistered={refresh} />
      )}

      <div role="tablist" aria-label="상태 필터" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={filter === f.value ? 'btn-primary' : 'btn-ghost'}
            style={{ minHeight: 44 }}
          >
            {f.label}
          </button>
        ))}
      </div>

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
              canAssign={!!selected.department_id && editableDeptIds.includes(selected.department_id)}
              nameMap={nameMap}
              deptNameMap={deptNameMap}
              onChanged={refresh}
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
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await refresh() }}
        />
      )}
    </div>
  )
}
