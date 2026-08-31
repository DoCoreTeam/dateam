'use client'

/**
 * 회의 작업대 — **쓰고 · 녹음하고 · 합쳐서 정리하는 일을 한 화면에서 끝낸다.**
 *
 * 사용자 지시(2026-08-24): *"회의노트를 쓸 수도 있어야 할 것 같고 화면 전환이 일어나면
 * 사용이 불편할 거 같으니 같은 플랫폼을 공유해서 여기서도 바로 작성할 수 있음 좋겠는데,
 * 그리고 더불어서 작성한 회의노트와 녹음된 회의 내용을 별도로 두고 전체적으로 정리"*.
 *
 * 그래서 층을 셋으로 나눠 탭으로 세운다 — 섞지 않고, 마지막에 합친다.
 *   작성      = 사람이 쓴 것 (meeting_notes.body_html)
 *   녹음·전사 = 기계가 받아적은 것 (meeting_transcript_segment)
 *   정리      = 둘을 함께 읽은 결과 (meeting_note_digest)
 *
 * **두 셸이 이 부품 하나를 그대로 쓴다** — `/meeting-notes/{id}` 와 `/crm/meetings/{id}`.
 * 가운데가 같아야 "같은 플랫폼을 공유"가 성립한다.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { NotebookPen, Mic, Sparkles, Check, Loader2, CircleAlert } from 'lucide-react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import ErrorState from '@/components/ui/ErrorState'
import { SkelCard } from '@/components/ui/LoadingSkeleton'
import MeetingMemoEditor, { type SaveState } from './MeetingMemoEditor'
import MeetingTranscriptView from './MeetingTranscriptView'
import MeetingDigestPanel from './MeetingDigestPanel'
import NoteVisibilitySwitch from './NoteVisibilitySwitch'
import RecordingPanel from './RecordingPanel'
import { formatKstTime } from '@/lib/datetime/kst'
import { hasBodyContent, pickDefaultWorkbenchTab } from '@/lib/meeting/workbench-tab'
import type { NoteVisibility } from '@/lib/meeting/note-visibility'
import type { TranscriptSegment } from '@/lib/meeting/transcript'
import styles from './workbench.module.css'

interface Props {
  noteId: string
  title: string
  /** 녹음 상주 바의 "회의로" 가 돌아올 주소 — 셸마다 다르다 */
  href: string
  /** 본문이 서버에 저장될 때마다 — CRM 은 여기서 조용히 스냅샷을 따라잡는다 */
  onBodySaved?: () => void
  /**
   * 공개 범위 스위치를 여기서 보여줄까. **기본은 보여 준다**(하위호환).
   *
   * 회의노트 화면(/meeting-notes)에는 하단에 손잡이 하나(CrmPublishCard)가 따로 있다 —
   * 거기서도 켜면 **같은 것을 정하는 자리가 두 곳**이 되고, 그게 이 사고의 원인이었다
   * (사용자 지적 2026-08-24). CRM 미팅 화면에는 그 카드가 없어 여기가 유일한 자리라 켠다.
   */
  showVisibility?: boolean
  /** 정리가 끝났을 때 — CRM 은 요약 스냅샷을 다시 가져온다 */
  onDigested?: () => void
}

/**
 * 본문·권한·공개범위는 **서버가 정한다.**
 * 호출하는 화면마다 prop 으로 넘기게 하면 한쪽이 빠뜨리고, 그 화면만 남의 노트를
 * 편집 가능한 것처럼 그린다. 부품이 직접 읽으면 두 셸이 같은 답을 본다.
 */
interface NoteState {
  bodyHtml: string
  canEdit: boolean
  visibility: NoteVisibility
  /** 사람이 쓴 본문이 있나 — 처음 열 탭을 정한다 */
  hasBody: boolean
  /** 기계가 받아적은 전사가 있나 — 같은 판정에 쓴다 */
  hasTranscript: boolean
}

const SAVE_ICON: Record<SaveState, ReactNode> = {
  clean: null,
  dirty: null,
  saving: <Loader2 size={13} aria-hidden />,
  saved: <Check size={13} aria-hidden />,
  error: <CircleAlert size={13} aria-hidden />,
}

function saveLabel(state: SaveState, at: number | null): string {
  if (state === 'saving') return '저장 중…'
  if (state === 'error') return '저장 실패 — 다시 시도할게요'
  if (state === 'saved' && at) return `저장됨 ${formatKstTime(new Date(at).toISOString())}`
  if (state === 'dirty') return '곧 저장돼요'
  return ''
}

