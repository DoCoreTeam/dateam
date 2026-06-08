'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import type { DailyLogPriority } from '@/types/database'
import NbButton from '@/components/ui/nb/NbButton'
import { parseChecklistText } from '@/lib/dept-task-utils'
import { createDeptTask, listAssigneeCandidates } from './actions'
import type { DeptOption } from './DeptTasksClient'

interface Props {
  creatableDepts: DeptOption[]
  onClose: () => void
  onCreated: () => void
}

const PRIORITIES: Array<{ value: DailyLogPriority; label: string }> = [
  { value: 'urgent', label: '긴급' }, { value: 'high', label: '높음' },
  { value: 'normal', label: '보통' }, { value: 'low', label: '낮음' },
]

export default function DeptTaskFormModal({ creatableDepts, onClose, onCreated }: Props) {
  useEscClose(onClose)
  const [content, setContent] = useState('')
  const [departmentId, setDepartmentId] = useState(creatableDepts[0]?.id ?? '')
  const [priority, setPriority] = useState<DailyLogPriority>('normal')
  const [targetDate, setTargetDate] = useState('')
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [candidates, setCandidates] = useState<Array<{ userId: string; name: string }>>([])
  const [checklistText, setChecklistText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!departmentId) return
    let alive = true
    listAssigneeCandidates(departmentId).then((c) => { if (alive) setCandidates(c) })
    return () => { alive = false }
  }, [departmentId])

  async function submit() {
    if (!content.trim()) { setError('업무 내용을 입력해 주세요.'); return }
    setBusy(true); setError('')
    const res = await createDeptTask({
      content, departmentId, priority,
      targetDate: targetDate || null,
      assigneeUserId: assigneeUserId || null,
      checklist: parseChecklistText(checklistText),
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onCreated()
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="부서 업무 등록"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>새 부서 업무</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label className="label">업무 내용 *</label>
            <textarea className="input-field" value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="부서 업무 제목/설명" />
          </div>
          <div>
            <label className="label">부서 *</label>
            <select className="input-field" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setAssigneeUserId('') }} style={{ minHeight: 44 }}>
              {creatableDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
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
          <div>
            <label className="label">담당자 (지정은 부서장 권한)</label>
            <select className="input-field" value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)} style={{ minHeight: 44 }}>
              <option value="">미지정</option>
              {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">체크리스트 (줄당 1개, 선택)</label>
            <textarea className="input-field" value={checklistText} onChange={(e) => setChecklistText(e.target.value)} rows={2} placeholder="예: 자료 수집&#10;초안 작성" />
          </div>
          {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <NbButton variant="ghost" onClick={onClose} disabled={busy}>취소</NbButton>
            <NbButton onClick={submit} disabled={busy || !departmentId}>{busy ? '저장 중…' : '등록'}</NbButton>
          </div>
        </div>
      </div>
    </div>
  )
}
