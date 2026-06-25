'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import type { DailyLog, DailyLogEntryType } from '@/types/database'
import EventModal from './EventModal'
import { deleteCalendarEvent } from './actions'
import { formatKstTime, formatMonthDay } from '@/lib/calendar/format-time'
import { kstTodayKey } from '@/lib/datetime/kst'
import { CalendarPlus, Trash2, CalendarClock, CheckSquare, StickyNote } from 'lucide-react'

interface CalEvent {
  id: string; base_id?: string; title: string; start_at: string; end_at: string | null; all_day: boolean
  source: string; link_kind: string | null; link_id?: string | null; status: string; user_id: string; rrule?: string | null
}

const ENTRY_TYPES: Record<DailyLogEntryType, { label: string; color: string; bg: string; border: string }> = {
  done:    { label: '완료',   color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
  doing:   { label: '진행중', color: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
  planned: { label: '예정',   color: 'var(--brand)', bg: 'var(--brand-soft)', border: 'var(--brand-soft-2)' },
  blocker: { label: '블로커', color: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
  note:    { label: '메모',   color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
}

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function formatPanelDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = WEEK_DAYS[d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`
}

interface Props {
  date: string
  onClose: () => void
}

export default function DayDetailPanel({ date, onClose }: Props) {
  // Context-aware mutate — 전역 mutate는 SWRProvider 영속캐시를 못 건드림(저장 후 미반영 회귀 방지)
  const { mutate } = useSWRConfig()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const { data: logs = [], isLoading: loading } = useSWR<DailyLog[]>(
    `/api/daily/logs?date=${date}`,
    fetcher
  )
  const { data: events = [], mutate: mutateEvents } = useSWR<CalEvent[]>(
    `/api/calendar/events?start=${date}&end=${date}`,
    fetcher
  )
  const [showModal, setShowModal] = useState(false)

  // 페이지 월/주 범위 일정 SWR까지 모두 재검증
  const revalidateAllEvents = () => {
    mutateEvents()
    mutate((key) => typeof key === 'string' && key.startsWith('/api/calendar/events'))
  }

  async function onDeleteEvent(id: string) {
    await deleteCalendarEvent(id)
    revalidateAllEvents()
  }

  useEffect(() => { setMounted(true) }, [])

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = kstTodayKey()
  const isToday = date === today

  // 업무/메모 분리 — 타입을 1차 축으로 섹션 구분 (note=메모, 그 외=업무)
  const taskLogs = logs.filter((l) => l.entry_type !== 'note')
  const noteLogs = logs.filter((l) => l.entry_type === 'note')

  // 시간 의미 라벨 SSOT — 업무=마감/예정 우선·작성 보조, 메모=작성
  const renderLogRow = (log: DailyLog) => {
    const t = ENTRY_TYPES[log.entry_type]
    const isNote = log.entry_type === 'note'
    // 업무: 마감(target_date) > 예정(scheduled_at) 우선. 둘 다 없으면 작성만.
    const dueLabel = !isNote && log.target_date
      ? `마감 ${formatMonthDay(log.target_date)}`
      : !isNote && log.scheduled_at
        ? `예정 ${formatKstTime(log.scheduled_at)}`
        : null
    const madeLabel = `작성 ${formatKstTime(log.logged_at)}`
    return (
      <div
        key={log.id}
        onClick={() => router.push(`/daily?date=${date}`)}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
          padding: '0.625rem 0.75rem',
          borderLeft: `var(--border-w) solid ${t.color}`,
          background: log.entry_type === 'blocker' ? 'var(--danger-bg)' : 'var(--surface-bg)',
          borderRadius: '0 0.375rem 0.375rem 0',
          cursor: 'pointer',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 'var(--fs-2xs)', fontWeight: 700, color: t.color,
              background: t.bg, border: `var(--hairline) solid ${t.border}`,
              padding: '0.1rem 0.35rem', borderRadius: 'var(--radius)',
              flexShrink: 0,
            }}>
              {t.label}
            </span>
            {dueLabel && (
              <span className="day-panel-time day-panel-time--due">{dueLabel}</span>
            )}
            <span className="day-panel-time day-panel-time--made">{madeLabel}</span>
            {log.log_date !== date && (
              <span style={{
                fontSize: '0.65rem', color: 'var(--brand)',
                background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)',
                padding: '0.05rem 0.35rem', borderRadius: 'var(--radius)',
              }}>
                작성일 {log.log_date}
              </span>
            )}
          </div>
          <p style={{
            margin: 0, fontSize: 'var(--fs-base)', color: 'var(--text)',
            lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {log.content}
          </p>
        </div>
      </div>
    )
  }

  if (!mounted) return null

  return createPortal(
    <>
      <div className="day-panel-backdrop" onClick={onClose} />
      <div className="day-panel">
        {/* 모바일 드래그 핸들 */}
        <div className="day-panel-drag-handle" />

        {/* 헤더 */}
        <div className="day-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>
              {formatPanelDate(date)}
            </span>
            {isToday && (
              <span style={{
                fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--info)',
                background: 'var(--info-bg)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)',
              }}>
                오늘
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              onClick={() => setShowModal(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.375rem 0.625rem', fontSize: 'var(--fs-sm)',
                background: 'var(--brand-soft)', color: 'var(--brand)', border: 'var(--hairline) solid var(--brand-soft-2)',
                borderRadius: 'var(--radius)', cursor: 'pointer', fontWeight: 600, minHeight: 36,
              }}
            >
              <CalendarPlus size={14} /> 일정
            </button>
            <button
              onClick={() => router.push(`/daily?date=${date}`)}
              style={{
                padding: '0.375rem 0.75rem', fontSize: 'var(--fs-sm)',
                background: 'var(--info)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius)', cursor: 'pointer', fontWeight: 600,
                minHeight: 36,
              }}
            >
              {isToday ? '작성' : '보기'}
            </button>
            <button
              onClick={onClose}
              style={{
                width: 36, height: 36, border: 'var(--border-w-2) solid var(--border-color)',
                borderRadius: 'var(--radius)', background: 'var(--color-bg)',
                cursor: 'pointer', fontSize: 'var(--fs-xl)', color: 'var(--text-muted)',
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
          {/* 일정 (calendar_events) — 시작시각 기준 */}
          {events.length > 0 && (
            <section className="day-panel-section">
              <div className="day-panel-section-head day-panel-section-head--event">
                <CalendarClock size={13} strokeWidth={2.4} aria-hidden="true" />
                <span>일정</span>
                <span className="day-panel-section-count">{events.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {events.map((ev) => (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0.5rem 0.625rem', background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--brand-dark)', whiteSpace: 'nowrap' }}>
                      {ev.all_day ? '종일' : formatKstTime(ev.start_at)}{!ev.all_day && ev.end_at ? `~${formatKstTime(ev.end_at)}` : ''}
                    </span>
                    {ev.link_kind === 'meeting' && ev.link_id ? (
                      <span
                        onClick={() => router.push(`/daily?meeting=${ev.link_id}`)}
                        title="회의에서 생성된 업무 보기"
                        style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)', minWidth: 0, cursor: 'pointer' }}
                      >
                        {ev.title}
                      </span>
                    ) : (
                      <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)', minWidth: 0 }}>{ev.title}</span>
                    )}
                    {ev.link_kind === 'daily' && (
                      <span className="cal-link-badge" title="업무에서 자동 등록된 일정">업무 연동</span>
                    )}
                    {ev.link_kind === 'meeting' && (
                      <span className="cal-link-badge" title="회의노트에서 생성된 일정">회의</span>
                    )}
                    {ev.rrule && <span style={{ fontSize: '0.6rem', color: 'var(--brand)' }} title="반복">↻</span>}
                    {ev.source === 'ai' && <span style={{ fontSize: '0.6rem', color: 'var(--brand)' }}>AI</span>}
                    <button onClick={() => onDeleteEvent(ev.base_id ?? ev.id)} aria-label="삭제" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--border-subtle)', flexShrink: 0 }}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-8) var(--space-0)', fontSize: 'var(--fs-base)' }}>
              로딩 중...
            </div>
          ) : logs.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-8) var(--space-0)', fontSize: 'var(--fs-base)' }}>
              작성된 로그가 없습니다.
            </div>
          ) : (
            <>
              {taskLogs.length > 0 && (
                <section className="day-panel-section">
                  <div className="day-panel-section-head day-panel-section-head--task">
                    <CheckSquare size={13} strokeWidth={2.4} aria-hidden="true" />
                    <span>업무</span>
                    <span className="day-panel-section-count">{taskLogs.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {taskLogs.map((log) => renderLogRow(log))}
                  </div>
                </section>
              )}
              {noteLogs.length > 0 && (
                <section className="day-panel-section">
                  <div className="day-panel-section-head day-panel-section-head--note">
                    <StickyNote size={13} strokeWidth={2.4} aria-hidden="true" />
                    <span>메모</span>
                    <span className="day-panel-section-count">{noteLogs.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {noteLogs.map((log) => renderLogRow(log))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
      {showModal && (
        <EventModal
          date={date}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); revalidateAllEvents() }}
        />
      )}
    </>,
    document.body
  )
}
