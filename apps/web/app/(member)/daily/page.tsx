'use client'

import { useState, useEffect, useTransition, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Sparkles, MessageSquare } from 'lucide-react'
import dynamic from 'next/dynamic'
import WorkTabBar from '@/components/ui/WorkTabBar'
import PageHeader from '@/components/ui/PageHeader'
const KnowledgeGraphView = dynamic(() => import('./KnowledgeGraphView').then(m => ({ default: m.KnowledgeGraphView })), { ssr: false })
const LogFlowView = dynamic(() => import('./LogFlowView').then(m => ({ default: m.LogFlowView })), { ssr: false })
import useSWR, { mutate } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { updateDailyLog, deleteDailyLog, resolveCarryoverLog, moveCarryoverToToday, ignoreCarryoverLog, addMultipleDailyLogs, getThreads, addThread, updateDailyLogStatus } from './actions'
import type { AiParsedItem } from './actions'
import type { DailyLog, DailyLogEntryType, DailyLogThread } from '@/types/database'
import { DdayBadge, todayLocal } from '@/lib/dday'
import { groupDailyLogs } from './grouping'
import MemoListView from '@/components/ui/memo/MemoListView'
import UnreviewedMemoWidget from '@/components/ui/memo/UnreviewedMemoWidget'

import { STATUS_LIST } from '@/lib/tokens/status-colors'
const ENTRY_TYPES = STATUS_LIST as { value: DailyLogEntryType; label: string; color: string; bg: string; border: string }[]
const ENTRY_MAP = Object.fromEntries(ENTRY_TYPES.map((t) => [t.value, t])) as Record<DailyLogEntryType, typeof ENTRY_TYPES[number]>

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

