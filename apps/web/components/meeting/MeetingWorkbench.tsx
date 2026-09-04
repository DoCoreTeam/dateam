'use client'

/**
 * 회의 작업대 — **쓰고 · 녹음하고 · 합쳐서 정리하는 일을 한 화면에서 끝낸다.**
 *
 * 사용자 지시(2026-08-24): *"회의노트를 쓸 수도 있어야 할 것 같고 화면 전환이 일어나면
 * 사용이 불편할 거 같으니 같은 플랫폼을 공유해서 여기서도 바로 작성할 수 있음 좋겠는데,
 * 그리고 더불어서 작성한 회의노트와 녹음된 회의 내용을 별도로 두고 전체적으로 정리"*.
 *
 * ## 층위 (2026-09-05 재구성)
 *
 * 사용자 지적: *"결국 우리가 봐야되는건 정리된 내용일텐데 … 정리가 가장 먼저 보여야 하는거
 * 아냐? 그리고 그러다 보니깐 이런식으로 동일 레벨의 탭으로 있는게 이상한데"*.
 *
 *   정리      = 그 둘을 읽어서 만든 것 (meeting_note_digest)  → **카드 본문 · 항상 보임**
 *   ─ 근거 ────────────────────────────────────────────────  → 접기
 *      작성      = 사람이 쓴 것 (meeting_notes.body_html)      ┐ 진짜 형제 —
 *      녹음·전사 = 기계가 받아적은 것 (transcript_segment)     ┘ 여기만 탭이다
 *
 * 왜 탭에서 뺐는지는 `lib/meeting/workbench-tab.ts` 머리글에 있다(짧게: 자식을 형제 자리에
 * 세우면 기본 탭을 못 정하고, 상태를 표시할 자리가 없고, 만드는 버튼이 탭 안에 갇힌다 —
 * 셋 다 실제로 깨져 있었다). **새 내비게이션 장치를 만들지 않는다** — 탭은 그대로 두고 둘로 줄였다.
 *
 * **두 셸이 이 부품 하나를 그대로 쓴다** — `/meeting-notes/{id}` 와 `/crm/meetings/{id}`.
 * 가운데가 같아야 "같은 플랫폼을 공유"가 성립한다.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { NotebookPen, Mic, ChevronRight, Check, Loader2, CircleAlert } from 'lucide-react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import ErrorState from '@/components/ui/ErrorState'
import { SkelCard } from '@/components/ui/LoadingSkeleton'
import MeetingMemoEditor, { type SaveState } from './MeetingMemoEditor'
import MeetingTranscriptView from './MeetingTranscriptView'
import MeetingDigestPanel from './MeetingDigestPanel'
import NoteVisibilitySwitch from './NoteVisibilitySwitch'
import RecordingPanel from './RecordingPanel'
import { formatKstTime } from '@/lib/datetime/kst'
import {
  hasBodyContent, pickEvidenceTab, evidenceOpenByDefault, isEvidenceTab,
} from '@/lib/meeting/workbench-tab'
import { hasDigestContent } from '@/lib/meeting/legacy-digest'
import { plainTextLength } from '@/lib/meeting/memo-mode'
import { isRecordingPinned } from '@/lib/meeting/recording-placement'
import { EVIDENCE_LABEL, MEMO_LABEL, TRANSCRIPT_LABEL, digestMaterialLine } from '@/lib/terms'
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
  /** 사람이 쓴 본문이 있나 — 근거를 펼쳤을 때 어느 쪽을 열지 정한다 */
  hasBody: boolean
  /** 기계가 받아적은 전사가 있나 — 같은 판정에 쓴다 */
  hasTranscript: boolean
  /** 읽을 정리가 있나 — 근거를 **접은 채로 열지** 정한다 */
  hasDigest: boolean
  /**
   * 이 회의가 끝났나(`draft`·`final`·`archived`) — **녹음 버튼 자리**를 정한다.
   * 판정은 `recording-placement.ts` 가 한다. 여기서 문자열을 비교하면 검증 수단이 없다(E-6).
   */
  status: string
  /**
   * 재료의 크기 — **서버가 잰 값.**
   *
   * 예전엔 탭이 떠 있어야 채워지는 값(`memoChars`·`segCount`)만 있었다. 그런데 이제
   * 근거는 접혀 있는 것이 기본이라 그 값들은 **대개 0 이다.** 0 인 채로 정리 패널에 넘기면
   * 진행 문구가 「회의 내용을 읽고 있어요」로 주저앉고(v0.7.686 과 같은 결함), 근거 줄도
   * 무엇이 들었는지 못 밝힌다. 그래서 열려 있든 접혀 있든 답할 수 있는 서버 값을 함께 쥔다.
   */
  bodyChars: number
  transcriptSegments: number
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
  /**
   * 편집기가 세는 글자 수. **`null` 은 「아직 안 세어 봤다」**이지 0 자가 아니다 —
   * 근거가 접혀 있으면 편집기가 없어 영원히 `null` 이고, 그때는 서버 값을 쓴다.
   * 0 으로 초기화하면 「0자」와 「모름」이 같은 값이 되어 구분할 수 없다.
   */
  const [memoChars, setMemoChars] = useState<number | null>(null)

  /** 전사가 새로 생기면 올린다 — 전사 탭이 다시 읽는다 */
  const [transcriptKey, setTranscriptKey] = useState(0)
  const [segCount, setSegCount] = useState<number | null>(null)
  /** 근거를 펼쳤나. `null` 은 아직 노트를 못 읽어 정할 수 없는 상태다 */
  const [evidenceOpen, setEvidenceOpen] = useState<boolean | null>(null)
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
   * 근거를 누르면 **근거를 펼치고** 전사 탭으로 간다.
   *
   * 펼치는 것이 먼저다 — 접힌 상태에서는 전사 목록이 아예 안 그려져 있어(아래 `evidenceOpen &&`)
   * 탭만 바꾸면 스크롤할 대상이 없다.
   *
   * 탭 상태는 URL 이 쥔다(§2-6 "URL이 진실") — 로컬 state 로 옮기면 새로고침에서
   * 원래 탭으로 돌아가 근거가 사라진다.
   */
  const onEvidence = useCallback((ids: string[]) => {
    setHighlight(ids)
    setEvidenceOpen(true)
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
      const material = {
        // plain 으로 잰다 — Tiptap 은 빈 본문에도 <p></p> 를 남긴다(workbench-tab.ts 주석)
        hasBody: hasBodyContent(body.bodyPlain),
        hasTranscript: Boolean(body.hasTranscript),
        hasDigest: hasDigestContent(body.summary, body.decisions),
      }
      setNote({
        bodyHtml: body.bodyHtml ?? '',
        canEdit: Boolean(body.canEdit),
        visibility: body.visibility === 'crm' ? 'crm' : 'private',
        ...material,
        /*
          편집기와 **같은 함수로** 센다. 서버의 `bodyPlain` 은 `htmlToPlain` 이 만든 값이라
          줄바꿈·글머리표가 더 붙어 30자쯤 더 세어졌다 — 접힘 「218자」가 펼치면 「188자」로
          튀어 사용자가 어느 쪽을 믿을지 모르게 됐다(실측). 세는 법이 하나여야 안 튄다.
        */
        bodyChars: plainTextLength(String(body.bodyHtml ?? '')),
        transcriptSegments: Number(body.transcriptSegments ?? 0),
        status: typeof body.status === 'string' ? body.status : '',
      })
      /*
        접힌 채로 열까 펼친 채로 열까 — **한 번만 정한다.**
        사용자가 손으로 접었는데 다시 불러오면서 되펴 버리면 그건 화면이 사용자를 이긴 것이다.

        주소에 `?wb=memo|transcript` 가 붙어 있으면 그 자체가 「근거를 보러 왔다」는 뜻이라
        기본값을 이긴다(진입 링크 `MeetingIntakeBox` 가 그 둘만 쓴다). 없어진 `?wb=digest`
        같은 옛 주소는 여기서 조용히 걸러진다 — 정리는 어차피 늘 보이므로 접은 채로 열면 된다.
      */
      const wb = new URL(window.location.href).searchParams.get('wb')
      setEvidenceOpen((cur) => cur ?? (isEvidenceTab(wb) || evidenceOpenByDefault(material)))
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
  /* 편집기가 세고 있으면 그 값이 맞다(방금 지운 글자까지 반영). 없으면 서버가 잰 값 */
  const shownMemoChars = memoChars ?? note.bodyChars
  const shownSegCount = segCount ?? note.transcriptSegments
  const materialLine = digestMaterialLine(shownMemoChars, shownSegCount)
  /* 녹음을 결과물 위에 세울지 — 판정은 SSOT 가 한다(E-6) */
  const recordingPinned = isRecordingPinned(note.status)

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

      {/*
        녹음은 **작성 중인 회의에서만** 맨 위에 둔다(v0.7.689).

        회의가 시작되는 순간 노트를 열고 바로 누르는 흐름이라 그때는 맨 위가 맞다.
        그런데 확정된 회의를 다시 읽으러 온 사람에게도 가장 큰 버튼이 「녹음 시작」이었다
        (사용자 지적: *"이미 작성 완료 된거에 녹음시작이 떡하니 있는게 이상하지 않나?"*).
        끝난 회의에서는 녹음도 **재료**이므로 아래 근거 접기 안으로 내려간다(§2-3-6 P-3).

        녹음은 **주인만.** 남의 회의노트에서도 버튼이 눌리던 것을 막는다(실측 v0.7.593).
        못 하는 일은 **누르기 전에** 안 보여야 한다.
      */}
      {canEdit && recordingPinned && (
        <div className={styles.recordRow}>
          <RecordingPanel noteId={noteId} title={title} href={href} onTranscribed={onTranscribed} />
        </div>
      )}

      {/*
        정리 — **이 화면에 온 이유.** 탭 뒤에 두지 않는다.
        재료 크기는 서버 값으로도 답할 수 있게 넘긴다(근거가 접혀 있어도 진행 문구가 정확하도록).
      */}
      <MeetingDigestPanel
        noteId={noteId}
        canEdit={canEdit}
        memoChars={shownMemoChars}
        segmentCount={shownSegCount}
        onEvidence={onEvidence}
        onDigested={() => { onDigested?.() }}
      />

      {/*
        근거 — 접기. 「그 말이 어디서 나왔나」를 확인하는 자리다.
        `<details>` 를 쓰는 이유: 열고 닫는 키보드·스크린리더 규약이 브라우저에 이미 있다.
        자작 토글은 그것을 다시 만들어야 하고, 대개 빠뜨린다.
      */}
      <details
        className={styles.evidence}
        open={evidenceOpen ?? false}
        onToggle={(e) => setEvidenceOpen(e.currentTarget.open)}
      >
        <summary className={styles.evidenceHead}>
          <ChevronRight size={15} className={styles.evidenceChevron} aria-hidden />
          <span className={styles.evidenceLabel}>{EVIDENCE_LABEL}</span>
          {/* 무엇이 들어 있는지 — 펼치기 전에 밝힌다. 재료가 없으면 부를 문장도 없다 */}
          {materialLine && <span className={styles.evidenceSub}>{materialLine}</span>}
        </summary>

        {/*
          접혀 있으면 **그리지 않는다.** `<details>` 는 닫아도 자식을 DOM 에 두므로,
          그냥 두면 열지도 않은 전사를 매번 내려받고 편집기가 0 크기로 뜬다.
        */}
        {evidenceOpen && (
          <div className={styles.evidenceBody}>
            {/*
              끝난 회의의 녹음은 여기 있다 — 재료끼리도 순서가 있어서, 「무엇으로 남기나」가
              「무엇이 남았나」보다 먼저다. 탭 아래로 내리면 스크롤 끝에 묻힌다.
            */}
            {canEdit && !recordingPinned && (
              <div className={styles.recordRow}>
                <RecordingPanel noteId={noteId} title={title} href={href} onTranscribed={onTranscribed} />
              </div>
            )}
            <SegmentedTabs
              ariaLabel={`${EVIDENCE_LABEL} 보기`}
              param="wb"
              /**
               * 주소에 `?wb=` 가 없으면 **내용이 있는 층**을 연다.
               * 판정은 SSOT 가 한다 — 여기서 조건식을 쓰면 실브라우저 말고는 검증할 수단이 없다(E-6).
               */
              defaultId={pickEvidenceTab({ hasBody: note.hasBody, hasTranscript: note.hasTranscript })}
              tabs={[
                {
                  id: 'memo',
                  label: MEMO_LABEL,
                  sub: shownMemoChars > 0 ? `${shownMemoChars.toLocaleString()}자` : undefined,
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
                  label: TRANSCRIPT_LABEL,
                  sub: shownSegCount > 0 ? `${shownSegCount.toLocaleString()}줄` : undefined,
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
              ]}
            />
          </div>
        )}
      </details>
    </section>
  )
}
