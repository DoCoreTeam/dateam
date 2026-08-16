'use client'

// 열린 태스크 패널 (dacrm T1-04, 구현명세 §6.2 우측 열)
//
// "다음에 무엇을 하나"가 레코드 상세에서 가장 먼저 답해야 하는 질문이다.
// 그래서 우측 맨 위에 두고, **한 줄 입력으로 바로 추가**할 수 있게 한다 —
// 별도 화면으로 보내면 지금 보던 맥락이 끊긴다.
//
// 끝난 것은 기본으로 감춘다. 남은 일이 보여야 다음 행동이 정해지고,
// 끝난 일은 타임라인에 활동으로 남으므로 여기서 또 쌓을 이유가 없다.

import { useCallback, useEffect, useState } from 'react'
import { Plus, Check, RotateCcw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { kstDateKey, kstTodayKey } from '@/lib/datetime/kst'
import type { TimelineScope } from './Timeline'
import styles from './task-panel.module.css'

export interface TaskItem {
  id: string
  title: string
  status: string
  dueAt: string | null
  completedAt: string | null
}

interface Props {
  scope: TimelineScope
  /** 태스크가 바뀌면 타임라인도 다시 읽는다(완료가 활동을 만든다) */
  onChanged?: () => void
}

export default function TaskPanel({ scope, onChanged }: Props) {
  const [items, setItems] = useState<TaskItem[]>([])
  const [showDone, setShowDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (scope.companyId) sp.set('companyId', scope.companyId)
      if (scope.personId) sp.set('personId', scope.personId)
      if (scope.dealId) sp.set('dealId', scope.dealId)
      if (!showDone) sp.set('scope', 'open')
      sp.set('limit', '30')

      const res = await fetch(`/api/crm/tasks?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '할 일을 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('할 일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [scope.companyId, scope.personId, scope.dealId, showDone])

  useEffect(() => { void load() }, [load])

  async function add() {
    if (!draft.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scope, title: draft.trim(), dueAt: due || null }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '추가하지 못했습니다.'); return }
      setDraft('')
      setDue('')
      void load()
      onChanged?.()
    } catch {
      setError('추가하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(id: string, status: 'DONE' | 'TODO') {
    setError(null)
    try {
      const res = await fetch(`/api/crm/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? '바꾸지 못했습니다.')
        return
      }
      void load()
      onChanged?.()
    } catch {
      setError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  const today = kstTodayKey()

  return (
    <div className={styles.wrap}>
      <FormErrorBanner message={error} />

      <div className={styles.composer}>
        <input
          className="input-field" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="다음에 할 일"
          aria-label="다음에 할 일"
        />
        <input
          className="input-field" type="date" value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="마감일"
        />
        <NbButton onClick={() => void add()} disabled={saving || !draft.trim()}>
          <Plus size={14} /> 추가
        </NbButton>
      </div>

      {loading && items.length === 0 ? null : items.length === 0 ? (
        <EmptyState
          title={showDone ? '할 일이 없어요' : '열린 할 일이 없어요'}
          description="다음에 할 일을 적어 두면 잊지 않습니다."
        />
      ) : (
        <ul className={styles.list}>
          {items.map((t) => {
            const done = t.status === 'DONE'
            const dueKey = t.dueAt ? kstDateKey(t.dueAt) : null
            // 기한이 지난 것은 눈에 띄어야 한다 — 목록에 섞이면 지났는지 세어 봐야 안다
            const overdue = Boolean(dueKey && !done && dueKey < today)
            return (
              <li key={t.id} className={styles.item}>
                <button
                  type="button"
                  className={`${styles.check}${done ? ` ${styles.checkOn}` : ''}`}
                  aria-label={done ? `${t.title} 되돌리기` : `${t.title} 완료`}
                  onClick={() => void setStatus(t.id, done ? 'TODO' : 'DONE')}
                >
                  {done ? <RotateCcw size={12} /> : <Check size={12} />}
                </button>
                <span className={`${styles.title}${done ? ` ${styles.titleDone}` : ''}`}>
                  {t.title}
                  {dueKey && (
                    <span className={`${styles.due}${overdue ? ` ${styles.dueOver}` : ''}`}>
                      {overdue ? `${dueKey} 지남` : dueKey}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className={styles.toggle} onClick={() => setShowDone((v) => !v)}>
        {showDone ? '열린 것만 보기' : '끝난 것도 보기'}
      </button>
    </div>
  )
}
