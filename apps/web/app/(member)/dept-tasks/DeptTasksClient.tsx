'use client'

// 부서 업무 목록 — 목록 표준(§2-6). 검색·정렬·상태필터·보기·페이지는 URL이 진실(useListQuery).
// 데이터는 서버에서 통째로 받아오므로(listDeptTasks, limit 500) 정렬·페이지는 메모리에서 자른다.

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type { DailyLog, DailyLogEntryType } from '@/types/database'
import type { DeptTaskOrigin } from './actions'
import { STATUS_COLORS } from '@/lib/tokens/status-colors'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import WorkPageShell from '@/components/ui/WorkPageShell'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import EmptyState from '@/components/ui/EmptyState'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
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

// 서버 기본 정렬(target_date 오름차순, 마감 없는 것 뒤)을 그대로 화면 기본값으로 둔다.
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'target_date', dir: 'asc' },
  view: 'table',
  filterKeys: ['status'],
}
const SORT_OPTIONS = [
  { key: 'target_date', label: '마감' },
  { key: 'progress', label: '진행률' },
  { key: 'content', label: '업무명' },
]

/** 마감 없는 업무는 방향과 무관하게 항상 뒤 — 서버 정렬(nullsFirst:false)과 같은 규칙 */
function compareTasks(a: DailyLog, b: DailyLog, key: string, dir: 'asc' | 'desc'): number {
  const sign = dir === 'asc' ? 1 : -1
  if (key === 'target_date') {
    if (!a.target_date && !b.target_date) return 0
    if (!a.target_date) return 1
    if (!b.target_date) return -1
    return a.target_date.localeCompare(b.target_date) * sign
  }
  if (key === 'progress') return ((a.progress ?? 0) - (b.progress ?? 0)) * sign
  return (a.content ?? '').localeCompare(b.content ?? '') * sign
}

export default function DeptTasksClient({
  initialTasks, creatableDepts, editableDeptIds, currentUserId, nameMap, deptNameMap, origins,
}: Props) {
  const searchParams = useSearchParams()
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/dept-tasks' })
  const [tasks, setTasks] = useState<DailyLog[]>(initialTasks)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(false)
  const [handoffContent, setHandoffContent] = useState<string | null>(null)

  const filter = (query.filters.status as DailyLogEntryType | 'all') || 'all'

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

  const columns = useMemo<ColumnDef<DailyLog>[]>(() => [
    {
      key: 'content', header: '업무', primary: true, sortable: true,
      cell: (t) => <span>{t.content}</span>,
    },
    {
      key: 'department', header: '부서',
      cell: (t) => (t.department_id ? deptNameMap[t.department_id] ?? '—' : '—'),
    },
    {
      key: 'assignee', header: '담당자',
      cell: (t) => (t.assignee_user_id ? nameMap[t.assignee_user_id] ?? '—' : '미지정'),
    },
    {
      key: 'status', header: '상태',
      cell: (t) => <NbBadge status={t.entry_type}>{STATUS_COLORS[t.entry_type]?.label ?? t.entry_type}</NbBadge>,
    },
    { key: 'progress', header: '진행률', sortable: true, align: 'right', cell: (t) => `${t.progress}%` },
    { key: 'target_date', header: '마감', sortable: true, hideOnCard: true, cell: (t) => t.target_date ?? '—' },
  ], [deptNameMap, nameMap])

  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const rows = tasks.filter((t) => {
      if (filter !== 'all' && t.entry_type !== filter) return false
      if (!q) return true
      const assignee = t.assignee_user_id ? nameMap[t.assignee_user_id] ?? '' : ''
      return `${t.content ?? ''} ${assignee}`.toLowerCase().includes(q)
    })
    return [...rows].sort((a, b) => compareTasks(a, b, query.sort.key, query.sort.dir))
  }, [tasks, filter, query.q, query.sort.key, query.sort.dir, nameMap])

  const { from, to } = rangeOf(query)
  const visible = filtered.slice(from, to + 1)

  const selected = tasks.find((t) => t.id === selectedId) ?? null
  const canCreate = creatableDepts.length > 0
  // 코어 필드 수정 권한: 작성자 또는 부서장
  const selectedDeptEditable = !!selected?.department_id && editableDeptIds.includes(selected.department_id)
  const canEditSelected = !!selected && (selected.user_id === currentUserId || selectedDeptEditable)
  const hasFilters = Boolean(query.q) || filter !== 'all'

  return (
    <WorkPageShell
      title="부서 업무"
      description="부서 단위 업무를 등록하고 담당자·진행을 관리합니다"
      actions={canCreate ? <NbButton onClick={() => setShowCreate(true)} aria-label="새 부서 업무 등록">+ 새 업무</NbButton> : undefined}
      subTabs={
        <WorkSubTabs
          items={STATUS_FILTERS.map((f) => ({ key: f.value, label: f.label }))}
          activeKey={filter}
          onSelect={(k) => set({ filters: { status: k === 'all' ? '' : k } })}
          ariaLabel="상태 필터"
        />
      }
    >
      {canCreate && (
        <DeptTaskSuggestPanel creatableDepts={creatableDepts} editableDeptIds={editableDeptIds} onRegistered={refresh} />
      )}

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="업무명 또는 담당자 검색"
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <div className={`responsive-grid-2 dept-task-layout${selected ? ' has-selection' : ''}`}>
        <div className="card dept-task-list" style={{ padding: 0, overflow: 'hidden' }}>
          <ListSurface
            rows={visible}
            columns={columns}
            query={query}
            rowKey={(t) => t.id}
            onChange={set}
            empty={hasFilters
              ? { title: '조건에 맞는 부서 업무가 없어요', description: '검색어나 상태 필터를 바꿔보세요' }
              : {
                title: '아직 등록된 부서 업무가 없어요',
                description: '부서 업무를 등록하면 담당자·진행률을 함께 관리할 수 있습니다',
                ...(canCreate ? { action: { label: '새 업무 등록', onClick: () => setShowCreate(true) } } : {}),
              }}
            onRowClick={(t) => setSelectedId(t.id)}
          />
          <ListPager query={query} total={filtered.length} onChange={set} />
        </div>

        <aside className="dept-task-detail-pane">
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
            <div className="card">
              <EmptyState title="업무를 선택하세요" description="목록에서 업무를 고르면 상세·댓글이 여기에 표시됩니다" />
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
