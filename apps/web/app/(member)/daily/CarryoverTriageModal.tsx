'use client'

import { useState, useMemo, useEffect } from 'react'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { STATUS_LIST } from '@/lib/tokens/status-colors'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

const ENTRY_MAP = Object.fromEntries(
  (STATUS_LIST as { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[]).map((t) => [t.value, t])
) as Record<DailyLogEntryType, { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }>

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function carryoverDateLabel(logDate: string) {
  const d = new Date(logDate + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK_DAYS[d.getDay()]}) 이월`
}

const UNDO_TIMEOUT_MS = 5000

interface CarryoverTriageModalProps {
  logs: DailyLog[]
  today: string
  onClose: () => void
  onResolve: (id: string) => Promise<void> | void
  onMoveToToday: (id: string) => Promise<void> | void
  onIgnore: (id: string) => Promise<void> | void
  onMoveAll: (ids: string[]) => Promise<void> | void
  onUndoIgnore: (id: string) => Promise<void> | void
}

export default function CarryoverTriageModal({
  logs, today, onClose, onResolve, onMoveToToday, onIgnore, onMoveAll, onUndoIgnore,
}: CarryoverTriageModalProps) {
  useEscClose(onClose)

  // logs 초기 스냅샷을 작업 큐로 사용. 처리한 id는 큐에서 제거(되돌리기 시 복귀).
  const [queue, setQueue] = useState<DailyLog[]>(logs)
  const [cursor, setCursor] = useState(0)
  const [undo, setUndo] = useState<{ log: DailyLog; index: number } | null>(null)
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [busy, setBusy] = useState(false)

  const total = logs.length
  const remaining = queue.length
  const processed = total - remaining
  const current = queue[cursor] ?? null

  const remainingIds = useMemo(() => queue.map((l) => l.id), [queue])

  // 언마운트 시 미발화 undo 타이머 정리 (누수 방지)
  useEffect(() => () => { if (undoTimer) clearTimeout(undoTimer) }, [undoTimer])

  const clearUndo = () => {
    if (undoTimer) clearTimeout(undoTimer)
    setUndoTimer(null)
    setUndo(null)
  }

  // 현재 카드를 큐에서 제거하고 커서를 다음 카드에 맞춘다.
  const dropCurrent = () => {
    setQueue((prev) => {
      const next = prev.filter((_, i) => i !== cursor)
      setCursor((c) => Math.min(c, Math.max(0, next.length - 1)))
      return next
    })
  }

  const runAction = async (action: (id: string) => Promise<void> | void) => {
    if (!current || busy) return
    clearUndo()
    setBusy(true)
    try {
      await action(current.id)
      dropCurrent()
    } finally {
      setBusy(false)
    }
  }

  const handleIgnore = async () => {
    if (!current || busy) return
    const ignored = current
    const atIndex = cursor
    setBusy(true)
    try {
      await onIgnore(ignored.id)
      // 큐에서 제거 + 되돌리기 인라인 토스트 노출
      setQueue((prev) => {
        const next = prev.filter((l) => l.id !== ignored.id)
        setCursor((c) => Math.min(c, Math.max(0, next.length - 1)))
        return next
      })
      const timer = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS)
      setUndoTimer(timer)
      setUndo({ log: ignored, index: atIndex })
    } finally {
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (!undo || busy) return
    const { log, index } = undo
    clearUndo()
    setBusy(true)
    try {
      await onUndoIgnore(log.id)
      setQueue((prev) => {
        const next = [...prev]
        next.splice(Math.min(index, next.length), 0, log)
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  const handleMoveAll = async () => {
    if (remaining === 0 || busy) return
    clearUndo()
    setBusy(true)
    try {
      await onMoveAll(remainingIds)
      setQueue([])
      setCursor(0)
    } finally {
      setBusy(false)
    }
  }

  const allCleared = remaining === 0
  const type = current ? (ENTRY_MAP[current.entry_type] ?? ENTRY_MAP['note']) : null

  return (
    <div className="triage-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="triage-sheet" role="dialog" aria-modal="true" aria-label="이월 업무 정리">
        {/* 헤더 */}
        <div className="triage-head">
          <h3 className="tape-title" style={{ margin: 0 }}>이월 정리</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {!allCleared && (
              <button
                type="button"
                onClick={handleMoveAll}
                disabled={busy}
                className="triage-moveall"
                aria-label="남은 이월 업무 전부 오늘로 이동"
              >
                전부 오늘로
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', lineHeight: 1 }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 진척 */}
        {!allCleared && (
          <div className="triage-progress-wrap">
            <span className="triage-progress-label">남은 {remaining}건</span>
            <div className="triage-progress">
              <div
                className="triage-progress-bar"
                style={{ width: `${total > 0 ? Math.round((processed / total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* 본문 */}
        {allCleared ? (
          <div className="triage-empty">
            <div className="triage-empty-emoji" aria-hidden="true">🎉</div>
            <p className="triage-empty-text">모두 정리했습니다</p>
            <button type="button" onClick={onClose} className="triage-btn triage-btn-info">닫기</button>
          </div>
        ) : current && type ? (
          <>
            <div className="triage-card" style={{ borderLeft: `var(--border-w) solid ${type.color}` }}>
              <div className="triage-card-meta">
                <span
                  className="triage-badge"
                  style={{ color: type.color, background: type.bg, border: `var(--hairline) solid ${type.border}` }}
                >
                  {type.label}
                </span>
                <span className="triage-date">{carryoverDateLabel(current.log_date)}</span>
              </div>
              <p className="triage-content">{current.content}</p>
            </div>

            {/* 되돌리기 인라인 토스트 */}
            {undo && (
              <div className="triage-undo" role="status">
                <span>무시함</span>
                <button type="button" onClick={handleUndo} disabled={busy} className="triage-undo-btn">
                  되돌리기
                </button>
              </div>
            )}

            {/* 액션 */}
            <div className="triage-actions">
              <button
                type="button"
                onClick={() => runAction(onResolve)}
                disabled={busy}
                className="triage-btn triage-btn-success"
                aria-label="이 업무를 완료 처리"
              >
                완료
              </button>
              <button
                type="button"
                onClick={() => runAction(onMoveToToday)}
                disabled={busy}
                className="triage-btn triage-btn-info"
                aria-label="이 업무를 오늘로 이동"
              >
                오늘로
              </button>
              <button
                type="button"
                onClick={handleIgnore}
                disabled={busy}
                className="triage-btn triage-btn-mute"
                aria-label="이 업무 무시"
              >
                무시
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
