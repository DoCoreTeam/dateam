'use client'

/**
 * 받아적은 것 — **이 화면이 없어서 전사를 아무도 못 봤다.**
 *
 * 마이그 217 부터 전사는 DB 에 쌓이고 있었는데 `(member)/meeting-notes/` 전체에
 * 문자열 `transcript` 가 0건이었다(v0.7.588 실측). 녹음이 끝나도 결과를 볼 자리가 없었고,
 * CRM 쪽에서만 — 그것도 발행하거나 붙여넣어야 — 보였다.
 *
 * 여기서 하는 일 셋.
 *   ① 시간순으로 보여 준다 (구간 경계는 표시만, 시간축은 하나다)
 *   ② **화자 이름을 고친다** — "화자1" 로 남은 전사는 나중에 아무도 못 읽는다
 *   ③ 녹음이 없을 때 **붙여넣는다** — 원본(회의노트)에 먼저 들어간다
 */

import { useCallback, useEffect, useState } from 'react'
import { ClipboardPaste, UserPen, Check, X, FileDown } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import InlineError from '@/components/ui/InlineError'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import { isEnterKey } from '@/lib/ui/ime'
import { formatSegmentTime, type TranscriptSegment } from '@/lib/meeting/transcript'
import { ACTION } from '@/lib/terms'
import MeetingExportModal from '@/app/(member)/meeting-notes/MeetingExportModal'
import styles from './workbench.module.css'

interface Props {
  noteId: string
  canEdit: boolean
  /** 이 값이 바뀌면 다시 읽는다 — 전사가 끝났을 때 녹음 패널이 올린다 */
  reloadKey?: number
  /** 정리 결과의 근거를 눌렀을 때 비추는 줄 */
  highlightIds?: string[]
  onLoaded?: (segments: TranscriptSegment[]) => void
}

