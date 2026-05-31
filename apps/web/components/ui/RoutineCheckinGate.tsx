'use client'

import { useState, useEffect, useTransition } from 'react'
import { upsertRoutineCheck } from '@/app/(member)/routine/actions'
import type { RoutineItemParsed } from '@/lib/routine-defaults'

interface Props {
  weekStart: string
  weeklyItems: RoutineItemParsed[]
  initialCompletedNames: string[]
}

export default function RoutineCheckinGate({ weekStart, weeklyItems, initialCompletedNames }: Props) {
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState<Set<string>>(new Set(initialCompletedNames))
  const [isPending, startTransition] = useTransition()

  const pendingItems = weeklyItems.filter((i) => !completed.has(i.name))

  useEffect(() => {
    if (weeklyItems.length === 0) return
    const todayStr = new Date().toISOString().slice(0, 10)
    const key = `routine-checkin-${todayStr}`
    if (!localStorage.getItem(key) && pendingItems.length > 0) {
      localStorage.setItem(key, '1')
      setOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleToggle(name: string) {
    const newDone = !completed.has(name)
    setCompleted((prev) => {
      const next = new Set(prev)
      if (newDone) next.add(name)
      else next.delete(name)
      return next
    })
    startTransition(async () => {
      await upsertRoutineCheck(name, weekStart, weekStart, newDone)
    })
  }

  const allDone = weeklyItems.every((i) => completed.has(i.name))
  const pendingCount = weeklyItems.filter((i) => !completed.has(i.name)).length

  if (weeklyItems.length === 0) return null

  return (
    <>
      {/* 체크인 모달 */}
      {open && (
        <>
          <div className="checkin-modal-overlay" onClick={() => setOpen(false)} />
          <div className="checkin-modal" role="dialog" aria-modal="true" aria-label="이번 주 루틴 체크">
            <div className="checkin-modal-header">
              <div>
                <p className="checkin-modal-label">루틴</p>
                <h2 className="checkin-modal-title">이번 주 루틴 체크</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="checkin-modal-close"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="checkin-modal-body">
              {weeklyItems.map((item) => {
                const done = completed.has(item.name)
                return (
                  <button
                    key={item.name}
                    onClick={() => handleToggle(item.name)}
                    disabled={isPending}
                    className={`checkin-item${done ? ' checkin-item-done' : ''}`}
                    aria-pressed={done}
                  >
                    <span className={`checkin-checkbox${done ? ' checkin-checkbox-done' : ''}`}>
                      {done && (
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                          <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <span className="checkin-item-label">{item.name}</span>
                    {done && <span className="checkin-done-badge">완료</span>}
                  </button>
                )
              })}
            </div>

            <div className="checkin-modal-footer">
              {allDone ? (
                <p className="checkin-all-done">이번 주 루틴을 모두 완료했습니다!</p>
              ) : (
                <p className="checkin-progress">{weeklyItems.length - pendingCount} / {weeklyItems.length} 완료</p>
              )}
              <button className="checkin-close-btn" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
