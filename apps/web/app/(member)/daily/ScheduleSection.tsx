'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { DailyLog } from '@/types/database'
import { selectScheduleCandidates, type ScheduleCandidate } from '@/lib/daily/schedule-candidates'
import { getLinkedDailyLogIds, createDailyScheduleEvent } from '../calendar/actions'

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
 * "② 일정 후보" 섹션 (P2) — 일정성 항목을 캘린더에 추가하는 확인형 UI.
 *
 * 자동 등록 절대 금지: 사용자가 체크한 항목에 대해 "선택 항목 캘린더에 추가"
 * 버튼을 눌러야만 createDailyScheduleEvent(INSERT)가 호출된다.
 * 비파괴: daily_logs 원본은 읽기만 하고 수정·삭제하지 않는다.
 */
export function ScheduleSection({ groupLogs }: ScheduleSectionProps) {
  const [linkedIds, setLinkedIds] = useState<ReadonlySet<string> | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // 후보 logId 목록(연결 조회 입력)
  const baseCandidateIds = useMemo(
    () => selectScheduleCandidates(groupLogs).map((c) => c.logId),
    [groupLogs],
  )

  // 마운트 시 이미 연결된 항목 조회 → 후보에서 숨김
  useEffect(() => {
    let alive = true
    if (baseCandidateIds.length === 0) {
      setLinkedIds(new Set())
      return
    }
    getLinkedDailyLogIds(baseCandidateIds).then((ids) => {
      if (alive) setLinkedIds(new Set(ids))
    })
    return () => {
      alive = false
    }
  }, [baseCandidateIds])

  const candidates = useMemo(
    () => selectScheduleCandidates(groupLogs, linkedIds ?? new Set()),
    [groupLogs, linkedIds],
  )

  // 연결 조회 완료 후 1회 기본 전체 선택(이미 추가된 건 제외).
  // 이후 사용자 체크 변경은 보존한다(재실행은 linkedIds 확정 1회뿐).
  const [didInit, setDidInit] = useState(false)
  useEffect(() => {
    if (linkedIds === null || didInit) return
    setChecked(new Set(candidates.filter((c) => !added.has(c.logId)).map((c) => c.logId)))
    setDidInit(true)
  }, [linkedIds, didInit, candidates, added])

  // 조회 전이거나 후보가 없으면 섹션 자체를 렌더하지 않음
  if (linkedIds === null || candidates.length === 0) return null

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectable = candidates.filter((c) => !added.has(c.logId))
  const selectedCount = selectable.filter((c) => checked.has(c.logId)).length

  const addSelected = () =>
    startTransition(async () => {
      setError(null)
      const targets = selectable.filter((c) => checked.has(c.logId))
      const ok = new Set<string>()
      for (const c of targets) {
        const res = await createDailyScheduleEvent({
          title: c.title,
          start_at: c.startAt,
          link_id: c.logId,
        })
        if (res.ok) ok.add(c.logId)
        else setError(res.error ?? '일부 항목 추가에 실패했습니다')
      }
      if (ok.size > 0) {
        setAdded((prev) => {
          const next = new Set(prev)
          ok.forEach((id) => next.add(id))
          return next
        })
        setChecked((prev) => {
          const next = new Set(prev)
          ok.forEach((id) => next.delete(id))
          return next
        })
      }
    })

  return (
    <section className="sched-section" aria-label="일정 후보">
      <p className="sched-section-title">② 일정 후보 {candidates.length}건 — 캘린더에 추가</p>
      <ul className="sched-list">
        {candidates.map((c) => {
          const isAdded = added.has(c.logId)
          return (
            <li key={c.logId} className="sched-item">
              <label className="sched-item-label">
                <input type="checkbox"
                  className="sched-checkbox"
                  checked={!isAdded && checked.has(c.logId)}
                  disabled={isAdded || isPending}
                  onChange={() => toggle(c.logId)}
                  aria-label={`${c.title} 일정 선택`}
                />
                <span className="sched-item-text">{c.title}</span>
                <span className="sched-item-date">{dateLabelKo(c)}</span>
              </label>
              {isAdded && <span className="sched-item-added">추가됨</span>}
            </li>
          )
        })}
      </ul>
      {error && <p className="sched-error">{error}</p>}
      <div className="sched-actions">
        <button
          type="button"
          className="sched-btn sched-btn-add"
          disabled={selectedCount === 0 || isPending}
          onClick={addSelected}
        >
          {isPending ? '추가 중…' : `선택 항목 캘린더에 추가 (${selectedCount})`}
        </button>
      </div>
    </section>
  )
}
