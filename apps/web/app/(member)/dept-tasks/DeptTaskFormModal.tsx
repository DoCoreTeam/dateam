'use client'

import { useState, useEffect } from 'react'
import type { DailyLog, DailyLogPriority } from '@/types/database'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import { parseChecklistText } from '@/lib/dept-task-utils'
import { PRIORITY_KEYS, PRIORITY_COLORS } from '@/lib/tokens/status-colors'
import { createDeptTask, updateDeptTask, listAssigneeCandidates } from './actions'
import type { DeptOption } from './DeptTasksClient'

interface Props {
  creatableDepts: DeptOption[]
  onClose: () => void
  onSaved: () => void
  /** 편집 대상 (없으면 생성 모드) */
  task?: DailyLog
  /** 편집 모드에서 부서 변경 권한(부서장) 여부 */
  canEditDept?: boolean
}

const PRIORITIES: Array<{ value: DailyLogPriority; label: string }> =
  PRIORITY_KEYS.map((k) => ({ value: k, label: PRIORITY_COLORS[k].label }))

const checklistToText = (task?: DailyLog): string =>
  (task?.checklist ?? []).map((c) => c.label).join('\n')

export default function DeptTaskFormModal({ creatableDepts, onClose, onSaved, task, canEditDept }: Props) {
  const isEdit = !!task
  const [content, setContent] = useState(task?.content ?? '')
  const [departmentId, setDepartmentId] = useState(task?.department_id ?? creatableDepts[0]?.id ?? '')
  const [priority, setPriority] = useState<DailyLogPriority>(task?.priority ?? 'normal')
  const [targetDate, setTargetDate] = useState(task?.target_date ?? '')
  const [assigneeUserId, setAssigneeUserId] = useState(task?.assignee_user_id ?? '')
  const [candidates, setCandidates] = useState<Array<{ userId: string; name: string }>>([])
  const [checklistText, setChecklistText] = useState(checklistToText(task))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 담당자 후보는 생성 모드에서만 (편집 시 담당자 지정은 상세 패널에서 처리)
  useEffect(() => {
    if (isEdit || !departmentId) return
    let alive = true
    listAssigneeCandidates(departmentId).then((c) => { if (alive) setCandidates(c) })
    return () => { alive = false }
  }, [isEdit, departmentId])

  async function submit() {
    if (!content.trim()) { setError('업무 내용을 입력해 주세요.'); return }
    setBusy(true); setError('')
    const res = isEdit
      ? await updateDeptTask(task!.id, {
          content,
          priority,
          targetDate: targetDate || null,
          departmentId,
          checklist: parseChecklistText(checklistText),
        })
      : await createDeptTask({
          content, departmentId, priority,
          targetDate: targetDate || null,
          assigneeUserId: assigneeUserId || null,
          checklist: parseChecklistText(checklistText),
        })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved()
  }

  // 부서 select: 생성=항상 가능 / 편집=부서장만(canEditDept)
  const deptDisabled = isEdit && !canEditDept

  return (
    <NbModal
      title={isEdit ? '부서 업무 수정' : '새 부서 업무'}
      ariaLabel={isEdit ? '부서 업무 수정' : '부서 업무 등록'}
      onClose={onClose}
      footer={
        <>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>취소</NbButton>
          <NbButton onClick={submit} disabled={busy || !departmentId}>{busy ? '저장 중…' : (isEdit ? '저장' : '등록')}</NbButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label className="label">업무 내용 *</label>
            <textarea className="input-field" value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="부서 업무 제목/설명" />
          </div>
          <div>
            <label className="label">부서 *{deptDisabled ? ' (부서장만 변경 가능)' : ''}</label>
            <select className="input-field" value={departmentId} disabled={deptDisabled}
              onChange={(e) => { setDepartmentId(e.target.value); setAssigneeUserId('') }} style={{ minHeight: 44 }}>
              {creatableDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {isEdit && !deptDisabled && departmentId !== task!.department_id && (
              <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--warning)' }}>
                부서를 변경하면 담당자가 초기화됩니다.
              </p>
            )}
          </div>
          <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-4)' }}>
            <div>
              <label className="label">우선순위</label>
              <select className="input-field" value={priority} onChange={(e) => setPriority(e.target.value as DailyLogPriority)} style={{ minHeight: 44 }}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">마감일</label>
              <input className="input-field" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={{ minHeight: 44 }} />
            </div>
          </div>
          {!isEdit && (
            <div>
              <label className="label">담당자 (지정은 부서장 권한)</label>
              <select className="input-field" value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)} style={{ minHeight: 44 }}>
                <option value="">미지정</option>
                {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">체크리스트 (줄당 1개, 선택)</label>
            <textarea className="input-field" value={checklistText} onChange={(e) => setChecklistText(e.target.value)} rows={2} placeholder="예: 자료 수집&#10;초안 작성" />
            {isEdit && <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>진행률은 체크리스트 완료 비율로 자동 산출됩니다.</p>}
          </div>
          {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        </div>
    </NbModal>
  )
}
