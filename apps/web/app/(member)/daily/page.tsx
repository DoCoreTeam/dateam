'use client'

import { useState, useEffect, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { getDailyLogs, addDailyLog, updateDailyLog, deleteDailyLog, getWeekLogs, getCarryoverLogs, resolveCarryoverLog, moveCarryoverToToday, ignoreCarryoverLog } from './actions'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

const ENTRY_TYPES: { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[] = [
  { value: 'done',    label: '완료',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'doing',   label: '진행중', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'planned', label: '예정',   color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { value: 'blocker', label: '블로커', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { value: 'note',    label: '메모',   color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
]
const ENTRY_MAP = Object.fromEntries(ENTRY_TYPES.map((t) => [t.value, t])) as Record<DailyLogEntryType, typeof ENTRY_TYPES[number]>

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK_DAYS[d.getDay()]})`
}

function formatTime(isoStr: string) {
  const d = new Date(isoStr)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function getMondayOfWeek(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

export default function DailyPage() {
  const searchParams = useSearchParams()
  const today = toDateStr(new Date())
  const initialDate = searchParams.get('date') ?? today

  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')

  // 일간 상태
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [loading, setLoading] = useState(true)

  // 주간 상태
  const [weekStart, setWeekStart] = useState(() => {
    const mon = getMondayOfWeek(new Date())
    mon.setDate(mon.getDate() - 1) // 일요일부터
    return toDateStr(mon)
  })
  const [weekLogs, setWeekLogs] = useState<DailyLog[]>([])
  const [weekLoading, setWeekLoading] = useState(false)

  // 이월 항목 상태
  const [carryoverLogs, setCarryoverLogs] = useState<DailyLog[]>([])
  const [carryoverLoading, setCarryoverLoading] = useState(false)

  // 입력 상태
  const [content, setContent] = useState('')
  const [entryType, setEntryType] = useState<DailyLogEntryType>('done')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editType, setEditType] = useState<DailyLogEntryType>('done')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const isToday = selectedDate === today

  // 일간 로드
  const loadLogs = async (date: string) => {
    setLoading(true)
    const data = await getDailyLogs(date)
    setLogs(data)
    setLoading(false)
  }

  // 이월 항목 로드 (오늘 뷰에서만)
  const loadCarryover = async (date: string) => {
    setCarryoverLoading(true)
    const data = await getCarryoverLogs(date)
    setCarryoverLogs(data)
    setCarryoverLoading(false)
  }

  useEffect(() => {
    if (viewMode === 'day') {
      loadLogs(selectedDate)
      if (selectedDate === today) loadCarryover(today)
      else setCarryoverLogs([])
    }
  }, [selectedDate, viewMode])

  // 주간 로드
  useEffect(() => {
    if (viewMode !== 'week') return
    setWeekLoading(true)
    startTransition(async () => {
      const data = await getWeekLogs(weekStart)
      setWeekLogs(data)
      setWeekLoading(false)
    })
  }, [weekStart, viewMode])

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

  const handleResolve = async (id: string) => {
    startTransition(async () => {
      await resolveCarryoverLog(id)
      await Promise.all([loadLogs(selectedDate), loadCarryover(today)])
    })
  }

  const handleMoveToToday = async (id: string) => {
    startTransition(async () => {
      await moveCarryoverToToday(id, today)
      await Promise.all([loadLogs(selectedDate), loadCarryover(today)])
    })
  }

  const handleIgnore = async (id: string) => {
    startTransition(async () => {
      await ignoreCarryoverLog(id)
      await loadCarryover(today)
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

  const prevDay = () => {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    setSelectedDate(toDateStr(d))
  }

  const nextDay = () => {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    setSelectedDate(toDateStr(d))
  }

  const goToday = () => setSelectedDate(today)

  const prevWeek = () => {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() - 7)
    setWeekStart(toDateStr(d))
  }

  const nextWeek = () => {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + 7)
    setWeekStart(toDateStr(d))
  }

  const goCurrentWeek = () => {
    const mon = getMondayOfWeek(new Date())
    mon.setDate(mon.getDate() - 1)
    setWeekStart(toDateStr(mon))
  }

  // 주간 날짜 7개
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00')
    d.setDate(d.getDate() + i)
    return toDateStr(d)
  })

  const weekEnd = weekDates[6]
  const isCurrentWeek = weekDates.includes(today)

  const weekLogsMap = new Map<string, DailyLog[]>()
  for (const log of weekLogs) {
    if (!weekLogsMap.has(log.log_date)) weekLogsMap.set(log.log_date, [])
    weekLogsMap.get(log.log_date)!.push(log)
  }

  return (
    <div className="page-inner" style={{ maxWidth: '720px' }}>

      {/* 뷰 탭 */}
      <div style={{
        display: 'flex', gap: '0.25rem',
        background: '#f1f5f9', borderRadius: '0.5rem', padding: '0.25rem',
        marginBottom: '1.25rem', width: 'fit-content',
      }}>
        {(['day', 'week'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            style={{
              padding: '0.375rem 1rem',
              borderRadius: '0.375rem',
              border: 'none',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: viewMode === m ? '#fff' : 'transparent',
              color: viewMode === m ? '#0f172a' : '#64748b',
              boxShadow: viewMode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {m === 'day' ? '일간' : '주간'}
          </button>
        ))}
      </div>

      {/* ===== 일간 뷰 ===== */}
      {viewMode === 'day' && (
        <>
          {/* 날짜 네비게이션 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            marginBottom: '1.25rem',
          }}>
            <button onClick={prevDay} style={navBtnStyle}>◀</button>

            <div style={{
              flex: 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '0.625rem',
            }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                {formatDate(selectedDate)}
              </span>
              {!isToday && (
                <button
                  onClick={goToday}
                  style={{
                    fontSize: '0.75rem', fontWeight: 600,
                    color: '#3b82f6', background: '#dbeafe',
                    border: '1px solid #93c5fd',
                    borderRadius: '0.375rem',
                    padding: '0.125rem 0.5rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  오늘로
                </button>
              )}
              {isToday && (
                <span style={{
                  fontSize: '0.75rem', fontWeight: 700,
                  color: '#3b82f6', background: '#dbeafe',
                  padding: '0.125rem 0.375rem', borderRadius: '0.25rem',
                }}>
                  오늘
                </span>
              )}
            </div>

            <button onClick={nextDay} style={navBtnStyle}>▶</button>
          </div>

          {/* 입력 폼 */}
          <form onSubmit={handleSubmit} style={{
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.25rem',
            }}>
              <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {ENTRY_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setEntryType(t.value)}
                    style={{
                      padding: '0.3rem 0.625rem', borderRadius: '0.375rem',
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
                  placeholder="업무 내용 입력 (Ctrl+Enter 저장)"
                  rows={2}
                  style={{
                    flex: 1, border: '1px solid #e2e8f0', borderRadius: '0.5rem',
                    padding: '0.625rem 0.75rem', fontSize: '0.9375rem',
                    resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6,
                  }}
                />
                <button
                  type="submit"
                  disabled={isPending || !content.trim()}
                  style={{
                    padding: '0.625rem 1rem', background: '#3b82f6', color: '#fff',
                    border: 'none', borderRadius: '0.5rem', fontWeight: 600,
                    fontSize: '0.875rem', cursor: 'pointer', whiteSpace: 'nowrap',
                    opacity: isPending || !content.trim() ? 0.5 : 1, height: '2.5rem',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px',
                  }}
                >
                  <span>{isPending ? '저장중' : '저장'}</span>
                  {!isPending && <span style={{ fontSize: '0.6rem', opacity: 0.75, letterSpacing: '0.01em' }}>Ctrl+↵</span>}
                </button>
              </div>
              {error && (
                <p style={{ color: '#dc2626', fontSize: '0.8125rem', margin: '0.5rem 0 0' }}>{error}</p>
              )}
            </form>

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
            <LogList
              logs={logs}
              isToday={isToday}
              editingId={editingId}
              editContent={editContent}
              editType={editType}
              isPending={isPending}
              onStartEdit={(log) => { setEditingId(log.id); setEditContent(log.content); setEditType(log.entry_type) }}
              onCancelEdit={() => setEditingId(null)}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onEditContentChange={setEditContent}
              onEditTypeChange={setEditType}
            />
          )}
        </>
      )}

      {/* ===== 주간 뷰 ===== */}
      {viewMode === 'week' && (
        <>
          {/* 주 네비게이션 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button onClick={prevWeek} style={navBtnStyle}>◀</button>
            <span style={{ fontSize: '0.875rem', color: '#475569', flex: 1, textAlign: 'center', minWidth: '10rem' }}>
              {weekDates[0]} ~ {weekEnd}
            </span>
            <button onClick={nextWeek} style={navBtnStyle}>▶</button>
            {!isCurrentWeek && (
              <button
                onClick={goCurrentWeek}
                style={{
                  padding: '0.375rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
                  color: '#3b82f6', background: '#dbeafe', border: '1px solid #93c5fd',
                  borderRadius: '0.375rem', cursor: 'pointer',
                }}
              >
                이번 주
              </button>
            )}
          </div>

          {weekLoading ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '3rem 0' }}>로딩 중...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {weekDates.map((dateStr) => {
                const d = new Date(dateStr + 'T00:00:00')
                const dayLogs = weekLogsMap.get(dateStr) ?? []
                const isTodayDate = dateStr === today
                const dow = d.getDay()

                return (
                  <div key={dateStr} style={{
                    border: isTodayDate ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                    borderRadius: '0.625rem',
                    background: isTodayDate ? '#f8fbff' : '#fff',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.625rem 0.875rem',
                      background: isTodayDate ? '#eff6ff' : '#f8fafc',
                      borderBottom: dayLogs.length > 0 ? '1px solid #e2e8f0' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.875rem', fontWeight: isTodayDate ? 700 : 600,
                          color: isTodayDate ? '#3b82f6' : dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : '#0f172a',
                        }}>
                          {WEEK_DAYS[dow]} {d.getDate()}일
                        </span>
                        {isTodayDate && (
                          <span style={{
                            fontSize: '0.6875rem', fontWeight: 700, color: '#3b82f6',
                            background: '#dbeafe', padding: '0.1rem 0.35rem', borderRadius: '0.25rem',
                          }}>
                            오늘
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        {dayLogs.length > 0 && (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{dayLogs.length}건</span>
                        )}
                        <button
                          onClick={() => { setViewMode('day'); setSelectedDate(dateStr) }}
                          style={{
                            fontSize: '0.75rem', color: '#3b82f6', background: 'none',
                            border: '1px solid #bfdbfe', borderRadius: '0.25rem',
                            padding: '0.125rem 0.5rem', cursor: 'pointer',
                          }}
                        >
                          {isTodayDate ? '작성' : '보기'}
                        </button>
                      </div>
                    </div>

                    {dayLogs.length > 0 && (
                      <div style={{ padding: '0.5rem 0.875rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        {dayLogs.map((log) => {
                          const t = ENTRY_MAP[log.entry_type]
                          return (
                            <div key={log.id} style={{
                              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                              paddingLeft: '0.5rem', borderLeft: `2px solid ${t.color}`,
                            }}>
                              <span style={{
                                fontSize: '0.6875rem', fontWeight: 700, color: t.color,
                                background: t.bg, border: `1px solid ${t.border}`,
                                padding: '0.1rem 0.35rem', borderRadius: '0.25rem',
                                flexShrink: 0, marginTop: '0.1rem',
                              }}>
                                {t.label}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: '#94a3b8', flexShrink: 0, marginTop: '0.15rem' }}>
                                {formatTime(log.logged_at)}
                              </span>
                              <p style={{
                                margin: 0, fontSize: '0.875rem', color: '#1e293b',
                                lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1,
                              }}>
                                {log.content}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* 로그 목록 컴포넌트 */
interface LogListProps {
  logs: DailyLog[]
  isToday: boolean
  editingId: string | null
  editContent: string
  editType: DailyLogEntryType
  isPending: boolean
  onStartEdit: (log: DailyLog) => void
  onCancelEdit: () => void
  onUpdate: (id: string) => void
  onDelete: (id: string) => void
  onEditContentChange: (v: string) => void
  onEditTypeChange: (v: DailyLogEntryType) => void
}

function LogList({
  logs, isToday, editingId, editContent, editType, isPending,
  onStartEdit, onCancelEdit, onUpdate, onDelete, onEditContentChange, onEditTypeChange,
}: LogListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {logs.map((log) => {
        const type = ENTRY_MAP[log.entry_type]
        const isEditing = editingId === log.id

        return (
          <div key={log.id} style={{
            background: '#fff', border: '1px solid #e2e8f0',
            borderLeft: `3px solid ${type.color}`,
            borderRadius: '0 0.5rem 0.5rem 0', padding: '0.75rem 1rem',
          }}>
            {isEditing ? (
              <div>
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
                  {ENTRY_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => onEditTypeChange(t.value)}
                      style={{
                        padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem',
                        fontWeight: editType === t.value ? 700 : 400,
                        border: `1px solid ${editType === t.value ? t.border : '#e2e8f0'}`,
                        background: editType === t.value ? t.bg : '#f8fafc',
                        color: editType === t.value ? t.color : '#94a3b8', cursor: 'pointer',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={editContent}
                  onChange={(e) => onEditContentChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      onUpdate(log.id)
                    }
                  }}
                  placeholder="Ctrl+Enter로 저장"
                  rows={3}
                  autoFocus
                  style={{
                    width: '100%', border: '1px solid #e2e8f0', borderRadius: '0.375rem',
                    padding: '0.5rem', fontSize: '0.9375rem', resize: 'vertical',
                    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button onClick={() => onUpdate(log.id)} disabled={isPending} style={actionBtnPrimary}>저장 <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>Ctrl+↵</span></button>
                  <button onClick={onCancelEdit} style={actionBtnSecondary}>취소</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                    <span style={{
                      display: 'inline-block', fontSize: '0.6875rem', fontWeight: 700,
                      color: type.color, background: type.bg,
                      border: `1px solid ${type.border}`,
                      padding: '0.1rem 0.4rem', borderRadius: '0.25rem',
                    }}>
                      {type.label}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{formatTime(log.logged_at)}</span>
                  </div>
                  <p style={{
                    margin: 0, fontSize: '0.9375rem', color: '#1e293b',
                    lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {log.content}
                  </p>
                </div>
                {isToday && (
                  <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                    <button onClick={() => onStartEdit(log)} style={iconBtn}>수정</button>
                    <button onClick={() => onDelete(log.id)} style={{ ...iconBtn, color: '#dc2626' }}>삭제</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem',
  border: '1px solid #e2e8f0', background: '#fff', fontSize: '0.875rem',
  cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: '#475569', flexShrink: 0,
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: '0.75rem', padding: '0.25rem 0.375rem',
  borderRadius: '0.25rem', color: '#94a3b8', lineHeight: 1,
}

const actionBtnPrimary: React.CSSProperties = {
  padding: '0.375rem 0.875rem', background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem',
  fontWeight: 600, cursor: 'pointer',
}

const actionBtnSecondary: React.CSSProperties = {
  padding: '0.375rem 0.875rem', background: '#f1f5f9', color: '#475569',
  border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem',
  fontWeight: 600, cursor: 'pointer',
}