export default function MeetingWorkbench({
  noteId, title, href, onBodySaved, onDigested, showVisibility = true,
}: Props) {
  const router = useRouter()
  const [note, setNote] = useState<NoteState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [saveState, setSaveState] = useState<SaveState>('clean')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [memoChars, setMemoChars] = useState(0)

  /** 전사가 새로 생기면 올린다 — 전사 탭이 다시 읽는다 */
  const [transcriptKey, setTranscriptKey] = useState(0)
  const [segCount, setSegCount] = useState<number | null>(null)
  const [digested, setDigested] = useState(false)
  /** 정리의 근거를 누르면 전사 탭으로 옮겨 그 줄을 비춘다 */
  const [highlight, setHighlight] = useState<string[]>([])

  const onSaveState = useCallback((s: SaveState, at: number | null) => {
    setSaveState(s)
    setSavedAt(at)
    if (s === 'saved') onBodySaved?.()
  }, [onBodySaved])

  const onTranscribed = useCallback(() => setTranscriptKey((n) => n + 1), [])
  const onSegments = useCallback((segs: TranscriptSegment[]) => setSegCount(segs.length), [])

  /**
   * 근거를 누르면 전사 탭으로 간다.
   * 탭 상태는 URL 이 쥔다(§2-6 "URL이 진실") — 로컬 state 로 옮기면 새로고침에서
   * 원래 탭으로 돌아가 근거가 사라진다.
   */
  const onEvidence = useCallback((ids: string[]) => {
    setHighlight(ids)
    const url = new URL(window.location.href)
    url.searchParams.set('wb', 'transcript')
    /**
     * `history.pushState` + `popstate` 로는 탭이 안 넘어간다 — 주소만 바뀌고 화면은 그대로다
     * (실측 v0.7.593). Next 의 `useSearchParams` 는 자체 라우터 상태를 보므로
     * 라우터를 거쳐야 `SegmentedTabs` 가 새 값을 읽는다.
     */
    router.replace(`${url.pathname}${url.search}`, { scroll: false })
    if (ids[0]) {
      window.setTimeout(
        () => document.getElementById(`seg-${ids[0]}`)?.scrollIntoView({ block: 'center' }),
        150,
      )
    }
  }, [router])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}`)
      const body = await res.json()
      if (!res.ok) { setLoadError(body?.error ?? '회의 기록을 불러오지 못했습니다.'); return }
      setNote({
        bodyHtml: body.bodyHtml ?? '',
        canEdit: Boolean(body.canEdit),
        visibility: body.visibility === 'crm' ? 'crm' : 'private',
        // plain 으로 잰다 — Tiptap 은 빈 본문에도 <p></p> 를 남긴다(workbench-tab.ts 주석)
        hasBody: hasBodyContent(body.bodyPlain),
        hasTranscript: Boolean(body.hasTranscript),
      })
    } catch {
      setLoadError('회의 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [noteId])

  useEffect(() => { void load() }, [load])

  const label = saveLabel(saveState, savedAt)

  if (loadError) {
    return (
      <section className="card" style={{ padding: 'var(--space-5)' }}>
        <ErrorState message={loadError} onRetry={() => void load()} />
      </section>
    )
  }
  if (!note) {
    return (
      <section className="card" style={{ padding: 'var(--space-5)' }}>
        <SkelCard />
      </section>
    )
  }
  const canEdit = note.canEdit

  return (
    <section className="card" style={{ padding: 'var(--space-5)' }}>
      <div className={styles.headRow}>
        <h2 className="tape-title" style={{ margin: 0 }}>회의 기록</h2>
        <div className={styles.headRight}>
          {canEdit && showVisibility && <NoteVisibilitySwitch noteId={noteId} initial={note.visibility} />}
          {label && (
            <span className={styles.saveState} data-state={saveState} role="status">
              {SAVE_ICON[saveState]} {label}
            </span>
          )}
        </div>
      </div>

      {/* 녹음은 탭 위에 둔다 — 회의 중에 여는 화면이고 그때 필요한 건 녹음 버튼뿐이다 */}
      <div className={styles.recordRow}>
        {/**
          * 녹음은 **주인만.** 남의 회의노트에서도 버튼이 눌리던 것을 막는다(실측 v0.7.593).
          * 서버가 어차피 막지만, 회의를 다 녹음한 뒤 저장이 실패하면 그 회의는 통째로 사라진다 —
          * 못 하는 일은 **누르기 전에** 안 보여야 한다.
          */}
        {canEdit && (
          <RecordingPanel noteId={noteId} title={title} href={href} onTranscribed={onTranscribed} />
        )}
      </div>

      <SegmentedTabs
        ariaLabel="회의 기록 보기"
        param="wb"
        /**
         * 주소에 `?wb=` 가 없으면 **내용이 있는 층**을 연다.
         * 판정은 SSOT 가 한다 — 여기서 조건식을 쓰면 실브라우저 말고는 검증할 수단이 없다(E-6).
         */
        defaultId={pickDefaultWorkbenchTab({ hasBody: note.hasBody, hasTranscript: note.hasTranscript })}
        tabs={[
          {
            id: 'memo',
            label: '작성',
            sub: memoChars > 0 ? `${memoChars.toLocaleString()}자` : undefined,
            icon: <NotebookPen size={15} />,
            content: (
              <MeetingMemoEditor
                noteId={noteId}
                initialHtml={note.bodyHtml}
                canEdit={canEdit}
                onStateChange={onSaveState}
                onLengthChange={setMemoChars}
              />
            ),
          },
          {
            id: 'transcript',
            label: '녹음·전사',
            sub: segCount !== null && segCount > 0 ? `${segCount.toLocaleString()}줄` : undefined,
            icon: <Mic size={15} />,
            content: (
              <MeetingTranscriptView
                noteId={noteId}
                canEdit={canEdit}
                reloadKey={transcriptKey}
                highlightIds={highlight}
                onLoaded={onSegments}
              />
            ),
          },
          {
            id: 'digest',
            label: '정리',
            sub: digested ? '방금' : undefined,
            icon: <Sparkles size={15} />,
            content: (
              <MeetingDigestPanel
                noteId={noteId}
                canEdit={canEdit}
                onEvidence={onEvidence}
                onDigested={() => { setDigested(true); onDigested?.() }}
              />
            ),
          },
        ]}
      />
    </section>
  )
}
