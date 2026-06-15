'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { mutate } from 'swr'
import type { DailyLog } from '@/types/database'
import { selectScheduleCandidates, type ScheduleCandidate } from '@/lib/daily/schedule-candidates'
import { getLinkedDailyLogIds, unlinkDailyCalendar } from '../calendar/actions'

interface ScheduleSectionProps {
  /** 이 그룹에 속한 항목들 — scheduled_at/target_date 보유 항목만 후보가 된다 */
  groupLogs: DailyLog[]
}

function dateLabelKo(c: ScheduleCandidate): string {
  // YYYY-MM-DD → "6월 20일" + 시각 명시 시 HH:MM
  const [, mo, da] = c.dateLabel.split('-')
  const base = `${Number(mo)}월 ${Number(da)}일`
  if (!c.hasTime) return base
  const d = new Date(c.startAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${base} ${hh}:${mm}`
}

/**
 * "② 일정" 섹션 (P2) — 일정성 항목의 캘린더 자동 등록 상태 표시 + 취소.
 *
 * 자동 등록은 저장 직후 daily/page.tsx(handleAiSave)에서 1회 수행한다.
 * 이 컴포넌트는 등록 결과(link_kind='daily' 연결)를 조회해 "🗓 캘린더 등록됨"으로
 * 표시하고, 각 항목에 [취소](연결된 calendar_events 삭제)를 제공한다.
 * 비파괴: daily_logs 원본은 읽기만 하고 수정·삭제하지 않는다.
 */
export function ScheduleSection({ groupLogs }: ScheduleSectionProps) {
  const [linkedIds, setLinkedIds] = useState<ReadonlySet<string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // 일정성 후보 전체(연결 여부 무관) — 등록됨/미등록 표시 모두에 사용
  const candidates = useMemo(
    () => selectScheduleCandidates(groupLogs),
    [groupLogs],
  )
  const candidateIds = useMemo(() => candidates.map((c) => c.logId), [candidates])

  // 마운트/변경 시 캘린더 연결 상태 조회
  useEffect(() => {
    let alive = true
    if (candidateIds.length === 0) {
      setLinkedIds(new Set())
      return
    }
    getLinkedDailyLogIds(candidateIds).then((ids) => {
      if (alive) setLinkedIds(new Set(ids))
    })
    return () => {
      alive = false
    }
  }, [candidateIds])

  // 조회 전이거나 일정성 후보가 없으면 섹션 자체를 렌더하지 않음
  if (linkedIds === null || candidates.length === 0) return null

  // 등록된 항목이 하나도 없으면(아직 자동등록 전/실패) 섹션 숨김 — 사용자 조작 불필요
  const registered = candidates.filter((c) => linkedIds.has(c.logId))
  if (registered.length === 0) return null

  const cancel = (logId: string) =>
    startTransition(async () => {
      setError(null)
      const res = await unlinkDailyCalendar(logId)
      if (res.ok) {
        setLinkedIds((prev) => {
          const next = new Set(prev ?? [])
          next.delete(logId)
          return next
        })
        await mutate((key) => typeof key === 'string' && key.startsWith('/api/calendar/month?'))
      } else {
        setError(res.error ?? '취소에 실패했습니다')
      }
    })

  return (
    <section className="sched-section" aria-label="캘린더 일정">
      <p className="sched-section-title">🗓 캘린더 등록됨 {registered.length}건</p>
      <ul className="sched-list">
        {registered.map((c) => (
          <li key={c.logId} className="sched-item">
            <span className="sched-item-label">
              <span className="sched-item-added">✓ 등록됨</span>
              <span className="sched-item-text">{c.title}</span>
              <span className="sched-item-date">{dateLabelKo(c)}</span>
            </span>
            <button
              type="button"
              className="sched-btn sched-btn-cancel"
              disabled={isPending}
              onClick={() => cancel(c.logId)}
              aria-label={`${c.title} 캘린더 등록 취소`}
            >
              {isPending ? '취소 중…' : '취소'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="sched-error">{error}</p>}
    </section>
  )
}
