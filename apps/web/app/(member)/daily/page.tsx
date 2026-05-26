'use client'

import { useState, useEffect, useTransition } from 'react'
import { getDailyLogs, addDailyLog, updateDailyLog, deleteDailyLog } from './actions'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

const ENTRY_TYPES: { value: DailyLogEntryType; label: string; icon: string; color: string; bg: string }[] = [
  { value: 'done', label: '완료', icon: '✅', color: '#16a34a', bg: '#f0fdf4' },
  { value: 'doing', label: '진행중', icon: '🔄', color: '#2563eb', bg: '#eff6ff' },
  { value: 'planned', label: '예정', icon: '📋', color: '#7c3aed', bg: '#f5f3ff' },
  { value: 'blocker', label: '블로커', icon: '🚫', color: '#dc2626', bg: '#fef2f2' },
  { value: 'note', label: '메모', icon: '📌', color: '#d97706', bg: '#fffbeb' },
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
  const today = toDateStr(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
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
        marginBottom: '1.5rem',
      }}>
        <button onClick={prevDay} style={navBtnStyle}>‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0f172a' }}>
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
          ›
        </button>
      </div>

      {/* 입력 폼 (오늘만) */}
      {isToday && (
        <form onSubmit={handleSubmit} style={{
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
          padding: '1rem', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {/* 타입 선택 */}
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {ENTRY_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setEntryType(t.value)}
                style={{
                  padding: '0.3rem 0.65rem', borderRadius: '1rem', fontSize: '0.8125rem',
                  fontWeight: entryType === t.value ? 700 : 500, border: '1px solid',
                  borderColor: entryType === t.value ? t.color : '#e2e8f0',
                  background: entryType === t.value ? t.bg : '#f8fafc',
                  color: entryType === t.value ? t.color : '#64748b',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                flex: 1, border: '1px solid #e2e8f0', borderRadius: '0.5rem',
                padding: '0.625rem 0.75rem', fontSize: '0.9375rem', resize: 'vertical',
                outline: 'none', fontFamily: 'inherit', lineHeight: 1.6,
              }}
            />
            <button
              type="submit"
              disabled={isPending || !content.trim()}
              style={{
                padding: '0 1rem', background: '#3b82f6', color: '#fff',
                border: 'none', borderRadius: '0.5rem', fontWeight: 600,
                fontSize: '0.875rem', cursor: 'pointer', whiteSpace: 'nowrap',
                opacity: isPending || !content.trim() ? 0.5 : 1,
              }}
            >
              {isPending ? '저장중' : '저장'}
            </button>
          </div>
          {error && <p style={{ color: '#dc2626', fontSize: '0.8125rem', marginTop: '0.5rem' }}>{error}</p>}
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
          {isToday ? '오늘 첫 업무 로그를 작성해 보세요!' : '이 날의 업무 로그가 없습니다.'}
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
                  background: '#fff', border: `1px solid ${type.color}22`,
                  borderLeft: `3px solid ${type.color}`,
                  borderRadius: '0.625rem', padding: '0.875rem 1rem',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
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
                            padding: '0.25rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem',
                            fontWeight: editType === t.value ? 700 : 400, border: '1px solid',
                            borderColor: editType === t.value ? t.color : '#e2e8f0',
                            background: editType === t.value ? t.bg : '#f8fafc',
                            color: editType === t.value ? t.color : '#94a3b8', cursor: 'pointer',
                          }}
                        >
                          {t.icon} {t.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      autoFocus
                      style={{
                        width: '100%', border: '1px solid #e2e8f0', borderRadius: '0.375rem',
                        padding: '0.5rem', fontSize: '0.9375rem', resize: 'vertical',
                        outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button onClick={() => handleUpdate(log.id)} disabled={isPending} style={actionBtnStyle('#3b82f6')}>
                        저장
                      </button>
                      <button onClick={() => setEditingId(null)} style={actionBtnStyle('#94a3b8')}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.125rem', flexShrink: 0, marginTop: '0.1rem' }}>{type.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{
                          fontSize: '0.6875rem', fontWeight: 600, color: type.color,
                          background: type.bg, padding: '0.125rem 0.375rem', borderRadius: '0.25rem',
                        }}>
                          {type.label}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {formatTime(log.logged_at)}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.9375rem', color: '#1e293b', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {log.content}
                      </p>
                    </div>
                    {isToday && (
                      <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                        <button onClick={() => startEdit(log)} style={iconBtnStyle}>✏️</button>
                        <button onClick={() => handleDelete(log.id)} style={iconBtnStyle}>🗑️</button>
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
  width: '2.25rem', height: '2.25rem', borderRadius: '50%', border: '1px solid #e2e8f0',
  background: '#fff', fontSize: '1.25rem', cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', color: '#475569',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem',
  padding: '0.25rem', borderRadius: '0.25rem', lineHeight: 1,
}

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '0.375rem 0.875rem', background: color, color: '#fff',
    border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem',
    fontWeight: 600, cursor: 'pointer',
  }
}
