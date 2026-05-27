'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCalendarDayLogs } from '../daily/actions'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

const ENTRY_TYPES: Record<DailyLogEntryType, { label: string; color: string; bg: string; border: string }> = {
  done:    { label: '완료',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  doing:   { label: '진행중', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  planned: { label: '예정',   color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  blocker: { label: '블로커', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  note:    { label: '메모',   color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
}

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function formatPanelDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = WEEK_DAYS[d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`
}

function formatTime(isoStr: string) {
  const d = new Date(isoStr)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

interface Props {
  date: string
  onClose: () => void
}

export default function DayDetailPanel({ date, onClose }: Props) {
  const router = useRouter()
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getCalendarDayLogs(date).then((data) => {
      setLogs(data)
      setLoading(false)
    })
  }, [date])

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = new Date().toISOString().slice(0, 10)
  const isToday = date === today

  return (
    <>
      <div className="day-panel-backdrop" onClick={onClose} />
      <div className="day-panel">
        {/* 모바일 드래그 핸들 */}
        <div className="day-panel-drag-handle" />

        {/* 헤더 */}
        <div className="day-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a' }}>
              {formatPanelDate(date)}
            </span>
            {isToday && (
              <span style={{
                fontSize: '0.6875rem', fontWeight: 700, color: '#3b82f6',
                background: '#dbeafe', padding: '0.1rem 0.4rem', borderRadius: '0.25rem',
              }}>
                오늘
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => router.push(`/daily?date=${date}`)}
              style={{
                padding: '0.375rem 0.75rem', fontSize: '0.8125rem',
                background: '#3b82f6', color: '#fff', border: 'none',
                borderRadius: '0.375rem', cursor: 'pointer', fontWeight: 600,
                minHeight: 36,
              }}
            >
              {isToday ? '작성' : '보기'}
            </button>
            <button
              onClick={onClose}
              style={{
                width: 36, height: 36, border: '1px solid #e2e8f0',
                borderRadius: '0.375rem', background: '#f8fafc',
                cursor: 'pointer', fontSize: '1.125rem', color: '#64748b',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="day-panel-body">
          {loading ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0', fontSize: '0.875rem' }}>
              로딩 중...
            </div>
          ) : logs.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0', fontSize: '0.875rem' }}>
              작성된 로그가 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {logs.map((log) => {
                const t = ENTRY_TYPES[log.entry_type]
                return (
                  <div
                    key={log.id}
                    onClick={() => router.push(`/daily?date=${date}`)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
                      padding: '0.625rem 0.75rem',
                      borderLeft: `3px solid ${t.color}`,
                      background: log.entry_type === 'blocker' ? '#fef2f2' : '#fafafa',
                      borderRadius: '0 0.375rem 0.375rem 0',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.25rem' }}>
                        <span style={{
                          fontSize: '0.6875rem', fontWeight: 700, color: t.color,
                          background: t.bg, border: `1px solid ${t.border}`,
                          padding: '0.1rem 0.35rem', borderRadius: '0.25rem',
                          flexShrink: 0,
                        }}>
                          {t.label}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {formatTime(log.logged_at)}
                        </span>
                        {log.log_date !== date && (
                          <span style={{
                            fontSize: '0.65rem', color: '#6366f1',
                            background: '#eef2ff', border: '1px solid #c7d2fe',
                            padding: '0.05rem 0.35rem', borderRadius: '0.25rem',
                          }}>
                            작성 {log.log_date}
                          </span>
                        )}
                      </div>
                      <p style={{
                        margin: 0, fontSize: '0.875rem', color: '#1e293b',
                        lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {log.content}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
