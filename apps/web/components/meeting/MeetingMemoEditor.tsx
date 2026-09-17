'use client'

/**
 * 회의 메모 편집기 — **저장을 기다리지 않지만, 끝내는 버튼은 있다.**
 *
 * 계약은 미팅 캡처 화면의 것을 그대로 따른다: *"내용을 넣기 시작하는 순간이 저장이다."*
 * 회의 중에 치는 글에 "저장을 누르세요"를 요구하면, 누르지 않은 채 탭이 죽는 날이 온다.
 * (기존 `MeetingEditor` 는 명시 저장이다 — 그건 회의가 끝난 뒤 차분히 정리하는 자리라 남긴다.)
 *
 * **그래도 [저장]과 [취소]는 보인다**(사용자 지시 2026-09-17:
 * *"수정을 누르고 내용을 수정했으면 저장 버튼이 있어야함 지금 저장은 되는데 저장버튼이 없어"*).
 * 자동저장은 **잃지 않기 위한 장치**이지 «다 됐다»를 알려 주는 장치가 아니다 —
 * 고치던 사람은 끝내는 동작이 있어야 손을 뗀다. 그래서 저장은 **기다리던 5초를 앞당겨**
 * 지금 밀어 넣고 읽기로 돌아가는 일이고, 취소는 **「수정」을 누른 시점으로 되돌리는** 일이다.
 * 취소가 서버까지 되돌리지 않으면 거짓말이 된다 — 자동저장이 이미 써 두었을 수 있다.
 *
 * 세 겹으로 지킨다.
 *   ① 5초 debounce 서버 저장
 *   ② 로컬 임시저장(`useDraftPersist`) — 서버가 실패해도 글은 브라우저에 남는다
 *   ③ 화면을 떠날 때 마지막 한 번 밀어 넣는다(flush)
 *
 * **읽기 전용은 비활성 편집기가 아니라 읽기 컴포넌트다.** 못 쓰는 입력칸을 보여 주면
 * 사람은 고칠 수 있다고 믿고 쳤다가 잃는다(마이그 216: 읽기 공개이지 편집 공개가 아니다).
 *
 * **쓸 수 있는 사람에게도 기본은 읽기다**(v0.7.677).
 * 그전에는 상세를 열면 곧바로 커서가 들어가는 편집기였다. 그런데 같은 화면이 위에서는
 * 「[수정]에서 추가하세요」라고 말하고 있어서, 한 화면이 «읽는 곳»과 «쓰는 곳» 두 가지를
 * 동시에 주장했다(사용자 지적: "수정을 눌러야 텍스트 수정이 되는 에디터 모드여야 하지 않아?").
 * 끝난 회의를 다시 읽다가 실수로 글자가 지워져도 5초 뒤 저절로 저장되는 구조라 더 위험했다.
 *
 * 예외는 **본문이 비었을 때 하나뿐이다** — 읽을 것이 없는데 「수정」을 한 번 더 누르게 하면
 * 회의 중에 받아적는 것을 막는다. 그리고 임시저장된 글이 있으면 그것도 곧장 쓰기로 연다
 * (안 그러면 복원 배너가 읽기 모드 뒤에 숨어 글이 영영 안 돌아온다).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, Pencil, Save } from 'lucide-react'
import TiptapEditor from '@/components/ui/TiptapEditor'
import RichText from '@/components/ui/RichText'
import NbButton from '@/components/ui/nb/NbButton'
import { ACTION, progress } from '@/lib/terms'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { shouldStartWriting, plainTextLength } from '@/lib/meeting/memo-mode'
import InlineError from '@/components/ui/InlineError'
import DraftRestoreBanner from '@/components/ui/DraftRestoreBanner'
import { useDraftPersist } from '@/lib/forms/useDraftPersist'
import { registerPendingSave, type FlushOutcome } from '@/lib/meeting/pending-save'
import styles from './workbench.module.css'

/** 자동저장 간격. 회의 중 타이핑을 끊지 않으면서, 잃어도 5초어치인 값 */
const SAVE_DEBOUNCE_MS = 5000

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

interface Props {
  noteId: string
  initialHtml: string
  canEdit: boolean
  /** 임시저장 키를 사람마다 가른다 — 공용 PC 에서 남의 초안이 뜨면 안 된다 */
  userId?: string
  /** 헤더가 "저장됨 14:32" 를 그릴 수 있게 알린다 */
  onStateChange?: (state: SaveState, savedAt: number | null) => void
  /** 글자 수 배지용 */
  onLengthChange?: (chars: number) => void
}