function isDailyCalendarCacheKey(key: unknown) {
  return typeof key === 'string' && (
    key.startsWith('/api/daily/logs?date=') ||
    key.startsWith('/api/daily/week?start=') ||
    key.startsWith('/api/calendar/month?')
  )
}

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

  const initialView = searchParams.get('view') === 'memo' ? 'memo' : 'day'
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'memo'>(initialView)

  // 일간 상태
  const [selectedDate, setSelectedDate] = useState(initialDate)

  // 주간 상태
  const [weekStart, setWeekStart] = useState(() => {
    const mon = getMondayOfWeek(new Date())
    mon.setDate(mon.getDate() - 1) // 일요일부터
    return toDateStr(mon)
  })

  // URL date 파라미터 변경 감지 → selectedDate 동기화
  // ref로 마지막 동기화 날짜를 추적해 사용자 뷰 전환(주간↔일간)을 덮어쓰지 않음
  const lastSyncedDate = useRef<string | null>(initialDate !== today ? initialDate : null)
  const dateParam = searchParams.get('date')
  useEffect(() => {
    if (
      dateParam &&
      dateParam !== lastSyncedDate.current &&
      /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ) {
      lastSyncedDate.current = dateParam
      setSelectedDate(dateParam)
      setViewMode('day')
    }
  }, [dateParam])

  // SWR 훅 — 일간 로그
  const dailyKey = viewMode === 'day' ? `/api/daily/logs?date=${selectedDate}` : null
  const { data: logs = [], isLoading: loading } = useSWR<DailyLog[]>(dailyKey, fetcher)

  // SWR 훅 — 이월 로그 (오늘만)
  const carryoverKey = (viewMode === 'day' && selectedDate === today)
    ? `/api/daily/carryover?today=${today}`
    : null
  const { data: carryoverLogs = [], isLoading: carryoverLoading } = useSWR<DailyLog[]>(carryoverKey, fetcher)

  // SWR 훅 — 주간 로그
  const weekKey = viewMode === 'week' ? `/api/daily/week?start=${weekStart}` : null
  const { data: weekLogs = [], isLoading: weekLoading } = useSWR<DailyLog[]>(weekKey, fetcher)

  // 입력 상태
  const [content, setContent] = useState('')
  const [entryType, setEntryType] = useState<DailyLogEntryType>('done')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editType, setEditType] = useState<DailyLogEntryType>('done')
  const [editTargetDate, setEditTargetDate] = useState<string>('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // 삭제 컨펌 모달 상태
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  // 토스트 상태
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({ show: false, message: '', type: 'success' })

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000)
  }

  // AI 저장 상태
  const [aiHintCount, setAiHintCount] = useState(0)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiItems, setAiItems] = useState<AiParsedItem[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  // 지식그래프 상태
  const [graphOpen, setGraphOpen] = useState(false)

  const isToday = selectedDate === today

  // debounce: 입력 중 간단 휴리스틱으로 항목 수 추정 (API 호출 없음)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!content.trim()) { setAiHintCount(0); return }
      // 줄바꿈 또는 마침표/느낌표 기준으로 대략적 항목 수 추정
      const segments = content
        .split(/\n|[。.!?]/)
        .map(s => s.trim())
        .filter(s => s.length > 3)
      setAiHintCount(Math.max(1, segments.length))
    }, 600)
    return () => clearTimeout(timer)
  }, [content])

  const handleAiSave = async () => {
    if (!content.trim() || aiLoading) return
    setAiError('')
    setAiItems([])
    setAiPanelOpen(true)
    setAiLoading(true)

    try {
      const res = await fetch('/api/ai/analyze-work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content, date: selectedDate }),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'AI 분석 실패' }))
        setAiError((errJson as { error?: string }).error ?? 'AI 분석 실패')
        setAiLoading(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { setAiError('스트림 오류'); setAiLoading(false); return }

      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') break
          try {
            const item = JSON.parse(data) as AiParsedItem
            item.originalInput = content
            setAiItems(prev => [...prev, item])
          } catch { /* skip */ }
        }
      }
    } catch {
      setAiError('네트워크 오류가 발생했습니다')
    } finally {
      setAiLoading(false)
    }
  }

  const handleAiConfirm = async (items: AiParsedItem[]) => {
    if (items.length === 0) return
    startTransition(async () => {
      const result = await addMultipleDailyLogs(items, selectedDate)
      if (result.ok) {
        setContent('')
        setAiHintCount(0)
        setAiPanelOpen(false)
        setAiItems([])
        await mutate(`/api/daily/logs?date=${selectedDate}`)
      } else {
        setAiError(result.error)
      }
    })
  }

  const handleResolve = async (id: string) => {
    startTransition(async () => {
      await resolveCarryoverLog(id)
      await Promise.all([
        mutate(`/api/daily/logs?date=${selectedDate}`),
        mutate(`/api/daily/carryover?today=${today}`),
      ])
    })
  }

  const handleMoveToToday = async (id: string) => {
    startTransition(async () => {
      await moveCarryoverToToday(id, today)
      await Promise.all([
        mutate(`/api/daily/logs?date=${today}`),
        mutate(`/api/daily/carryover?today=${today}`),
      ])
    })
  }

  const handleIgnore = async (id: string) => {
    startTransition(async () => {
      await ignoreCarryoverLog(id)
      await mutate(`/api/daily/carryover?today=${today}`)
    })
  }

  const handleUpdate = async (id: string) => {
    if (!editContent.trim()) return
    startTransition(async () => {
      const result = await updateDailyLog(id, editContent, editType, editTargetDate || null)
      if (result.ok) {
        setEditingId(null)
        await mutate(isDailyCalendarCacheKey)
      } else {
        setError(result.error)
      }
    })
  }

  const handleStatusChange = async (id: string, newType: DailyLogEntryType) => {
    // 낙관적 업데이트 — 현재 일간 뷰 즉시 반영
    mutate(
      `/api/daily/logs?date=${selectedDate}`,
      (prev: DailyLog[] | undefined) => prev?.map(l => l.id === id ? { ...l, entry_type: newType } : l),
      { revalidate: false }
    )
    startTransition(async () => {
      const result = await updateDailyLogStatus(id, newType)
      if (result.ok) {
        // 성공: week/calendar SWR 캐시 전체 무효화 (handleUpdate와 동일 패턴)
        await mutate(isDailyCalendarCacheKey)
      } else {
        await mutate(`/api/daily/logs?date=${selectedDate}`)
        showToast(result.error || 'status 변경 실패', 'error')
      }
    })
  }

  const handleDelete = (id: string) => {
    setConfirmModal({ open: true, id })
  }

  const handleDeleteConfirm = async () => {
    const id = confirmModal.id
    if (!id) return
    setConfirmModal({ open: false, id: null })

    // optimistic: 즉시 목록에서 제거
    mutate(
      `/api/daily/logs?date=${selectedDate}`,
      (logs as DailyLog[]).filter((l) => l.id !== id),
      { revalidate: false }
    )

    startTransition(async () => {
      const result = await deleteDailyLog(id)
      if (result.ok) {
        showToast('업무가 삭제되었습니다')
      } else {
        showToast(result.error || '삭제에 실패했습니다', 'error')
      }
      await mutate(`/api/daily/logs?date=${selectedDate}`)
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
    <>
    {confirmModal.open && (
      <DeleteConfirmModal
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmModal({ open: false, id: null })}
      />
    )}
    {toast.show && (
      <div className="toast-container">
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      </div>
    )}
    <div className="page-inner">
      <WorkTabBar />
      <PageHeader title="일일업무" description="오늘의 업무를 기록하고 관리합니다" />

      {/* 뷰 탭 */}
      <div className="daily-view-tabs" aria-label="일일업무 보기 전환">
        {(['day', 'week', 'memo'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={`daily-view-tab ${viewMode === m ? 'is-active' : ''}`}
          >
            {m === 'day' ? '일간' : m === 'week' ? '주간' : '메모'}
          </button>
        ))}
      </div>

      {/* ===== 메모 뷰 ===== */}
      {viewMode === 'memo' && (
        <div style={{ marginTop: '1rem' }}>
          <MemoListView />
        </div>
      )}

      {/* ===== 일간 뷰 ===== */}
      {viewMode === 'day' && (
        <>
          {/* 날짜 네비게이션 */}
          <div className="daily-date-nav">
            <button onClick={prevDay} className="calendar-nav-btn" aria-label="이전 날">
              <ChevronLeft size={16} strokeWidth={2.4} />
            </button>

            <div style={{
              flex: 1, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '0.625rem',
            }}>
              <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>
                {formatDate(selectedDate)}
              </span>
              {!isToday && (
                <button
                  onClick={goToday}
                  style={{
                    fontSize: 'var(--fs-xs)', fontWeight: 600,
                    color: 'var(--info)', background: 'var(--info-bg)',
                    border: 'var(--hairline) solid var(--info-border)',
                    borderRadius: 'var(--radius)',
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
                  fontSize: 'var(--fs-xs)', fontWeight: 700,
                  color: 'var(--info)', background: 'var(--info-bg)',
                  padding: '0.125rem 0.375rem', borderRadius: 'var(--radius)',
                }}>
                  오늘
                </span>
              )}
            </div>

            <button onClick={nextDay} className="calendar-nav-btn" aria-label="다음 날">
              <ChevronRight size={16} strokeWidth={2.4} />
            </button>
          </div>

          <div className="responsive-grid-2">
            {/* 좌측 메인 영역: 입력 폼 및 업무 타임라인 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', minWidth: 0 }}>
              {/* 입력 폼 */}
              <div className="daily-compose-card">
                <div className="daily-type-row">
                  {ENTRY_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setEntryType(t.value)}
                      className="daily-type-chip"
                      style={{
                        fontWeight: entryType === t.value ? 700 : 500,
                        border: 'var(--border-w-2) solid var(--border-color)',
                        background: entryType === t.value ? t.bg : 'var(--nb-white)',
                        color: entryType === t.value ? t.color : 'var(--ink)',
                        boxShadow: entryType === t.value ? 'var(--shadow-sm)' : 'none',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="daily-compose-row">
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        handleAiSave()
                      }
                    }}
                    placeholder="업무 내용 자유롭게 입력 — AI가 분류해드립니다 (Ctrl+Enter)"
                    rows={2}
                    className="daily-compose-textarea"
                  />
                  <button
                    type="button"
                    onClick={handleAiSave}
                    disabled={aiLoading || !content.trim()}
                    className="daily-ai-save"
                    style={{
                      background: aiLoading ? 'var(--text-faint)' : 'linear-gradient(135deg, var(--brand), var(--info))',
                      cursor: aiLoading || !content.trim() ? 'not-allowed' : 'pointer',
                      opacity: !content.trim() ? 0.5 : 1, height: '2.5rem',
                    }}
                  >
                    <span className="daily-ai-save-label">
                      {!aiLoading && <Sparkles size={14} strokeWidth={2.4} />}
                      {aiLoading ? '분석중' : 'AI 저장'}
                    </span>
                    {!aiLoading && <span style={{ fontSize: '0.6rem', opacity: 0.75 }}>Ctrl+↵</span>}
                  </button>
                </div>
                {content.trim() && aiHintCount > 0 && !aiPanelOpen && (
                  <p style={{ color: 'var(--brand)', fontSize: '0.8rem', margin: '0.5rem 0 0', opacity: 0.8 }}>
                    ✨ {aiHintCount}개 항목 감지됨
                  </p>
                )}
                {error && (
                  <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', margin: '0.5rem 0 0' }}>{error}</p>
                )}
              </div>

              {/* AI 결과 패널 */}
              {aiPanelOpen && (
                <AiResultPanel
                  items={aiItems}
                  loading={aiLoading}
                  error={aiError}
                  originalText={content}
                  onReanalyze={handleAiSave}
                  onConfirm={handleAiConfirm}
                  onClose={() => { setAiPanelOpen(false); setAiItems([]) }}
                  isPending={isPending}
                />
              )}

              {/* 타임라인 헤더 + 관계도 버튼 */}
              {logs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setGraphOpen(v => !v)}
                    style={{
                      fontSize: 'var(--fs-xs)', fontWeight: 600,
                      color: graphOpen ? 'var(--brand)' : 'var(--text-muted)',
                      background: graphOpen ? 'var(--brand-soft)' : 'var(--color-bg)',
                      border: `var(--hairline) solid ${graphOpen ? 'var(--brand-soft-2)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius)', padding: '0.25rem 0.625rem',
                      cursor: 'pointer',
                    }}
                  >
                    🔗 관계도 {graphOpen ? '닫기' : '보기'}
                  </button>
                </div>
              )}

              {graphOpen && logs.length > 0 && (
                <KnowledgeGraphView logs={logs} />
              )}

              {/* 타임라인 */}
              {loading ? (
                <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-12) var(--space-0)' }}>로딩 중...</div>
              ) : logs.length === 0 ? (
                <div style={{
                  textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-12) var(--space-0)',
                  border: 'var(--hairline) dashed var(--color-border)', borderRadius: 'var(--radius)',
                }}>
                  {isToday ? '오늘 첫 업무 로그를 작성해 보세요.' : '이 날의 업무 로그가 없습니다.'}
                </div>
              ) : (
                <LogList
                  logs={logs}
                  isToday={isToday}
                  selectedDate={selectedDate}
                  editingId={editingId}
                  editContent={editContent}
                  editType={editType}
                  isPending={isPending}
                  onStartEdit={(log) => { setEditingId(log.id); setEditContent(log.content); setEditType(log.entry_type); setEditTargetDate(log.target_date ?? '') }}
                  onCancelEdit={() => setEditingId(null)}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onStatusChange={handleStatusChange}
                  onEditContentChange={setEditContent}
                  onEditTypeChange={setEditType}
                  editTargetDate={editTargetDate}
                  onEditTargetDateChange={setEditTargetDate}
                />
              )}
            </div>

            {/* 우측 사이드 영역: 이월 업무 및 오늘의 현황 통계 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {/* 확인 안 한 메모 위젯 */}
              <UnreviewedMemoWidget variant="full" />
              {/* 이월된 미완료 항목 (오늘만 표시) */}
              {isToday && (carryoverLoading || carryoverLogs.length > 0) && (
                <div className="carryover-card">
                  <div className="carryover-header">
                    <h3 className="carryover-title">이월된 미완료 업무</h3>
                    {!carryoverLoading && (
                      <span className="badge badge-indigo" style={{ fontSize: '0.725rem' }}>
                        {carryoverLogs.length}건
                      </span>
                    )}
                  </div>
                  {carryoverLoading ? (
                    <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-base)', padding: 'var(--space-2) var(--space-0)' }}>로딩 중...</div>
                  ) : (
                    <CarryoverList
                      logs={carryoverLogs}
                      isPending={isPending}
                      onResolve={handleResolve}
                      onMoveToToday={handleMoveToToday}
                      onIgnore={handleIgnore}
                    />
                  )}
                </div>
              )}

              {/* 오늘의 업무 현황 통계 카드 */}
              <div className="daily-stats-card">
                <div className="daily-stats-header">
                  <h3 className="daily-stats-title">업무 현황 요약</h3>
                  {logs.length > 0 && (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 550 }}>
                      총 {logs.length}개 로그
                    </span>
                  )}
                </div>
                
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>완료율</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--success)' }}>
                    {logs.length > 0 ? Math.round((logs.filter(l => l.entry_type === 'done').length / logs.length) * 100) : 0}%
                  </span>
                </div>
                
                <div className="daily-stats-progress-bg">
                  <div 
                    className="daily-stats-progress-bar" 
                    style={{ width: `${logs.length > 0 ? Math.round((logs.filter(l => l.entry_type === 'done').length / logs.length) * 100) : 0}%` }} 
                  />
                </div>
                
                <div className="daily-stats-grid">
                  <div className="daily-stats-item doing">
                    <div className="daily-stats-item-label">진행중</div>
                    <div className="daily-stats-item-val">{logs.filter(l => l.entry_type === 'doing').length}</div>
                  </div>
                  <div className="daily-stats-item planned">
                    <div className="daily-stats-item-label">예정</div>
                    <div className="daily-stats-item-val">{logs.filter(l => l.entry_type === 'planned').length}</div>
                  </div>
                  <div className="daily-stats-item blocker">
                    <div className="daily-stats-item-label">블로커</div>
                    <div className="daily-stats-item-val">{logs.filter(l => l.entry_type === 'blocker').length}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== 주간 뷰 ===== */}
      {viewMode === 'week' && (
        <>
          {/* 주 네비게이션 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button onClick={prevWeek} className="calendar-nav-btn" aria-label="이전 주">
              <ChevronLeft size={16} strokeWidth={2.4} />
            </button>
            <span className="calendar-period-label" style={{ flex: 1, minWidth: '10rem' }}>
              {weekDates[0]} ~ {weekEnd}
            </span>
            <button onClick={nextWeek} className="calendar-nav-btn" aria-label="다음 주">
              <ChevronRight size={16} strokeWidth={2.4} />
            </button>
            {!isCurrentWeek && (
              <button
                onClick={goCurrentWeek}
                style={{
                  padding: '0.375rem 0.75rem', fontSize: 'var(--fs-sm)', fontWeight: 600,
                  color: 'var(--info)', background: 'var(--info-bg)', border: 'var(--hairline) solid var(--info-border)',
                  borderRadius: 'var(--radius)', cursor: 'pointer',
                }}
              >
                이번 주
              </button>
            )}
          </div>

          {weekLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 'var(--space-12) var(--space-0)' }}>로딩 중...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {weekDates.map((dateStr) => {
                const d = new Date(dateStr + 'T00:00:00')
                const dayLogs = weekLogsMap.get(dateStr) ?? []
                const isTodayDate = dateStr === today
                const dow = d.getDay()

                return (
                  <div key={dateStr} style={{
                    border: isTodayDate ? 'var(--hairline) solid var(--info)' : 'var(--border-w-2) solid var(--border-color)',
                    borderRadius: 'var(--radius)',
                    background: isTodayDate ? 'var(--surface-bg)' : '#fff',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.625rem 0.875rem',
                      background: isTodayDate ? 'var(--info-bg)' : 'var(--color-bg)',
                      borderBottom: dayLogs.length > 0 ? 'var(--border-w-2) solid var(--border-color)' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{
                          fontSize: 'var(--fs-base)', fontWeight: isTodayDate ? 700 : 600,
                          color: isTodayDate ? 'var(--info)' : dow === 0 ? 'var(--danger)' : dow === 6 ? 'var(--info)' : 'var(--text)',
                        }}>
                          {WEEK_DAYS[dow]} {d.getDate()}일
                        </span>
                        {isTodayDate && (
                          <span style={{
                            fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--info)',
                            background: 'var(--info-bg)', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius)',
                          }}>
                            오늘
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        {dayLogs.length > 0 && (
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{dayLogs.length}건</span>
                        )}
                        <button
                          onClick={() => { setViewMode('day'); setSelectedDate(dateStr) }}
                          style={{
                            fontSize: 'var(--fs-xs)', color: 'var(--info)', background: 'none',
                            border: 'var(--hairline) solid var(--info-border)', borderRadius: 'var(--radius)',
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
                            <div
                              key={log.id}
                              onClick={() => { setViewMode('day'); setSelectedDate(dateStr) }}
                              style={{
                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                                paddingLeft: 'var(--space-2)', borderLeft: `var(--border-w-2) solid ${t.color}`,
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{
                                fontSize: 'var(--fs-2xs)', fontWeight: 700, color: t.color,
                                background: t.bg, border: `var(--hairline) solid ${t.border}`,
                                padding: '0.1rem 0.35rem', borderRadius: 'var(--radius)',
                                flexShrink: 0, marginTop: '0.1rem',
                              }}>
                                {t.label}
                              </span>
                              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flexShrink: 0, marginTop: '0.15rem' }}>
                                {formatTime(log.logged_at)}
                              </span>
                              <p style={{
                                margin: 0, fontSize: 'var(--fs-base)', color: 'var(--text)',
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
    </>
  )
}

/* 로그 목록 컴포넌트 */
interface LogListProps {
  logs: DailyLog[]
  isToday: boolean
  selectedDate: string
  editingId: string | null
  editContent: string
  editType: DailyLogEntryType
  editTargetDate: string
  isPending: boolean
  onStartEdit: (log: DailyLog) => void
  onCancelEdit: () => void
  onUpdate: (id: string) => void
  onDelete: (id: string) => void
  onStatusChange: (id: string, type: DailyLogEntryType) => void
  onEditContentChange: (v: string) => void
  onEditTypeChange: (v: DailyLogEntryType) => void
  onEditTargetDateChange: (v: string) => void
}

function LogList({
  logs, isToday, selectedDate, editingId, editContent, editType, editTargetDate, isPending,
  onStartEdit, onCancelEdit, onUpdate, onDelete, onStatusChange, onEditContentChange, onEditTypeChange, onEditTargetDateChange,
}: LogListProps) {
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [flowLog, setFlowLog] = useState<DailyLog | null>(null)
  const [statusPopoverId, setStatusPopoverId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const todayStr = toDateStr(new Date())

  const groups = useMemo(() => groupDailyLogs(logs), [logs])

  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    if (!statusPopoverId) return
    const close = () => setStatusPopoverId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [statusPopoverId])

  const renderCard = (log: DailyLog) => {
    const type = ENTRY_MAP[log.entry_type]
    const isEditing = editingId === log.id
    const threadOpen = openThreadId === log.id

    return (
          <div key={log.id}>
            <div
              onClick={() => { if (!isEditing) setFlowLog(log) }}
              style={{
                background: '#fff', border: 'var(--border-w-2) solid var(--border-color)',
                borderLeft: `var(--border-w) solid ${type.color}`,
                borderRadius: threadOpen ? '0 0.5rem 0 0' : '0 0.5rem 0.5rem 0',
                padding: 'var(--space-3) var(--space-4)',
                cursor: isEditing ? 'default' : 'pointer',
              }}
            >
              {isEditing ? (
                <div>
                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
                    {ENTRY_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => onEditTypeChange(t.value)}
                        style={{
                          padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
                          fontWeight: editType === t.value ? 700 : 400,
                          border: `var(--hairline) solid ${editType === t.value ? t.border : 'var(--color-border)'}`,
                          background: editType === t.value ? t.bg : 'var(--color-bg)',
                          color: editType === t.value ? t.color : 'var(--text-faint)', cursor: 'pointer',
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
                      width: '100%', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)',
                      padding: 'var(--space-2)', fontSize: 'var(--fs-md)', resize: 'vertical',
                      outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: '0.375rem', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>일정 날짜</label>
                    <input
                      type="date"
                      value={editTargetDate}
                      onChange={(e) => onEditTargetDateChange(e.target.value)}
                      style={{
                        border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)',
                        padding: '0.2rem 0.4rem', fontSize: 'var(--fs-sm)',
                        color: 'var(--text)', outline: 'none', cursor: 'pointer',
                      }}
                    />
                    {editTargetDate && (
                      <button
                        type="button"
                        onClick={() => onEditTargetDateChange('')}
                        style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        ✕ 제거
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.5rem' }}>
                    <button onClick={() => onUpdate(log.id)} disabled={isPending} style={actionBtnPrimary}>저장 <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>Ctrl+↵</span></button>
                    <button onClick={onCancelEdit} style={actionBtnSecondary}>취소</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <button
                          data-testid={`status-badge-${log.id}`}
                          onClick={(e) => { e.stopPropagation(); setStatusPopoverId(statusPopoverId === log.id ? null : log.id) }}
                          style={{
                            display: 'inline-block', fontSize: 'var(--fs-2xs)', fontWeight: 700,
                            color: type.color, background: type.bg,
                            border: `var(--hairline) solid ${type.border}`,
                            padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)',
                            cursor: 'pointer', outline: 'none',
                          }}
                          title="클릭하여 상태 변경"
                        >
                          {type.label} ▾
                        </button>
                        {statusPopoverId === log.id && (
                          <div
                            data-testid={`status-popover-${log.id}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute', top: '100%', left: 0, zIndex: 50,
                              background: '#fff', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)',
                              boxShadow: 'var(--shadow-sm)', padding: '0.375rem',
                              display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: '80px',
                              marginTop: '0.25rem',
                            }}
                          >
                            {ENTRY_TYPES.map((t) => (
                              <button
                                key={t.value}
                                data-testid={`status-option-${t.value}`}
                                onClick={() => { onStatusChange(log.id, t.value); setStatusPopoverId(null) }}
                                style={{
                                  fontSize: 'var(--fs-2xs)', fontWeight: t.value === log.entry_type ? 700 : 400,
                                  color: t.color, background: t.value === log.entry_type ? t.bg : 'transparent',
                                  border: `var(--hairline) solid ${t.value === log.entry_type ? t.border : 'transparent'}`,
                                  padding: '0.2rem 0.5rem', borderRadius: 'var(--radius)',
                                  cursor: 'pointer', textAlign: 'left', outline: 'none',
                                }}
                              >
                                {t.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{formatTime(log.logged_at)}</span>
                      {log.target_date && (
                        <DdayBadge targetDate={log.target_date} today={todayStr} />
                      )}
                    </div>
                    <p style={{
                      margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text)',
                      lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {log.content}
                    </p>
                  </div>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0, alignItems: 'center' }}
                  >
                    <button
                      onClick={() => setOpenThreadId(threadOpen ? null : log.id)}
                      style={{
                        ...iconBtn,
                        color: threadOpen ? 'var(--brand)' : 'var(--text-faint)',
                        display: 'flex', alignItems: 'center', gap: '0.2rem',
                      }}
                      title="스레드"
                    >
                      <MessageSquare size={13} strokeWidth={2} />
                    </button>
                    <button
                      onClick={() => setFlowLog(log)}
                      style={{ ...iconBtn, color: 'var(--text-muted)' }}
                      title="플로우"
                    >🌊</button>
                    <button onClick={() => onStartEdit(log)} style={iconBtn}>수정</button>
                    <button onClick={() => onDelete(log.id)} style={{ ...iconBtn, color: 'var(--danger)' }}>삭제</button>
                  </div>
                </div>
              )}
            </div>
            {threadOpen && <ThreadView logId={log.id} selectedDate={selectedDate} />}
          </div>
        )
  }

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {groups.map((group) => {
        if (!group.isBatch) return renderCard(group.logs[0])
        // 묶음 안의 카드를 편집/스레드 작성 중이면 접기 방지 (입력 손실 방지)
        const hasActiveChild = group.logs.some((l) => l.id === editingId || l.id === openThreadId)
        const isOpen = expandedGroups.has(group.key) || hasActiveChild
        const subsId = `daily-group-subs-${group.key}`
        return (
          <div key={group.key} className="daily-group">
            <button
              type="button"
              className="daily-group-header"
              aria-expanded={isOpen}
              aria-controls={subsId}
              onClick={() => toggleGroup(group.key)}
            >
              <span className="daily-group-chevron" aria-hidden>{isOpen ? '▾' : '▸'}</span>
              <span className="daily-group-icon" aria-hidden>📥</span>
              <span className="daily-group-label">{group.label}</span>
              <span className="daily-group-meta">{formatTime(group.loggedAt)} · {group.count}건</span>
              {group.doneCount > 0 && (
                <span className="daily-group-done">완료 {group.doneCount}/{group.count}</span>
              )}
            </button>
            {isOpen && (
              <div id={subsId} className="daily-group-subs">
                {group.logs.map(renderCard)}
              </div>
            )}
          </div>
        )
      })}
    </div>
    {flowLog && <LogFlowView log={flowLog} allLogs={logs} onClose={() => setFlowLog(null)} />}
    </>
  )
}