export default function MeetingTranscriptView({
  noteId, canEdit, reloadKey = 0, highlightIds = [], onLoaded,
}: Props) {
  /**
   * 상자를 벗어나 전부 펼칠지.
   *
   * 왜 상자에 담나(사용자 지적): *"녹음 전사 쪽은 무한 아래로 내려가기 해야 하더라?"*
   * 406줄을 통째로 그리면 페이지가 그만큼 길어져 **아래 있는 것에 영원히 못 닿는다.**
   * 줄을 지우지는 않는다 — 정리의 「근거」가 `scrollIntoView` 로 이 줄들을 찾아가므로
   * DOM 에서 빼면 그 기능이 죽는다. 그래서 «높이만» 가둔다.
   */
  const [exporting, setExporting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null)
  const [speakers, setSpeakers] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/transcript`)
      const body = await res.json()
      if (!res.ok) { setLoadError(body?.error ?? '전사를 불러오지 못했습니다.'); return }
      setSegments(body.segments ?? [])
      setSpeakers(body.speakers ?? [])
      onLoaded?.(body.segments ?? [])
    } catch {
      setLoadError('전사를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [noteId, onLoaded])

  useEffect(() => { void load() }, [load, reloadKey])

  async function savePasted() {
    if (!text.trim()) { setError('회의 내용을 붙여넣어 주세요.'); return }
    setBusy('paste'); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/transcript`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? '회의 내용을 넣지 못했습니다.'); return }
      setNotice(`${body.segmentCount}줄을 넣었어요.`)
      setText('')
      setPasting(false)
      await load()
    } catch {
      setError('회의 내용을 넣지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(null) }
  }

  async function renameSpeaker(from: string) {
    const to = newName.trim()
    if (!to) { setError('새 이름을 입력해 주세요.'); return }
    setBusy(`rename:${from}`); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/transcript`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? '이름을 바꾸지 못했습니다.'); return }
      setNotice(`${body.changed}줄의 이름을 바꿨어요.`)
      setRenaming(null); setNewName('')
      await load()
    } catch {
      setError('이름을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(null) }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />
  if (segments === null) return <SkelList rows={5} />

  const pasteBox = (
    <div className={styles.pasteBox}>
      <p className={styles.hint}>
        <code>이름: 말</code> 형태면 누가 한 말인지 알아봅니다.
      </p>
      <textarea
        className="input-field"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'김대표: 예산은 3억으로 품의 올렸습니다.\n윤수석: 보안 검토가 남아서 다음 달은 어려울 것 같아요.'}
        aria-label="회의 내용"
      />
      <div className={styles.rowActions}>
        <NbButton variant="ghost" onClick={() => { setPasting(false); setError(null) }} disabled={busy !== null}>
          뒤로
        </NbButton>
        <NbButton onClick={() => void savePasted()} disabled={busy !== null}>
          {busy === 'paste' ? '넣는 중…' : '넣기'}
        </NbButton>
      </div>
    </div>
  )

  return (
    <div className={styles.stack}>
      {error && <InlineError spaced onDismiss={() => setError(null)}>{error}</InlineError>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {segments.length === 0 ? (
        pasting && canEdit ? pasteBox : (
          <EmptyState
            title="아직 받아적은 내용이 없어요"
            description={canEdit
              ? '녹음을 시작하면 10분마다 자동으로 글로 옮겨 드려요. 다른 도구로 받아적은 내용이 있으면 붙여넣어도 됩니다.'
              : '녹음이나 붙여넣기가 아직 없습니다.'}
            icon={<ClipboardPaste size={28} />}
            action={canEdit ? { label: '회의 내용 붙여넣기', onClick: () => setPasting(true) } : undefined}
          />
        )
      ) : (
        <>
          {canEdit && speakers.length > 0 && (
            <div className={styles.speakerBar}>
              <span className={styles.speakerLabel}><UserPen size={13} aria-hidden /> 화자</span>
              {speakers.map((sp) => (
                <span key={sp} className={styles.speakerChip}>
                  {renaming === sp ? (
                    <>
                      <input
                        className="input-field"
                        value={newName}
                        autoFocus
                        aria-label={`${sp}의 새 이름`}
                        placeholder="예: 김대표"
                        onChange={(e) => setNewName(e.target.value)}
                        // 한글 조합 확정 Enter를 행동으로 받지 않는다 — 받으면 이름이 두 번 바뀐다(lib/ui/ime SSOT)
                        onKeyDown={(e) => { if (isEnterKey(e)) void renameSpeaker(sp) }}
                      />
                      <button type="button" aria-label="이름 바꾸기 확인"
                        className={styles.iconBtn}
                        onClick={() => void renameSpeaker(sp)} disabled={busy !== null}>
                        <Check size={14} />
                      </button>
                      <button type="button" aria-label="이름 바꾸기 취소"
                        className={styles.iconBtn}
                        onClick={() => { setRenaming(null); setNewName('') }}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <button type="button" className={styles.speakerName}
                      onClick={() => { setRenaming(sp); setNewName(sp) }}>
                      {sp}
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <ol className={`${styles.transcript}${expanded ? '' : ` ${styles.transcriptBox}`}`}>
            {segments.map((s) => (
              <li
                key={s.id}
                id={`seg-${s.id}`}
                className={`${styles.segment}${highlightIds.includes(s.id) ? ` ${styles.segmentOn}` : ''}`}
              >
                <span className={styles.segTime}>{formatSegmentTime(s.startMs)}</span>
                <span className={styles.segSpeaker}>{s.speaker}</span>
                <span className={styles.segText}>{s.text}</span>
              </li>
            ))}
          </ol>

          {/* 몇 줄인지 · 펼칠지 · 내보낼지 — 상자 바로 아래에서 한 줄로 */}
          <div className={styles.transcriptFoot}>
            <span className={styles.transcriptCount}>
              {expanded
                ? `${segments.length.toLocaleString()}줄 전체`
                : `${segments.length.toLocaleString()}줄 — 상자 안에서 넘겨 보세요`}
            </span>
            <span className={styles.transcriptTools}>
              {segments.length > 0 && (
                <NbButton variant="ghost" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? '상자로 접기' : '전체 보기'}
                </NbButton>
              )}
              {segments.length > 0 && (
                <NbButton variant="ghost" onClick={() => setExporting(true)}>
                  <FileDown size={15} /> {ACTION.export}
                </NbButton>
              )}
            </span>
          </div>

          {canEdit && (
            pasting ? pasteBox : (
              <NbButton variant="ghost" onClick={() => setPasting(true)}>
                <ClipboardPaste size={15} /> 회의 내용 더 붙여넣기
              </NbButton>
            )
          )}
        </>
      )}

      {/* 받아적은 내용을 문서로. 같은 미리보기 부품을 쓴다 — 두 벌이면 «본 것과 받는 것»이 어긋난다 */}
      {exporting && (
        <MeetingExportModal meetingNoteId={noteId} view="transcript" onClose={() => setExporting(false)} />
      )}
    </div>
  )
}