export default function MeetingMemoEditor({
  noteId, initialHtml, canEdit, userId, onStateChange, onLengthChange,
}: Props) {
  const [html, setHtml] = useState(initialHtml)
  /**
   * 에디터에 **밀어 넣는** 값. 내가 친 글을 되먹이지 않는다.
   *
   * `TiptapEditor` 는 `value !== editor.getHTML()` 이면 `setContent` 로 되돌린다.
   * 내 state 를 그대로 `value` 로 주면, 빠르게 칠 때 ProseMirror 가 먼저 앞서 나가고
   * 그 순간 옛 값으로 되돌려져 **onUpdate ↔ setContent 핑퐁**이 난다
   * (실측: "Maximum update depth exceeded", 실브라우저에서만 잡혔다).
   * 그래서 이 값은 **복원처럼 일부러 밀어 넣을 때만** 바꾼다.
   */
  const [pushedHtml, setPushedHtml] = useState(initialHtml)
  const [state, setState] = useState<SaveState>('clean')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 읽기 ↔ 쓰기. 판정은 `lib/meeting/memo-mode` 가 한다(SSOT · 가드가 잠근다) */
  const [writing, setWriting] = useState(
    () => shouldStartWriting({ hasBody: plainTextLength(initialHtml) > 0, hasDraft: false }),
  )
  /** [저장]을 누른 뒤 서버가 답할 때까지 — 두 번 눌리는 것을 막고 「저장 중…」을 띄운다 */
  const [ending, setEnding] = useState(false)
  const { ask, dialog } = useAskDialog()

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 마지막으로 서버가 받은 값 — 같으면 안 보낸다(빈 요청이 5초마다 나가는 것을 막는다) */
  const savedHtml = useRef(initialHtml)
  const latest = useRef(initialHtml)
  /**
   * 「수정」을 누른 **그 순간의 글** — [취소]가 돌아갈 자리다.
   *
   * `savedHtml` 로 대신할 수 없다: 자동저장이 한 번이라도 돌면 그 값은 **고치던 중의 글**이
   * 되어, 취소가 «고친 것을 확정»하는 뜻이 된다. 되돌릴 기준은 손대기 전의 글 하나뿐이다.
   */
  const snapshot = useRef(initialHtml)

  const draft = useDraftPersist<string>({
    formId: 'meeting-memo',
    recordId: noteId,
    userId: userId ?? '',
    value: html,
    initial: initialHtml,
    onRestore: (v) => { setHtml(v); setPushedHtml(v); latest.current = v; setState('dirty') },
    enabled: canEdit,
  })

  useEffect(() => { onStateChange?.(state, savedAt) }, [state, savedAt, onStateChange])
  useEffect(() => { onLengthChange?.(plainTextLength(html)) }, [html, onLengthChange])

  /**
   * 임시저장된 글이 있으면 읽기 모드로 가두지 않는다.
   * 복원 배너는 쓰기 화면에만 있다 — 읽기 뒤에 숨기면 브라우저에 남은 글이 영영 안 돌아온다.
   */
  useEffect(() => { if (draft.hasDraft) setWriting(true) }, [draft.hasDraft])

  /** `useDraftPersist` 는 매 렌더 새 객체를 준다 — 그대로 의존하면 콜백 신원이 계속 바뀐다 */
  const clearDraft = useRef(draft.clear)
  clearDraft.current = draft.clear

  /**
   * 지금 값을 서버에 보낸다.
   *
   * **결과를 돌려준다** — 「보낼 게 없었다(nothing)」와 「보내려다 실패했다(failed)」는
   * 다른 사실이다. 「미팅 끝내기」가 이 둘을 구분해야 옛 글로 정리할지 판단할 수 있다
   * (`lib/meeting/pending-save.ts`).
   */
  const push = useCallback(async (): Promise<FlushOutcome> => {
    const value = latest.current
    if (value === savedHtml.current) { setState('clean'); return 'nothing' }
    setState('saving')
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyHtml: value }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? '저장하지 못했어요. 잠시 후 다시 시도할게요.')
        setState('error')
        return 'failed'
      }
      savedHtml.current = value
      setSavedAt(Date.now())
      setState('saved')
      setError(null)
      // 서버가 받았으니 로컬 사본은 지운다 — 남겨 두면 다음 방문에 복원 배너가 헛되이 뜬다
      clearDraft.current()
      return 'saved'
    } catch {
      setError('저장하지 못했어요. 연결을 확인해 주세요. 쓰던 글은 이 브라우저에 남아 있습니다.')
      setState('error')
      return 'failed'
    }
  }, [noteId])

  /**
   * 「미팅 끝내기」가 정리를 시작하기 전에 이 글을 밀어 넣을 수 있게 등록한다.
   *
   * 5초 디바운스가 안 터진 상태에서 끝내기를 누르면 방금 친 문장이 서버에 없다.
   * 그대로 정리하면 **그 문장이 빠진 글**을 읽고, 사용자는 빠졌다는 사실조차 모른다.
   *
   * 고칠 수 없는 사람은 등록하지 않는다 — 저장할 권한이 없으니 밀어 넣을 것도 없다.
   */
  useEffect(() => {
    if (!canEdit) return
    return registerPendingSave(`meeting-memo:${noteId}`, push)
  }, [canEdit, noteId, push])

  const onChange = useCallback((next: string) => {
    setHtml(next)
    latest.current = next
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void push() }, SAVE_DEBOUNCE_MS)
  }, [push])

  /** 「수정」 — 여기서부터가 고치는 구간이다. 되돌릴 기준을 이 순간에 박아 둔다 */
  function startWriting() {
    snapshot.current = latest.current
    setWriting(true)
  }

  /**
   * 「저장」 — 기다리던 5초를 앞당겨 지금 밀어 넣고 읽기로 돌아간다.
   *
   * **실패하면 화면을 안 닫는다.** 닫아 버리면 「저장」이 못 지킨 약속이 되고,
   * 사용자는 저장된 줄 알고 탭을 닫는다. 오류 줄은 그대로 남아 다음 손을 기다린다.
   */
  async function saveAndClose() {
    if (ending) return
    if (timer.current) clearTimeout(timer.current)
    setEnding(true)
    const outcome = await push()
    setEnding(false)
    if (outcome === 'failed') return
    setWriting(false)
  }

  /**
   * 「취소」 — 「수정」을 누른 시점의 글로 되돌린다. **서버까지.**
   *
   * 자동저장이 이미 고친 글을 써 두었을 수 있으므로, 화면만 되돌리면 새로고침했을 때
   * 고친 글이 되살아난다. 그때 사용자는 취소를 눌렀는데 안 됐다고 겪는다.
   * 바꾼 것이 없으면 묻지도, 보내지도 않는다 — 한 일이 없는데 확인을 받는 건 방해다.
   */
  async function cancelWriting() {
    if (ending) return
    const changed = latest.current !== snapshot.current
    if (changed) {
      const ok = await ask.confirm({
        title: '수정한 내용을 버릴까요?',
        body: '「수정」을 누르기 전 내용으로 되돌립니다. 그 사이 저절로 저장된 것도 함께 되돌려요.',
        confirmLabel: ACTION.restore,
        danger: true,
      })
      if (!ok) return
    }
    if (timer.current) clearTimeout(timer.current)
    const back = snapshot.current
    setHtml(back)
    setPushedHtml(back)
    latest.current = back
    setError(null)
    clearDraft.current()
    if (changed) {
      setEnding(true)
      await push()
      setEnding(false)
    } else {
      setState('clean')
    }
    setWriting(false)
  }

  /** 떠날 때 마지막 한 번 — 디바운스가 안 터진 채로 화면이 바뀌면 그 5초가 사라진다 */
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (latest.current !== savedHtml.current) {
      void fetch(`/api/meeting-notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyHtml: latest.current }),
        keepalive: true,
      })
    }
  }, [noteId])

  if (!canEdit) {
    return (
      <div>
        <p className={styles.readonlyNote}>
          <Lock size={13} aria-hidden /> 작성한 사람만 고칠 수 있어요. 아래는 지금 저장된 내용입니다.
        </p>
        <RichText html={initialHtml} placeholder="아직 적은 내용이 없어요." />
      </div>
    )
  }

  /**
   * 읽기 모드 — 쓸 수 있는 사람이지만 지금은 읽는 중이다.
   * 「수정」을 누르기 전에는 커서가 들어가지 않는다.
   */
  if (!writing) {
    return (
      <div>
        <div className={styles.modeRow}>
          <NbButton variant="secondary" onClick={startWriting}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Pencil size={14} aria-hidden /> {ACTION.edit}
          </NbButton>
        </div>
        <RichText html={html} placeholder="아직 적은 내용이 없어요." />
        {dialog}
      </div>
    )
  }

  return (
    <div>
      {/*
        고치는 구간을 **끝내는 두 가지 길**. 확정은 오른쪽 끝, 취소는 그 왼쪽(§2-3-2 L-6).
        예전엔 「닫기」 하나였다 — 자동저장이니 닫아도 글은 남는다는 뜻이었지만,
        고치던 사람에게는 «저장을 안 했는데 나가도 되나»로 읽혔다(사용자 지시 2026-09-17).
      */}
      <div className={styles.modeRow}>
        <NbButton variant="ghost" onClick={() => void cancelWriting()} disabled={ending}
          title="「수정」을 누르기 전 내용으로 되돌립니다">
          {ACTION.cancel}
        </NbButton>
        <NbButton onClick={() => void saveAndClose()} disabled={ending}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Save size={14} aria-hidden /> {ending ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
      <DraftRestoreBanner show={draft.hasDraft} onRestore={draft.restore} onDiscard={draft.discard} />
      {error && <InlineError spaced onDismiss={() => setError(null)}>{error}</InlineError>}
      <TiptapEditor
        value={pushedHtml}
        onChange={onChange}
        placeholder="회의 중에 들리는 대로 적어 두세요. 5초마다 저절로 저장됩니다."
        minHeight={320}
      />
      {dialog}
    </div>
  )
}