/* 스레드 뷰 컴포넌트 */
function ThreadView({ logId, selectedDate }: { logId: string; selectedDate: string }) {
  const [threads, setThreads] = useState<DailyLogThread[]>([])
  const [threadLoading, setThreadLoading] = useState(true)
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [aiItems, setAiItems] = useState<AiParsedItem[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [showAiResult, setShowAiResult] = useState(false)
  const [aiAnalyzeError, setAiAnalyzeError] = useState<string | null>(null)

  const todayForBadge = toDateStr(new Date())

  const load = async () => {
    setThreadLoading(true)
    const data = await getThreads(logId)
    setThreads(data)
    setThreadLoading(false)
  }

  useEffect(() => { load() }, [logId])

  const handleAiAnalyze = async () => {
    if (!input.trim() || aiLoading) return
    setAiLoading(true)
    setAiItems([])
    setShowAiResult(false)
    setAiAnalyzeError(null)
    try {
      const res = await fetch('/api/ai/analyze-work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.trim(), date: selectedDate }),
      })
      if (!res.ok || !res.body) {
        setAiAnalyzeError(`AI 분석 실패 (${res.status})`)
        setAiLoading(false)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const parsed: AiParsedItem[] = []
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t || !t.startsWith('data: ')) continue
          const jsonStr = t.slice(6)
          if (jsonStr === '[DONE]') continue
          try {
            const obj = JSON.parse(jsonStr)
            if (obj.title) { parsed.push(obj); setAiItems([...parsed]) }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch {
      setAiAnalyzeError('AI 서버 연결 실패')
    }
    setAiLoading(false)
    setShowAiResult(true)
  }

  const handleSubmit = async () => {
    if (!input.trim() || submitting) return
    setSubmitting(true)
    const result = await addThread(logId, input.trim())
    if (result.ok) {
      setInput('')
      setAiItems([])
      setShowAiResult(false)
      await load()
    }
    setSubmitting(false)
  }

  const [aiConfirmError, setAiConfirmError] = useState<string | null>(null)

  const handleAiConfirm = async () => {
    if (!input.trim() || submitting || aiItems.length === 0) return
    setSubmitting(true)
    setAiConfirmError(null)
    const threadResult = await addThread(logId, input.trim())
    if (!threadResult.ok) {
      setAiConfirmError('스레드 저장 실패')
      setSubmitting(false)
      return
    }
    if (threadResult.ok) {
      const saveResult = await addMultipleDailyLogs(aiItems, selectedDate, logId)
      if (!saveResult.ok) {
        setAiConfirmError(`업무 등록 실패: ${saveResult.error}`)
        setSubmitting(false)
        return
      }
      await mutate(`/api/daily/logs?date=${selectedDate}`)
      setInput('')
      setAiItems([])
      setShowAiResult(false)
      setAiConfirmError(null)
      await load()
    }
    setSubmitting(false)
  }

  return (
    <div style={{
      border: 'var(--border-w-2) solid var(--border-color)', borderTop: 'none',
      borderRadius: '0 0 0.5rem 0.5rem',
      background: 'var(--color-bg)', padding: 'var(--space-3) var(--space-4)',
    }}>
      {threadLoading ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-faint)', padding: 'var(--space-1) var(--space-0)' }}>로딩 중...</div>
      ) : threads.length === 0 ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-faint)', paddingBottom: 'var(--space-2)' }}>
          아직 스레드가 없습니다. 관련 내용을 자유롭게 남겨보세요.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: '0.75rem' }}>
          {threads.map((t) => (
            <div key={t.id} style={{
              display: 'flex', gap: 'var(--space-2)',
              justifyContent: t.author_type === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '80%',
                background: t.author_type === 'user' ? 'var(--info-bg)' : 'var(--success-bg)',
                border: `var(--hairline) solid ${t.author_type === 'user' ? 'var(--info-border)' : 'var(--success-border)'}`,
                borderRadius: t.author_type === 'user' ? '0.75rem 0.75rem 0 0.75rem' : '0.75rem 0.75rem 0.75rem 0',
                padding: 'var(--space-2) var(--space-3)',
              }}>
                <p style={{
                  margin: 0, fontSize: 'var(--fs-base)', color: 'var(--text)',
                  lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {t.content}
                </p>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-faint)', marginTop: '0.25rem', textAlign: 'right' }}>
                  {t.author_type === 'ai' ? '🤖 AI' : '나'} · {formatTime(t.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI 분석 결과 미니 패널 */}
      {showAiResult && aiItems.length > 0 && (
        <div style={{
          background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)',
          padding: '0.625rem 0.75rem', marginBottom: '0.625rem',
        }}>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--brand)', marginBottom: '0.375rem' }}>
            ✨ AI 분석 결과 ({aiItems.length}개)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: '0.5rem' }}>
            {aiItems.map((item, i) => {
              const t = ENTRY_MAP[item.status as DailyLogEntryType] ?? ENTRY_MAP['note']
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, color: t.color,
                    background: t.bg, border: `var(--hairline) solid ${t.border}`,
                    padding: '0.05rem 0.3rem', borderRadius: 'var(--radius)',
                  }}>{t.label}</span>
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', flex: 1 }}>{item.title}</span>
                  {item.targetDate && <DdayBadge targetDate={item.targetDate} today={todayForBadge} />}
                </div>
              )
            })}
          </div>
          {aiConfirmError && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', marginBottom: '0.375rem' }}>
              {aiConfirmError}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            <button
              onClick={handleAiConfirm}
              disabled={submitting}
              style={{
                padding: '0.375rem 0.75rem', background: 'var(--brand)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
                fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.5 : 1, whiteSpace: 'nowrap',
              }}
            >
              {submitting ? '저장 중...' : '스레드 저장 + 업무 등록'}
            </button>
            <button
              onClick={() => setShowAiResult(false)}
              style={{
                padding: '0.375rem 0.625rem', background: 'none', color: 'var(--text-muted)',
                border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
                cursor: 'pointer',
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {aiAnalyzeError && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', marginBottom: '0.375rem' }}>
          {aiAnalyzeError}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder="관련 내용을 자유롭게 남기세요 (Ctrl+Enter)"
          rows={2}
          style={{
            flex: 1, border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)',
            padding: 'var(--space-2)', fontSize: 'var(--fs-base)', resize: 'none',
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            background: '#fff',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <button
            onClick={handleAiAnalyze}
            disabled={aiLoading || !input.trim()}
            style={{
              padding: '0.375rem 0.75rem', background: 'var(--brand)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
              fontWeight: 600, cursor: aiLoading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: aiLoading || !input.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
            }}
          >
            <Sparkles size={12} strokeWidth={2.4} />
            {aiLoading ? '분석중' : 'AI 분석'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !input.trim()}
            style={{
              padding: '0.375rem 0.75rem', background: 'var(--brand)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
              fontWeight: 600, cursor: submitting || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: submitting || !input.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
            }}
          >
            {submitting ? '저장 중' : '남기기'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* 이월 항목 목록 컴포넌트 */
interface CarryoverListProps {
  logs: DailyLog[]
  isPending: boolean
  onResolve: (id: string) => void
  onMoveToToday: (id: string) => void
  onIgnore: (id: string) => void
}

function CarryoverList({ logs, isPending, onResolve, onMoveToToday, onIgnore }: CarryoverListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {logs.map((log) => {
        const type = ENTRY_MAP[log.entry_type]
        const d = new Date(log.log_date + 'T00:00:00')
        const dateLabel = `${d.getMonth() + 1}/${d.getDate()}(${WEEK_DAYS[d.getDay()]})`

        return (
          <div key={log.id} style={{
            background: 'var(--warning-bg)',
            border: 'var(--hairline) solid var(--warning-border)',
            borderLeft: `var(--border-w) solid ${type.color}`,
            borderRadius: '0 0.5rem 0.5rem 0',
            padding: '0.625rem 0.875rem',
            opacity: isPending ? 0.6 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '10rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 'var(--fs-2xs)', fontWeight: 700, color: type.color,
                    background: type.bg, border: `var(--hairline) solid ${type.border}`,
                    padding: '0.1rem 0.35rem', borderRadius: 'var(--radius)',
                  }}>
                    {type.label}
                  </span>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', background: 'var(--warning-bg)', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius)' }}>
                    {dateLabel} 이월
                  </span>
                </div>
                <p style={{
                  margin: 0, fontSize: 'var(--fs-base)', color: 'var(--text)',
                  lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {log.content}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => onResolve(log.id)}
                  disabled={isPending}
                  style={{
                    padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--fs-xs)', fontWeight: 600,
                    background: 'var(--success-bg)', color: 'var(--success)', border: 'var(--hairline) solid var(--success-border)',
                    borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >
                  완료
                </button>
                <button
                  onClick={() => onMoveToToday(log.id)}
                  disabled={isPending}
                  style={{
                    padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--fs-xs)', fontWeight: 600,
                    background: 'var(--info-bg)', color: 'var(--info)', border: 'var(--hairline) solid var(--info-border)',
                    borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >
                  오늘로
                </button>
                <button
                  onClick={() => onIgnore(log.id)}
                  disabled={isPending}
                  style={{
                    padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--fs-xs)',
                    background: 'none', color: 'var(--text-faint)', border: 'var(--border-w-2) solid var(--border-color)',
                    borderRadius: 'var(--radius)', cursor: 'pointer',
                  }}
                >
                  무시
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 'var(--fs-xs)', padding: '0.25rem 0.375rem',
  borderRadius: 'var(--radius)', color: 'var(--text-faint)', lineHeight: 1,
}

const actionBtnPrimary: React.CSSProperties = {
  padding: '0.375rem 0.875rem', background: 'var(--info)', color: '#fff',
  border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)',
  fontWeight: 600, cursor: 'pointer',
}

const actionBtnSecondary: React.CSSProperties = {
  padding: '0.375rem 0.875rem', background: 'var(--surface-muted)', color: 'var(--text-muted)',
  border: 'none', borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)',
  fontWeight: 600, cursor: 'pointer',
}

/* ─── AI 결과 패널 ─── */

const PRIORITY_LABELS: Record<string, string> = {
  urgent: '긴급', high: '높음', normal: '보통', low: '낮음',
}
// 텍스트 색만 매핑(SSOT lib/tokens/status-colors의 PRIORITY_COLORS[color/bg/border]와 구분).
const PRIORITY_TEXT_COLORS: Record<string, string> = {
  urgent: 'var(--danger)', high: 'var(--warning)', normal: 'var(--text-muted)', low: 'var(--text-faint)',
}

interface AiResultPanelProps {
  items: AiParsedItem[]
  loading: boolean
  error: string
  originalText: string
  onReanalyze: () => void
  onConfirm: (items: AiParsedItem[]) => void
  onClose: () => void
  isPending: boolean
}

function AiResultPanel({ items, loading, error, onReanalyze, onConfirm, onClose, isPending }: AiResultPanelProps) {
  const [editItems, setEditItems] = useState<AiParsedItem[]>(items)

  // items 스트리밍으로 추가될 때마다 동기화
  useEffect(() => {
    setEditItems(items)
  }, [items])

  // 같은 originGroupId를 공유하는 항목들이 있으면 묶음 배너 표시
  const hasOriginGroup = editItems.length > 1 && editItems.some(i => i.originGroupId != null)

  const updateItem = (idx: number, patch: Partial<AiParsedItem>) => {
    setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
  }

  return (
    <>
      <div className="ai-panel-overlay" onClick={onClose} />
      <div className="ai-panel">
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--border-w-2) solid var(--border-color)',
          background: 'linear-gradient(135deg, var(--brand-soft), var(--info-bg))',
        }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>✨ AI 분석 결과</div>
            {loading && editItems.length === 0 && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', marginTop: '0.125rem' }}>
                분석 중...
              </div>
            )}
            {loading && editItems.length > 0 && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', marginTop: '0.125rem' }}>
                {editItems.length}개 항목 발견 — 계속 분석 중...
              </div>
            )}
            {!loading && editItems.length > 0 && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', marginTop: '0.125rem' }}>
                {editItems.length}개 항목 감지됨 — 확인 후 저장하세요
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: '1.25rem',
              color: 'var(--text-faint)', cursor: 'pointer', lineHeight: 1, padding: 'var(--space-1)',
            }}
          >×</button>
        </div>

        {/* 컨텐츠 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4) var(--space-5)' }}>
          {/* 같은 묶음 안내 배너 */}
          {hasOriginGroup && !loading && (
            <div style={{
              background: 'var(--info-bg)', border: 'var(--hairline) solid var(--info-border)',
              borderRadius: 'var(--radius)', padding: '0.5rem 0.875rem',
              marginBottom: '0.875rem',
              fontSize: 'var(--fs-sm)', color: 'var(--info)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
              <span>🔗</span>
              <span>같은 입력에서 분리된 <strong>{editItems.length}개</strong> 항목 묶음입니다 — 개별 확인 후 함께 저장됩니다</span>
            </div>
          )}

          {error && (
            <div style={{
              background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)',
              borderRadius: 'var(--radius)', padding: 'var(--space-3) var(--space-4)',
              color: 'var(--danger)', fontSize: 'var(--fs-base)', marginBottom: '1rem',
            }}>
              {error}
            </div>
          )}

          {loading && editItems.length === 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 'var(--space-4)', padding: 'var(--space-10) var(--space-4)',
            }}>
              <div className="ai-analyzing-spinner" />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--brand-dark)', marginBottom: '0.25rem' }}>
                  AI가 업무를 분석하고 있습니다
                </div>
                <div className="ai-analyzing-dots" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
                  업무 항목을 추출 중
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {editItems.map((item, idx) => (
              <div
                key={idx}
                className="ai-item-card"
                style={{ animationDelay: `${idx * 0.08}s` }}
              >
                <AiItemCard
                  item={item}
                  onChange={(patch) => updateItem(idx, patch)}
                />
              </div>
            ))}
          </div>

          {loading && editItems.length > 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', padding: 'var(--space-3) var(--space-0)' }}>
              분석 중...
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div style={{
          padding: 'var(--space-4) var(--space-5)', borderTop: 'var(--border-w-2) solid var(--border-color)',
          display: 'flex', gap: '0.625rem',
          background: '#fff',
        }}>
          <button
            onClick={onReanalyze}
            disabled={loading}
            style={{
              flex: 1, padding: '0.625rem', background: 'var(--surface-muted)', color: 'var(--text-muted)',
              border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-base)', fontWeight: 600, cursor: 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            다시 분석
          </button>
          <button
            onClick={() => onConfirm(editItems)}
            disabled={loading || isPending || editItems.length === 0}
            style={{
              flex: 2, padding: '0.625rem',
              background: 'linear-gradient(135deg, var(--brand), var(--info))',
              color: '#fff', border: 'none', borderRadius: 'var(--radius)',
              fontSize: 'var(--fs-base)', fontWeight: 700, cursor: 'pointer',
              opacity: loading || isPending || editItems.length === 0 ? 0.5 : 1,
            }}
          >
            {isPending ? '저장 중...' : `확정 저장 (${editItems.length}개)`}
          </button>
        </div>
      </div>
    </>
  )
}

interface AiItemCardProps {
  item: AiParsedItem
  onChange: (patch: Partial<AiParsedItem>) => void
}

const CERTAINTY_LABEL: Record<string, string> = {
  exact: 'AI 확정', inferred: 'AI 추정', none: '',
}
const CERTAINTY_COLOR: Record<string, string> = {
  exact: 'var(--brand)', inferred: 'var(--warning)', none: 'var(--text-faint)',
}


function AiItemCard({ item, onChange }: AiItemCardProps) {
  const statusInfo = ENTRY_MAP[item.status] ?? ENTRY_MAP['note']
  const today = toDateStr(new Date())

  return (
    <div style={{
      background: '#fff', border: `var(--hairline) solid ${statusInfo.border}`,
      borderLeft: `var(--border-w) solid ${statusInfo.color}`,
      borderRadius: '0 0.5rem 0.5rem 0', padding: '0.75rem 0.875rem',
    }}>
      {/* 제목 */}
      <input
        value={item.title}
        onChange={(e) => onChange({ title: e.target.value })}
        style={{
          width: '100%', border: 'none', borderBottom: 'var(--border-w-2) solid var(--border-color)',
          padding: '0 0 0.375rem', fontSize: 'var(--fs-md)', fontWeight: 600,
          color: 'var(--text)', outline: 'none', background: 'transparent',
          boxSizing: 'border-box', marginBottom: '0.625rem',
        }}
      />

      {/* 메타 배지 행 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
        {/* 상태 */}
        <select
          value={item.status}
          onChange={(e) => onChange({ status: e.target.value as DailyLogEntryType })}
          style={{
            padding: '0.2rem 0.5rem', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
            fontWeight: 700, border: `var(--hairline) solid ${statusInfo.border}`,
            background: statusInfo.bg, color: statusInfo.color, cursor: 'pointer',
          }}
        >
          {ENTRY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {/* 우선순위 */}
        <select
          value={item.priority}
          onChange={(e) => onChange({ priority: e.target.value as AiParsedItem['priority'] })}
          style={{
            padding: '0.2rem 0.5rem', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
            fontWeight: 600, border: 'var(--border-w-2) solid var(--border-color)',
            background: 'var(--color-bg)', color: PRIORITY_TEXT_COLORS[item.priority] ?? 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        {/* 타겟 날짜 (사용자 편집 가능) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>📅</span>
          <input
            type="date"
            value={item.targetDate ?? ''}
            onChange={(e) => onChange({ targetDate: e.target.value || null, targetDateCertainty: 'exact' })}
            style={{
              padding: '0.15rem 0.375rem', borderRadius: 'var(--radius)', fontSize: 'var(--fs-xs)',
              border: 'var(--border-w-2) solid var(--border-color)', background: 'var(--color-bg)', color: 'var(--text-muted)',
              cursor: 'pointer', outline: 'none',
            }}
          />
          {item.targetDate && item.targetDateCertainty !== 'none' && (
            <span style={{
              fontSize: '0.65rem', color: CERTAINTY_COLOR[item.targetDateCertainty] ?? 'var(--text-faint)',
              fontStyle: 'italic',
            }}>
              {CERTAINTY_LABEL[item.targetDateCertainty]}
            </span>
          )}
          {item.targetDate && <DdayBadge targetDate={item.targetDate} today={today} />}
        </div>

        {/* 예약 시간 */}
        {item.scheduledTime && (
          <span style={{
            fontSize: 'var(--fs-xs)', color: 'var(--brand)', background: 'var(--brand-soft)',
            border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)',
            padding: '0.2rem 0.5rem',
          }}>
            ⏰ {item.scheduledTime}
          </span>
        )}

        {/* 거래처 */}
        {item.accountName && (
          <span style={{
            fontSize: 'var(--fs-xs)', color: 'var(--info)', background: 'var(--info-bg)',
            border: 'var(--hairline) solid var(--info-border)', borderRadius: 'var(--radius)',
            padding: '0.2rem 0.5rem',
          }}>
            🏢 {item.accountName}
          </span>
        )}

        {/* 담당자 */}
        {item.contactName && (
          <span style={{
            fontSize: 'var(--fs-xs)', color: 'var(--info)', background: 'var(--success-bg)',
            border: 'var(--hairline) solid var(--info-bg)', borderRadius: 'var(--radius)',
            padding: '0.2rem 0.5rem',
          }}>
            👤 {item.contactName}
          </span>
        )}

        {/* AI 태그 */}
        {item.tags?.map(tag => (
          <span key={tag} style={{
            fontSize: '0.7rem', color: 'var(--brand)', background: 'var(--brand-soft)',
            border: 'var(--hairline) solid var(--brand-soft-2)', borderRadius: 'var(--radius)',
            padding: '0.1rem 0.375rem',
          }}>
            #{tag}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ─── 삭제 확인 모달 ─── */
function DeleteConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-icon">🗑️</div>
        <div className="confirm-modal-title">업무 삭제</div>
        <div className="confirm-modal-desc">이 항목을 삭제할까요?<br />삭제하면 되돌릴 수 없습니다.</div>
        <div className="confirm-modal-actions">
          <button className="confirm-modal-btn-cancel" onClick={onCancel}>취소</button>
          <button className="confirm-modal-btn-delete" onClick={onConfirm}>삭제</button>
        </div>
      </div>
    </div>
  )
}
