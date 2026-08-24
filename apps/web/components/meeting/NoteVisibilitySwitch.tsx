'use client'

/**
 * 공개 범위 — **"기록만 / 팀 공개"를 여기서 바꾼다.**
 *
 * ⚠️ 이 스위치는 **CRM 미팅 화면에서만** 뜬다(v0.7.596). 거기서는 이미 팀에 올라간
 * 상태라 `private` 을 "나만 보기"라고 부르면 거짓말이다 — 팀은 요약·전사 사본을 계속 본다.
 * 그래서 말은 손잡이 SSOT(`lib/meeting/share-state.ts`)에서 가져온다.
 * 회의노트 화면에서는 하단 카드 하나가 세 상태를 전부 맡는다(사용자 지적 2026-08-24).
 *
 * 사용자 결정(D6) 원문: *"미팅에서 생성하면 기본으로 공개이고 **수정 할 수 있음** 되지 나만보기라던지"*.
 * 앞부분(기본값)은 v0.7.575 에 들어갔는데 **뒷부분이 통째로 빠져 있었다** —
 * 컬럼(마이그 216)·정책(마이그 220)은 다 있는데 화면에 스위치가 0개였다(v0.7.588 실측).
 *
 * ⚠️ 읽기 공개이지 편집 공개가 아니다. 고치고 지우는 것은 언제나 작성한 사람뿐이다.
 */

import { useState } from 'react'
import { Eye, FileText } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import { NOTE_VISIBILITY, type NoteVisibility } from '@/lib/meeting/note-visibility'
import { SHARE_STATE_LABEL, SHARE_STATE_HINT } from '@/lib/meeting/share-state'
import styles from './workbench.module.css'

export default function NoteVisibilitySwitch({
  noteId, initial,
}: { noteId: string; initial: NoteVisibility }) {
  const [value, setValue] = useState<NoteVisibility>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: NoteVisibility) {
    if (next === value || busy) return
    const prev = value
    setValue(next)          // 먼저 바꿔 보여 준다 — 누르고 아무 일도 없어 보이면 두 번 누른다
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setValue(prev)      // 실패하면 되돌린다 — 안 되돌리면 바뀐 줄 안다
        setError(body?.error ?? '공개 범위를 바꾸지 못했습니다.')
      }
    } catch {
      setValue(prev)
      setError('공개 범위를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.visWrap}>
      <div className={styles.vis} role="group" aria-label="공개 범위">
        {([NOTE_VISIBILITY.PRIVATE, NOTE_VISIBILITY.CRM] as NoteVisibility[]).map((v) => (
          <button
            key={v}
            type="button"
            className={`${styles.visBtn}${value === v ? ` ${styles.visOn}` : ''}`}
            aria-pressed={value === v}
            title={SHARE_STATE_HINT[v === NOTE_VISIBILITY.PRIVATE ? 'RECORD_ONLY' : 'TEAM']}
            disabled={busy}
            onClick={() => void change(v)}
          >
            {v === NOTE_VISIBILITY.PRIVATE ? <FileText size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
            {SHARE_STATE_LABEL[v === NOTE_VISIBILITY.PRIVATE ? 'RECORD_ONLY' : 'TEAM']}
          </button>
        ))}
      </div>
      {error && <InlineError onDismiss={() => setError(null)}>{error}</InlineError>}
    </div>
  )
}
