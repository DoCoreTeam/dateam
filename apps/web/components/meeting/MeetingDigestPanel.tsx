'use client'

/**
 * 전체 정리 — **메모와 녹음을 합치되, 어디서 나온 사실인지 밝힌다.**
 *
 * 사용자 지시: *"작성한 회의노트와 녹음된 회의 내용을 별도로 두고 전체적으로 정리"*.
 * 합쳐 놓고 출처를 못 대면 그건 그냥 섞은 것이다 — 그래서 사실마다 뱃지가 붙는다.
 *
 * 어긋난 대목은 **어느 쪽도 버리지 않고** 나란히 보여 준다.
 * 메모는 사람의 해석이고 전사는 발화 그대로다. 둘이 다르면 사람이 고른다.
 *
 * 타이밍 계약(D7): 전사는 자동, **정리는 버튼**. 여기가 그 버튼이다.
 */

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, History, TriangleAlert } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import InlineError from '@/components/ui/InlineError'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { FACT_ORIGIN_LABEL, type FactOrigin } from '@/lib/meeting/digest-prompt'
import type { DigestResult, DigestSources } from '@/lib/meeting/digest'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import styles from './digest.module.css'

interface Version {
  seq: number
  createdAt: string
  model: string | null
  sources: DigestSources | null
  digest: DigestResult
}

interface Props {
  noteId: string
  canEdit: boolean
  /** 근거를 누르면 전사 탭의 그 대목으로 — 상위가 탭 전환과 하이라이트를 맡는다 */
  onEvidence?: (segmentIds: string[]) => void
  /** 정리가 끝나면 알린다 — 헤더 배지가 "정리 8/24 15:02"로 바뀐다 */
  onDigested?: (at: string) => void
}

function OriginBadge({ origin }: { origin: FactOrigin }) {
  return <span className={`${styles.origin} ${styles[origin]}`}>{FACT_ORIGIN_LABEL[origin]}</span>
}

export default function MeetingDigestPanel({ noteId, canEdit, onEvidence, onDigested }: Props) {
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [showing, setShowing] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/digest`)
      const body = await res.json()
      setVersions(res.ok ? (body.versions ?? []) : [])
    } catch {
      setVersions([])
    }
  }, [noteId])

  useEffect(() => { void load() }, [load])

  async function run() {
    setRunning(true); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/meeting-notes/${noteId}/digest`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error ?? '정리하지 못했습니다.'); return }

      const empty = (body.digest?.agenda ?? []).length === 0
      setNotice(
        empty
          ? '확실한 내용을 못 찾았어요. 메모가 짧거나 대화가 분명하지 않으면 비워 둡니다.'
          : [
              body.legacy ? '녹음 없이 메모만으로 정리했어요.' : '메모와 녹음을 함께 읽었어요.',
              body.notice,
            ].filter(Boolean).join(' '),
      )
      setShowing(null)
      onDigested?.(new Date().toISOString())
      await load()
    } catch {
      setError('정리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally { setRunning(false) }
  }

  if (versions === null) return <AXDotLoader />

  const latest = versions[0] ?? null
  const current = showing === null ? latest : (versions.find((v) => v.seq === showing) ?? latest)

  const runButton = canEdit ? (
    <NbButton onClick={() => void run()} disabled={running}>
      <Sparkles size={16} /> {running ? 'AI가 읽는 중…' : latest ? '다시 정리하기' : '전체 정리하기'}
    </NbButton>
  ) : null

  return (
    <div className={styles.stack}>
      {error && <InlineError spaced onDismiss={() => setError(null)}>{error}</InlineError>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {!latest ? (
        <EmptyState
          title="아직 정리하지 않았어요"
          description={canEdit
            ? '누르면 메모와 받아적은 내용을 함께 읽어 안건별로 정리해 드려요. 어디서 나온 사실인지도 함께 표시됩니다.'
            : '작성한 사람이 정리를 실행하면 여기에 나타납니다.'}
          icon={<Sparkles size={28} />}
          action={canEdit ? { label: '전체 정리하기', onClick: () => void run() } : undefined}
        />
      ) : (
        <>
          <div className={styles.head}>
            <div className={styles.meta}>
              <span className={styles.stamp}>{formatKstDateTimeShort(current!.createdAt)} 정리</span>
              {current!.sources && (
                <span className={styles.sources}>
                  메모 {current!.sources.memoChars.toLocaleString()}자
                  {current!.sources.transcriptSegments > 0 && ` · 녹음 ${current!.sources.transcriptSegments.toLocaleString()}줄`}
                  {current!.sources.mode === 'map-reduce' && ` · 구간 ${current!.sources.partIdxs.length}개로 나눠 읽음`}
                </span>
              )}
            </div>
            {runButton}
          </div>

          {/* 어긋난 대목 — 어느 쪽도 버리지 않는다. 위에 둔다: 사람이 먼저 판단해야 아래가 읽힌다 */}
          {current!.digest.conflicts.length > 0 && (
            <section className={styles.conflicts} aria-labelledby="mw-conflict-h">
              <h3 id="mw-conflict-h" className={styles.conflictHead}>
                <TriangleAlert size={14} aria-hidden /> 메모와 녹음이 다르게 말한 곳 {current!.digest.conflicts.length}건
              </h3>
              <ul className={styles.conflictList}>
                {current!.digest.conflicts.map((c, i) => (
                  <li key={i} className={styles.conflictItem}>
                    <p className={styles.conflictLine}><OriginBadge origin="memo" /> {c.memo}</p>
                    <p className={styles.conflictLine}>
                      <OriginBadge origin="transcript" /> {c.transcript}
                      {c.segmentIds.length > 0 && onEvidence && (
                        <button type="button" className={styles.evidence} onClick={() => onEvidence(c.segmentIds)}>
                          그 대목 보기
                        </button>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {current!.digest.agenda.map((a, i) => (
            <section key={i} className={styles.agenda}>
              <h3 className={styles.agendaTitle}>{a.title}</h3>
              <ul className={styles.facts}>
                {a.facts.map((f, j) => (
                  <li key={j} className={styles.fact}>
                    <OriginBadge origin={f.origin} />
                    <span className={styles.factText}>{f.text}</span>
                    {f.segmentIds.length > 0 && onEvidence && (
                      <button type="button" className={styles.evidence} onClick={() => onEvidence(f.segmentIds)}>
                        근거
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {current!.digest.decisions.length > 0 && (
            <section className={styles.agenda}>
              <h3 className={styles.agendaTitle}>결정사항</h3>
              <ul className={styles.facts}>
                {current!.digest.decisions.map((d, i) => (
                  <li key={i} className={styles.fact}>
                    <OriginBadge origin={d.origin} />
                    <span className={styles.factText}>{d.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 이전 정리 보기 — 되돌릴 수 있으면 사람이 부담 없이 다시 돌린다 */}
          {versions.length > 1 && (
            <div className={styles.history}>
              <span className={styles.historyLabel}><History size={13} aria-hidden /> 이전 정리</span>
              {versions.map((v) => (
                <button
                  key={v.seq}
                  type="button"
                  className={`${styles.historyItem}${current!.seq === v.seq ? ` ${styles.historyOn}` : ''}`}
                  onClick={() => setShowing(v.seq)}
                >
                  {v.seq}차 · {formatKstDateTimeShort(v.createdAt)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
