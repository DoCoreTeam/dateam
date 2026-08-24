'use client'

/**
 * 회의 메모 편집기 — **저장 버튼이 없다.**
 *
 * 계약은 미팅 캡처 화면의 것을 그대로 따른다: *"내용을 넣기 시작하는 순간이 저장이다."*
 * 회의 중에 치는 글에 "저장을 누르세요"를 요구하면, 누르지 않은 채 탭이 죽는 날이 온다.
 * (기존 `MeetingEditor` 는 명시 저장이다 — 그건 회의가 끝난 뒤 차분히 정리하는 자리라 남긴다.)
 *
 * 세 겹으로 지킨다.
 *   ① 5초 debounce 서버 저장
 *   ② 로컬 임시저장(`useDraftPersist`) — 서버가 실패해도 글은 브라우저에 남는다
 *   ③ 화면을 떠날 때 마지막 한 번 밀어 넣는다(flush)
 *
 * **읽기 전용은 비활성 편집기가 아니라 읽기 컴포넌트다.** 못 쓰는 입력칸을 보여 주면
 * 사람은 고칠 수 있다고 믿고 쳤다가 잃는다(마이그 216: 읽기 공개이지 편집 공개가 아니다).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import TiptapEditor from '@/components/ui/TiptapEditor'
import RichText from '@/components/ui/RichText'
import InlineError from '@/components/ui/InlineError'
import DraftRestoreBanner from '@/components/ui/DraftRestoreBanner'
import { useDraftPersist } from '@/lib/forms/useDraftPersist'
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

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 마지막으로 서버가 받은 값 — 같으면 안 보낸다(빈 요청이 5초마다 나가는 것을 막는다) */
  const savedHtml = useRef(initialHtml)
  const latest = useRef(initialHtml)

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
  useEffect(() => { onLengthChange?.(plainLength(html)) }, [html, onLengthChange])

  /** `useDraftPersist` 는 매 렌더 새 객체를 준다 — 그대로 의존하면 콜백 신원이 계속 바뀐다 */
  const clearDraft = useRef(draft.clear)
  clearDraft.current = draft.clear

  const push = useCallback(async () => {
    const value = latest.current
    if (value === savedHtml.current) { setState('clean'); return }
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
        return
      }
      savedHtml.current = value
      setSavedAt(Date.now())
      setState('saved')
      setError(null)
      // 서버가 받았으니 로컬 사본은 지운다 — 남겨 두면 다음 방문에 복원 배너가 헛되이 뜬다
      clearDraft.current()
    } catch {
      setError('저장하지 못했어요. 연결을 확인해 주세요. 쓰던 글은 이 브라우저에 남아 있습니다.')
      setState('error')
    }
  }, [noteId])

  const onChange = useCallback((next: string) => {
    setHtml(next)
    latest.current = next
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void push() }, SAVE_DEBOUNCE_MS)
  }, [push])

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

  return (
    <div>
      <DraftRestoreBanner show={draft.hasDraft} onRestore={draft.restore} onDiscard={draft.discard} />
      {error && <InlineError spaced onDismiss={() => setError(null)}>{error}</InlineError>}
      <TiptapEditor
        value={pushedHtml}
        onChange={onChange}
        placeholder="회의 중에 들리는 대로 적어 두세요. 5초마다 저절로 저장됩니다."
        minHeight={320}
      />
    </div>
  )
}

/** 태그를 뺀 글자 수 — 탭 배지가 "1,240자"를 말할 수 있게. 서버 파생값(body_plain)과 목적이 다르다 */
function plainLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length
}
