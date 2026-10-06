'use client'

// 할 일 수정 모달 — 만들 때 적게 한 칸을 만든 뒤에도 고치는 자리
//
// **왜 생겼나**(사용자 지적 2026-10-06): *"할일도 일정 수정할 수 있어야지
// 내용이랑 삭제만 있네 CRUD 정책 지켜"*
//
// 서버는 처음부터 받고 있었다 — `PATCH /api/crm/tasks/:id` 가 `title`·`startAt`·`dueAt` 를
// 그대로 처리한다(lib/crm/services/task.ts `normalizeInput`). **화면이 안 불렀을 뿐이다.**
// 보내던 것은 `status`(완료 토글)와 `dealId`(딜 잇기) 둘뿐이라, 마감을 하루 미루려면
// 지우고 다시 만드는 수밖에 없었다 — 그러면 딜 연결과 만든 날이 함께 사라진다.
// 정책 §2-5 (3) 이 금지한 「서버에는 있는데 화면이 안 부른다」가 그대로였다.
//
// **왜 부품인가**: 할 일을 다루는 화면이 둘이다 — 목록(`/crm/tasks`)과 레코드 상세의
// 할 일 패널. 각자 짜면 한쪽만 고쳐지고 두 화면이 다른 일을 하게 된다(§2-5 같은 종류 UI 한 벌).
//
// **왜 모달인가**: 할 일에는 상세 화면이 없다(맥락이 붙어 있는 딜·회사·인물에 있다).
// 그리고 목록의 행은 누르면 그 딜로 간다 — 칸 안에서 바로 고치게 하면 날짜를 고르다
// 빗나간 한 번이 화면을 통째로 바꾼다.

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import DateField from '@/components/ui/DateField'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import InlineError from '@/components/ui/InlineError'
import { ACTION, ENTITY, failedTo, progress } from '@/lib/terms'
import { kstDateKey } from '@/lib/datetime/kst'
import { toStartIso, toDueIso, startsAfterDue } from '@/lib/crm/ui/task-due'
import { isEnterKey } from '@/lib/ui/ime'
import styles from './task-edit-modal.module.css'

/** 고칠 수 있는 칸만 받는다 — 상태·완료 시각은 서버가 주인이다 */
export interface EditableTask {
  id: string
  title: string
  startAt: string | null
  dueAt: string | null
}

interface Props {
  task: EditableTask
  onClose: () => void
  /** 저장이 끝났다 — 부르는 쪽이 목록을 다시 읽는다 */
  onSaved: () => void
}

export default function TaskEditModal({ task, onClose, onSaved }: Props) {
  /*
    **지금 값으로 연다.** 비워 놓고 시작하면 사용자는 「고치기」를 눌렀는데
    「새로 적기」를 하게 되고, 안 건드린 칸이 조용히 지워진다.

    날짜는 KST 날짜로 되읽는다 — 서버가 준 것은 UTC ISO 라 그대로 자르면
    오전 9시 이전에 하루 전으로 보인다(§datetime).
  */
  const [title, setTitle] = useState(task.title)
  const [start, setStart] = useState(() => (task.startAt ? kstDateKey(task.startAt) : ''))
  const [due, setDue] = useState(() => (task.dueAt ? kstDateKey(task.dueAt) : ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!title.trim()) { setError('무엇을 할지 적어 주세요.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        /*
          셋을 **함께** 보낸다. 바뀐 것만 골라 보내면 「무엇이 바뀌었나」를 화면이 판정해야 하고,
          그 판정이 틀리면 사용자가 고친 칸이 조용히 안 간다.

          빈 날짜는 `toStartIso('')` 가 `null` 을 주고 서버가 그걸 «지움»으로 받는다 —
          그래서 마감을 떼는 것도 여기서 할 수 있다. 추가 줄과 같은 SSOT(task-due.ts)를 쓴다.
        */
        body: JSON.stringify({
          title: title.trim(),
          startAt: toStartIso(start),
          dueAt: toDueIso(due),
        }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError(b?.error?.message ?? failedTo(ENTITY.task.label, ACTION.edit))
        return
      }
      onSaved()
    } catch {
      setError(failedTo(ENTITY.task.label, ACTION.edit))
    } finally {
      setSaving(false)
    }
  }

  return (
    <NbModal
      title={`${ENTITY.task.label} ${ACTION.edit}`}
      onClose={onClose}
      maxWidth={440}
      footer={(
        <>
          <NbButton variant="ghost" onClick={onClose} disabled={saving}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void save()} disabled={saving}>
            {saving ? progress(ACTION.save) : ACTION.save}
          </NbButton>
        </>
      )}
    >
      <FormErrorBanner message={error} />

      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>{ENTITY.task.label}</span>
          <input
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (isEnterKey(e)) void save() }}
            autoFocus
          />
        </label>

        <div className={styles.dates}>
          <label className={styles.field}>
            <span className={styles.label}>시작</span>
            <DateField value={start} onValueChange={setStart} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>마감</span>
            {/*
              시작 뒤로 잠그지 않는다. 마감을 먼저 당기고 시작을 뒤에 고치는 순서가 실제로 있고,
              `min` 으로 막으면 그 순서를 밟는 사람은 달력에서 날을 아예 못 고른다.
              대신 아래 한 줄로 알린다 — 추가 줄과 같은 규칙이다.
            */}
            <DateField value={due} onValueChange={setDue} />
          </label>
        </div>

        {startsAfterDue(start, due) && (
          <InlineError>시작일이 마감일보다 늦어요. 그대로 두셔도 되지만 한 번 확인해 주세요.</InlineError>
        )}

        {/*
          날짜를 비우면 어떻게 되는지 적는다. 빈 칸이 「안 정함」인지 「오늘」인지
          화면이 말해 주지 않으면 사람은 비우기를 안 누른다.
        */}
        <p className={styles.hint}>날짜를 비우면 안 정한 것이 됩니다.</p>
      </div>
    </NbModal>
  )
}
