'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Pencil } from 'lucide-react'
import type { DailyLog, DailyLogEntryType, DailyLogThread, DeptTaskChecklistItem } from '@/types/database'
import { STATUS_COLORS, PRIORITY_COLORS, type PriorityKey } from '@/lib/tokens/status-colors'
import { isProgressAuto } from '@/lib/dept-task-utils'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import {
  updateDeptTaskProgress, assignTask, deleteDeptTask,
  getDeptTaskComments, addDeptTaskComment, listAssigneeCandidates,
} from './actions'

interface Props {
  task: DailyLog
  currentUserId: string
  canAssign: boolean
  canEdit: boolean
  nameMap: Record<string, string>
  deptNameMap: Record<string, string>
  onChanged: () => void
  onEdit: () => void
  onClose: () => void
}

const STATUSES: DailyLogEntryType[] = ['planned', 'doing', 'blocker', 'done']

export default function DeptTaskDetail({ task, canAssign, canEdit, nameMap, deptNameMap, onChanged, onEdit, onClose }: Props) {
  const [comments, setComments] = useState<DailyLogThread[]>([])
  const [commentText, setCommentText] = useState('')
  const [progress, setProgress] = useState(task.progress)
  const [candidates, setCandidates] = useState<Array<{ userId: string; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 진행률 자동 산출 여부(done이거나 체크리스트 존재) → 수동 슬라이더 숨김
  const progressAuto = isProgressAuto(task.checklist, task.entry_type)

  const loadComments = useCallback(async () => {
    setComments(await getDeptTaskComments(task.id))
  }, [task.id])

  useEffect(() => { loadComments() }, [loadComments])
  useEffect(() => {
    if (!canAssign || !task.department_id) return
    let alive = true
    listAssigneeCandidates(task.department_id).then((c) => { if (alive) setCandidates(c) })
    return () => { alive = false }
  }, [canAssign, task.department_id])

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setError('')
    const res = await fn()
    setBusy(false)
    if (!res.ok) { setError(res.error ?? '오류'); return false }
    onChanged()
    return true
  }

  const setStatus = (s: DailyLogEntryType) => run(() => updateDeptTaskProgress(task.id, { status: s }))
  const saveProgress = () => run(() => updateDeptTaskProgress(task.id, { progress }))
  const toggleCheck = (idx: number) => {
    const checklist: DeptTaskChecklistItem[] = task.checklist.map((c, i) => i === idx ? { ...c, done: !c.done } : c)
    return run(() => updateDeptTaskProgress(task.id, { checklist }))
  }
  const assign = (userId: string) => run(() => assignTask(task.id, userId || null))
  const remove = async () => { if (await run(() => deleteDeptTask(task.id))) onClose() }
  async function submitComment() {
    if (!commentText.trim()) return
    setBusy(true)
    const res = await addDeptTaskComment(task.id, commentText)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    setCommentText(''); await loadComments()
  }

  return (
    <div className="card" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>{task.content}</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
          {canEdit && (
            <button onClick={onEdit} aria-label="수정" disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontSize: 'var(--fs-base)' }}>
              <Pencil size={16} /> 수정
            </button>
          )}
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
      </div>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-base)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <NbBadge>{PRIORITY_COLORS[task.priority as PriorityKey]?.label ?? task.priority}</NbBadge>
        <span>
          {task.department_id ? deptNameMap[task.department_id] ?? '' : ''}
          {' · 담당 '}{task.assignee_user_id ? nameMap[task.assignee_user_id] ?? '—' : '미지정'}
          {task.target_date ? ` · 마감 ${task.target_date}` : ''}
        </span>
      </p>

      <div>
        <div style={{ fontSize: 'var(--fs-base)', marginBottom: 'var(--space-2)' }}>상태</div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <button key={s} disabled={busy} onClick={() => setStatus(s)}
              className={task.entry_type === s ? 'btn-primary' : 'btn-ghost'} style={{ minHeight: 44 }}>
              {STATUS_COLORS[s]?.label ?? s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 'var(--fs-base)', marginBottom: 'var(--space-2)' }}>진행률 {task.progress}%</div>
        {progressAuto ? (
          <>
            <div style={{ height: 8, borderRadius: 'var(--radius)', background: 'var(--surface-bg)', overflow: 'hidden' }}>
              <div style={{ width: `${task.progress}%`, height: '100%', background: 'var(--brand)' }} />
            </div>
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              {task.entry_type === 'done' ? '완료 처리되어 100%입니다.' : '체크리스트 완료 비율로 자동 산출됩니다.'}
            </p>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input type="range" min={0} max={100} step={5} value={progress}
              onChange={(e) => setProgress(Number(e.target.value))} style={{ flex: 1 }} aria-label="진행률" />
            <NbButton variant="ghost" disabled={busy || progress === task.progress} onClick={saveProgress}>저장</NbButton>
          </div>
        )}
      </div>

      {task.checklist.length > 0 && (
        <div>
          <div style={{ fontSize: 'var(--fs-base)', marginBottom: 'var(--space-2)' }}>체크리스트</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {task.checklist.map((c, i) => (
              <li key={i}>
                <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', cursor: 'pointer', minHeight: 44 }}>
                  <input type="checkbox" checked={c.done} disabled={busy} onChange={() => toggleCheck(i)} />
                  <span style={{ textDecoration: c.done ? 'line-through' : 'none', color: c.done ? 'var(--text-muted)' : 'var(--text)' }}>{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canAssign && (
        <div>
          <label className="label">담당자 지정 (부서장)</label>
          <select className="input-field" value={task.assignee_user_id ?? ''} disabled={busy} onChange={(e) => assign(e.target.value)} style={{ minHeight: 44 }}>
            <option value="">미지정</option>
            {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <div style={{ fontSize: 'var(--fs-base)', marginBottom: 'var(--space-2)' }}>진행 댓글 ({comments.length})</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {comments.map((c) => (
            <li key={c.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)' }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {c.author_user_id ? nameMap[c.author_user_id] ?? '사용자' : (c.author_type === 'ai' ? 'AI' : '사용자')}
              </div>
              <div>{c.content}</div>
            </li>
          ))}
          {comments.length === 0 && <li style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>아직 댓글이 없습니다.</li>}
        </ul>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input className="input-field" value={commentText} onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
            placeholder="진행상황 댓글 입력" style={{ flex: 1, minHeight: 44 }} aria-label="댓글 입력" />
          <NbButton onClick={submitComment} disabled={busy || !commentText.trim()}>등록</NbButton>
        </div>
      </div>

      {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      <div style={{ borderTop: 'var(--hairline, 1px) solid var(--border-color)', paddingTop: 'var(--space-3)' }}>
        <NbButton variant="danger" disabled={busy} onClick={remove}>업무 삭제</NbButton>
      </div>
    </div>
  )
}
