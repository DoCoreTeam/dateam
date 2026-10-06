'use client'

// 열린 태스크 패널 (dacrm T1-04, 구현명세 §6.2 우측 열)
//
// "다음에 무엇을 하나"가 레코드 상세에서 가장 먼저 답해야 하는 질문이다.
// 그래서 우측 맨 위에 두고, **한 줄 입력으로 바로 추가**할 수 있게 한다 —
// 별도 화면으로 보내면 지금 보던 맥락이 끊긴다.
//
// 끝난 것은 기본으로 감춘다. 남은 일이 보여야 다음 행동이 정해지고,
// 끝난 일은 타임라인에 활동으로 남으므로 여기서 또 쌓을 이유가 없다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { initialDueDate, initialStartDate, toStartIso, toDueIso } from '@/lib/crm/ui/task-due'
import { Plus, Check, RotateCcw, Pencil, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DateField from '@/components/ui/DateField'
import { kstDateKey, kstTodayKey } from '@/lib/datetime/kst'
import { ACTION, ENTITY, confirmDeleteParts, failedTo } from '@/lib/terms'
import { useAskDialog } from '@/components/ui/useAskDialog'
import TaskEditModal from './TaskEditModal'
import type { TimelineScope } from './Timeline'
import styles from './task-panel.module.css'
import { emitAttentionChanged } from '@/lib/crm/ui/attention-signal'

export interface TaskItem {
  id: string
  title: string
  status: string
  /** 시작하는 날. 서버는 처음부터 줬는데 이 패널이 안 받아 「언제부터」를 못 그렸다 */
  startAt: string | null
  dueAt: string | null
  completedAt: string | null
}

interface Props {
  scope: TimelineScope
  /** 태스크가 바뀌면 타임라인도 다시 읽는다(완료가 활동을 만든다) */
  onChanged?: () => void
}

export default function TaskPanel({ scope, onChanged }: Props) {
  /**
   * 마지막 할 일을 끝냈을 때 입력칸으로 데려가기 위한 것.
   *
   * Pipedrive 는 활동을 완료하면 **즉시 다음 활동 입력창**을 띄운다 — 비워 두지 못하게.
   * 그게 "모든 열린 딜에는 다음 활동이 있어야 한다"를 실제로 지키게 만드는 장치다.
   * 모달로 막지는 않는다(그건 성가시다). 대신 **커서를 옮기고 한 줄로 알린다.**
   */
  const nextRef = useRef<HTMLInputElement>(null)

  /*
    주소에 `#crm-next-task` 가 붙어 들어오면 그 칸으로 데려간다.
    스크롤만 하고 커서를 안 놓으면 사용자는 «여기서 뭘 하라는 거지»가 된다.
  */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash !== '#crm-next-task') return
    const t = setTimeout(() => {
      nextRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      nextRef.current?.focus()
    }, 400)
    return () => clearTimeout(t)
  }, [])
  const [askNext, setAskNext] = useState(false)
  const [items, setItems] = useState<TaskItem[]>([])
  const [showDone, setShowDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /*
    **마감은 오늘부터**(v0.7.696 · 사용자 지시). 목록 화면(TasksClient)과 같은 성격의 칸이라
    같은 규칙을 쓴다 — 한쪽만 고치면 같은 일을 두 화면이 다르게 시작한다.
  */
  const [due, setDue] = useState(() => initialDueDate(null))
  /* 시작일 — 목록 화면과 같은 규칙(v0.7.696 · 사용자 지시 「할일도 시작과 종료일이」) */
  const [start, setStart] = useState(() => initialStartDate(null))
  const [saving, setSaving] = useState(false)
  /**
   * 고치는 중인 할 일 — 목록 화면과 **같은 부품**을 연다(§2-5).
   *
   * 여기만 따로 짜면 두 화면이 다른 칸을 고치게 되고, 한쪽을 고칠 때 다른 쪽이 남는다.
   */
  const [editing, setEditing] = useState<TaskItem | null>(null)
  /** 지우는 중인 할 일 하나 — 단추를 두 번 누르는 동안 줄이 안 흔들리게 id 로 잡는다 */
  const [busy, setBusy] = useState<string | null>(null)
  const { ask, dialog } = useAskDialog()

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
        /*
          **KST 앵커를 박아 보낸다**(v0.7.696 정정). 예전엔 `due` 를 그대로 넘겼는데
          오프셋 없는 `YYYY-MM-DD` 는 UTC 자정으로 파싱돼 KST 로는 그날 아침 9시가 된다 —
          같은 값을 목록 화면(TasksClient)은 `+09:00` 로 보내고 있어 **두 화면이 갈려 있었다**(§datetime).
        */
        body: JSON.stringify({
          ...scope, title: draft.trim(),
          startAt: toStartIso(start), dueAt: toDueIso(due),
        }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '추가하지 못했습니다.'); return }
      setDraft('')
      setAskNext(false)
      setDue(initialDueDate(null)); setStart(initialStartDate(null))
      void load()
      onChanged?.()
      // 사이드바 배지·알림 벨도 같은 사실을 센다
      emitAttentionChanged()
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
      /**
       * 이게 마지막 남은 할 일이었다면 **딜이 조용히 멈춘다.**
       * 그 순간 다음을 묻는다 — 나중에 알려 주면 이미 잊었다.
       */
      const wasLast = status === 'DONE'
        && items.filter((t) => t.status !== 'DONE' && t.id !== id).length === 0
        && !!scope.dealId

      void load()
      onChanged?.()

      if (wasLast) {
        setAskNext(true)
        setTimeout(() => nextRef.current?.focus(), 60)
      }
      emitAttentionChanged()
    } catch {
      setError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  /**
   * 지우는 길이 없었다.
   *
   * `DELETE /api/crm/tasks/:id` 는 목록 화면이 이미 부르고 있는데 **이 패널만 안 불렀다** —
   * 딜 상세에서 잘못 적은 할 일을 보고도 지우려면 목록 화면까지 가야 했다(§2-5 (3)).
   * 확인은 목록과 같은 문장으로 받는다 — 같은 일이 화면마다 다르게 물으면 사용자는 둘을 다른 일로 읽는다.
   */
  async function remove(t: TaskItem) {
    const c = confirmDeleteParts('task', 1, { stays: '딜과 미팅 기록' })
    if (!await ask.confirm({
      title: c.title, body: c.body,
      confirmLabel: ACTION.delete, danger: true,
    })) return
    setBusy(t.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/tasks/${t.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? failedTo(ENTITY.task.label, ACTION.delete))
        return
      }
      void load()
      onChanged?.()
      emitAttentionChanged()
    } catch {
      setError(failedTo(ENTITY.task.label, ACTION.delete))
    } finally {
      setBusy(null)
    }
  }

  const today = kstTodayKey()

  return (
    <div className={styles.wrap}>
      <FormErrorBanner message={error} />

      {/*
        마지막 할 일을 끝냈다 — 지금이 다음을 정할 자리다.
        커서만 옮기면 사용자는 왜 옮겨졌는지 모른다. 이유를 한 줄로 말한다.
      */}
      {askNext && (
        <p className={styles.askNext}>
          이게 마지막이었어요. <strong>다음에 뭘 할지</strong> 정해 두면 이 딜이 멈추지 않습니다.
        </p>
      )}

      <div className={styles.composer}>
        <input
          ref={nextRef}
          /*
            **주소로 이 칸을 지목할 수 있게 한다.**
            보드의 「다음 할 일 적기」가 `#crm-next-task` 로 보내면, 상세 화면이
            열리자마자 이 칸에 커서가 놓인다 — 사용자가 화면에서 다시 찾지 않는다.
          */
          id="crm-next-task"
          className="input-field" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="다음에 할 일"
          aria-label="다음에 할 일"
        />
        {/* 선택 항목이라 기본값을 넣지 않는다 — '마감 없음'과 '오늘 마감'은 다른 뜻이다. */}
        <DateField value={start} onValueChange={setStart} aria-label="시작일" />
        <DateField value={due} onValueChange={setDue} min={start || undefined} aria-label="마감일" />
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
            const startKey = t.startAt ? kstDateKey(t.startAt) : null
            const dueKey = t.dueAt ? kstDateKey(t.dueAt) : null
            // 기한이 지난 것은 눈에 띄어야 한다 — 목록에 섞이면 지났는지 세어 봐야 안다
            const overdue = Boolean(dueKey && !done && dueKey < today)
            return (
              <li key={t.id} className={styles.item}>
                <button
                  type="button"
                  className={`${styles.check}${done ? ` ${styles.checkOn}` : ''}`}
                  aria-label={done ? `${t.title} ${ACTION.restore}` : `${t.title} 완료`}
                  onClick={() => void setStatus(t.id, done ? 'TODO' : 'DONE')}
                >
                  {done ? <RotateCcw size={12} /> : <Check size={12} />}
                </button>
                <span className={`${styles.title}${done ? ` ${styles.titleDone}` : ''}`}>
                  {t.title}
                  {/*
                    **언제부터 언제까지를 함께 적는다.** 마감만 보이면 「오늘 시작해야 하는 것」과
                    「다음 주에 시작할 것」이 같은 줄로 보인다 — 목록 화면은 이미 둘을 나눠 보여 준다.
                  */}
                  {(startKey || dueKey) && (
                    <span className={`${styles.due}${overdue ? ` ${styles.dueOver}` : ''}`}>
                      {startKey && `${startKey} 시작`}
                      {startKey && dueKey && ' · '}
                      {dueKey && (overdue ? `${dueKey} 지남` : `${dueKey}까지`)}
                    </span>
                  )}
                </span>
                {/*
                  **고치기와 지우기.** 이 패널은 추가와 완료만 할 수 있었다 —
                  적어 놓고 날짜가 밀리면 지울 수도 고칠 수도 없어서, 끝내지도 않은 것을
                  완료로 눌러 치우는 수밖에 없었다(그러면 타임라인에 거짓 활동이 남는다).
                */}
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.rowBtn}
                    onClick={() => setEditing(t)}
                    disabled={busy === t.id}
                    aria-label={`${t.title} ${ACTION.edit}`}
                    title={ACTION.edit}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className={styles.rowRemove}
                    onClick={() => void remove(t)}
                    disabled={busy === t.id}
                    aria-label={`${t.title} ${ACTION.delete}`}
                    title={ACTION.delete}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className={styles.toggle} onClick={() => setShowDone((v) => !v)}>
        {showDone ? '열린 것만 보기' : '끝난 것도 보기'}
      </button>

      {/* 목록 화면과 **같은 모달**이다 — 고치는 칸이 두 화면에서 갈리지 않는다 */}
      {editing && (
        <TaskEditModal
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
            onChanged?.()
            emitAttentionChanged()
          }}
        />
      )}

      {dialog}
    </div>
  )
}
