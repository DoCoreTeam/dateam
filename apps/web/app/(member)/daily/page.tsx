'use client'

import { useState, useEffect, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { getDailyLogs, addDailyLog, updateDailyLog, deleteDailyLog } from './actions'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

const ENTRY_TYPES: { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[] = [
  { value: 'done',    label: '완료',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'doing',   label: '진행중', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'planned', label: '예정',   color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { value: 'blocker', label: '블로커', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { value: 'note',    label: '메모',   color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
]

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

function formatTime(isoStr: string) {
  const d = new Date(isoStr)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

export default function DailyPage() {
  const searchParams = useSearchParams()
  const today = toDateStr(new Date())
  const initialDate = searchParams.get('date') ?? today
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [entryType, setEntryType] = useState<DailyLogEntryType>('done')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editType, setEditType] = useState<DailyLogEntryType>('done')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const loadLogs = async (date: string) => {
    setLoading(true)
    const data = await getDailyLogs(date)
    setLogs(data)
    setLoading(false)
  }

  useEffect(() => {
    loadLogs(selectedDate)
  }, [selectedDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return
    setError('')
    startTransition(async () => {
      const result = await addDailyLog(content, entryType, selectedDate)
      if (result.ok) {
        setContent('')
        await loadLogs(selectedDate)
      } else {
        setError(result.error)
      }
    })
  }

  const handleUpdate = async (id: string) => {
    if (!editContent.trim()) return
    startTransition(async () => {
      const result = await updateDailyLog(id, editContent, editType)
      if (result.ok) {
        setEditingId(null)
        await loadLogs(selectedDate)
      } else {
        setError(result.error)
      }
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('이 항목을 삭제할까요?')) return
    startTransition(async () => {
      await deleteDailyLog(id)
      await loadLogs(selectedDate)
    })
  }

  const startEdit = (log: DailyLog) => {
    setEditingId(log.id)
    setEditContent(log.content)
    setEditType(log.entry_type)
  }

  const prevDay = () => {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    setSelectedDate(toDateStr(d))
  }

  const nextDay = () => {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    if (toDateStr(d) > today) return
    setSelectedDate(toDateStr(d))
  }

  const isToday = selectedDate === today

  return (
    <div className="page-inner" style={{ maxWidth: '720px' }}>

      {/* 날짜 네비게이션 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '1.25rem', gap: '0.75rem',
      }}>
        <button onClick={prevDay} style={navBtnStyle}>◀</button>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
            {formatDate(selectedDate)}
          </div>
          {isToday && (
            <span style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 600 }}>오늘</span>
          )}
        </div>
        <button
          onClick={nextDay}
          disabled={isToday}
          style={{ ...navBtnStyle, opacity: isToday ? 0.3 : 1, cursor: isToday ? 'default' : 'pointer' }}
        >
          ▶
        </button>
      </div>

      {/* 입력 폼 (오늘만) */}
      {isToday && (
        <form onSubmit={handleSubmit} style={{
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
          padding: '1rem', marginBottom: '1.25rem',
        }}>
          {/* 타입 선택 */}
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {ENTRY_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setEntryType(t.value)}
                style={{
                  padding: '0.3rem 0.625rem',
                  borderRadius: '0.375rem',
                  fontSize: '0.8125rem',
                  fontWeight: entryType === t.value ? 700 : 500,
                  border: `1px solid ${entryType === t.value ? t.border : '#e2e8f0'}`,
                  background: entryType === t.value ? t.bg : '#f8fafc',
                  color: entryType === t.value ? t.color : '#64748b',
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmit(e as unknown as React.FormEvent)
                }
              }}
              placeholder="업무 내용을 입력하세요 (Ctrl+Enter로 저장)"
              rows={2}
              style={{
                flex: 1,
                border: '1px solid #e2e8f0',
                borderRadius: '0.5rem',
                padding: '0.625rem 0.75rem',
                fontSize: '0.9375rem',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.6,
              }}
            />
            <button
              type="submit"
              disabled={isPending || !content.trim()}
              style={{
                padding: '0.625rem 1rem',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                opacity: isPending || !content.trim() ? 0.5 : 1,
                height: '2.5rem',
              }}
            >
              {isPending ? '저장중' : '저장'}
            </button>
          </div>
          {error && (
            <p style={{ color: '#dc2626', fontSize: '0.8125rem', marginTop: '0.5rem', margin: '0.5rem 0 0' }}>
              {error}
            </p>
          )}
        </form>
      )}

      {/* 타임라인 */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '3rem 0' }}>로딩 중...</div>
      ) : logs.length === 0 ? (
        <div style={{
          textAlign: 'center', color: '#94a3b8', padding: '3rem 0',
          border: '1px dashed #e2e8f0', borderRadius: '0.75rem',
        }}>
          {isToday ? '오늘 첫 업무 로그를 작성해 보세요.' : '이 날의 업무 로그가 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {logs.map((log) => {
            const type = ENTRY_TYPES.find((t) => t.value === log.entry_type) ?? ENTRY_TYPES[4]
            const isEditing = editingId === log.id

            return (
              <div
                key={log.id}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderLeft: `3px solid ${type.color}`,
                  borderRadius: '0 0.5rem 0.5rem 0',
                  padding: '0.75rem 1rem',
                }}
              >
                {isEditing ? (
                  <div>
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
                      {ENTRY_TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setEditType(t.value)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: editType === t.value ? 700 : 400,
                            border: `1px solid ${editType === t.value ? t.border : '#e2e8f0'}`,
                            background: editType === t.value ? t.bg : '#f8fafc',
                            color: editType === t.value ? t.color : '#94a3b8',
                            cursor: 'pointer',
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      autoFocus
                      style={{
                        width: '100%',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.375rem',
                        padding: '0.5rem',
                        fontSize: '0.9375rem',
                        resize: 'vertical',
                        outline: 'none',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button onClick={() => handleUpdate(log.id)} disabled={isPending} style={actionBtnPrimary}>
                        저장
                      </button>
                      <button onClick={() => setEditingId(null)} style={actionBtnSecondary}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                        <span style={{
                          display: 'inline-block',
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          color: type.color,
                          background: type.bg,
                          border: `1px solid ${type.border}`,
                          padding: '0.1rem 0.4rem',
                          borderRadius: '0.25rem',
                          letterSpacing: '0.02em',
                        }}>
                          {type.label}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {formatTime(log.logged_at)}
                        </span>
                      </div>
                      <p style={{
                        margin: 0,
                        fontSize: '0.9375rem',
                        color: '#1e293b',
                        lineHeight: 1.65,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                        {log.content}
                      </p>
                    </div>
                    {isToday && (
                      <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                        <button
                          onClick={() => startEdit(log)}
                          title="수정"
                          style={iconBtn}
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDelete(log.id)}
                          title="삭제"
                          style={{ ...iconBtn, color: '#dc2626' }}
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  width: '2.25rem',
  height: '2.25rem',
  borderRadius: '0.5rem',
  border: '1px solid #e2e8f0',
  background: '#fff',
  fontSize: '0.875rem',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#475569',
  flexShrink: 0,
}

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.75rem',
  padding: '0.25rem 0.375rem',
  borderRadius: '0.25rem',
  color: '#94a3b8',
  lineHeight: 1,
}

const actionBtnPrimary: React.CSSProperties = {
  padding: '0.375rem 0.875rem',
  background: '#3b82f6',
  color: '#fff',
  border: 'none',
  borderRadius: '0.375rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
}

const actionBtnSecondary: React.CSSProperties = {
  padding: '0.375rem 0.875rem',
  background: '#f1f5f9',
  color: '#475569',
  border: 'none',
  borderRadius: '0.375rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
}
