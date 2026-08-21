'use client'

// 미팅 상세 (dacrm F2)
//
// 이 화면이 하는 일 셋.
//   ① 전사를 넣는다 — 붙여넣기가 주 경로다(녹음 업체는 아직 안 붙었다)
//   ② AI 가 5축을 뽑는다 — 누가 나왔나·무엇을 파나·어디까지 왔나·무엇이 걸림돌인가·다음에 뭘 하나
//   ③ **근거를 보여 준다** — 뽑아낸 것마다 전사 어느 대목에서 읽었는지
//
// ③이 제일 중요하다. 근거 없이 결론만 보여 주면 사람은 그걸 믿거나 전부 무시한다.
// 둘 다 나쁘다 — 믿으면 틀린 값이 사업 판단에 들어가고, 무시하면 기능이 없는 것과 같다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Mic } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import RecordLayout, { RecordPanel, RecordField, RecordFieldList } from '@/components/ui/crm/RecordLayout'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { describeSuggestionValue, TARGET_LABEL } from '@/lib/crm/format/suggestion'
import type { StatusKey } from '@/lib/tokens/status-colors'
import styles from './meeting-detail.module.css'

interface Segment { id: string; idx: number; speaker: string; text: string }
interface Recording { id: string; status: string; sttVendor: string | null; error: string | null }
interface Suggestion {
  id: string; axis: string; field: string | null; status: string; targetType: string
  proposedValueJson: unknown; confidence: number
  evidenceJson: { quote?: string; segmentIds?: string[] } | null
}
/** 원본 회의노트 상태 — 본문은 안 온다(공개 범위 때문에). 살아 있나·언제 바뀌었나·열어도 되나만 */
interface NoteMeta {
  id: string; exists: boolean; title: string | null
  updatedAt: string | null; visibility: 'private' | 'crm' | null
  canOpen: boolean; isStale: boolean
}
interface Meeting {
  id: string; title: string; startedAt: string; location: string | null
  companyId: string | null; dealId: string | null; summaryMd: string | null
  noteId: string | null; noteSyncedAt: string | null; note: NoteMeta | null
  recordings: Recording[]; segments: Segment[]; suggestions: Suggestion[]
}

/** 축을 사람 말로 — enum 을 그대로 보여 주면 무슨 뜻인지 모른다 */
const AXIS: Record<string, { label: string; status: StatusKey }> = {
  WHO: { label: '누가', status: 'doing' },
  WHAT: { label: '무엇을', status: 'planned' },
  WHERE: { label: '어디까지', status: 'note' },
  RISK: { label: '걸림돌', status: 'blocker' },
  NEXT: { label: '다음에', status: 'done' },
}

/** 어디에 붙는 제안인지 — 이게 없으면 "왜 금액이 여기 있지"가 된다 */
const WHERE_IT_GOES: Record<string, string> = { deal: '딜', person: '인물', company: '회사', meeting: '이 미팅' }

export default function MeetingDetail({ meetingId }: { meetingId: string }) {
  const [m, setM] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  /** 근거를 클릭하면 그 구간을 띄운다 — 결론만 보여 주지 않는다 */
  const [highlight, setHighlight] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/meetings/${meetingId}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '미팅을 불러오지 못했습니다.'); return }
      setM(body)
    } catch {
      setError('미팅을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [meetingId])

  useEffect(() => { void load() }, [load])

  async function saveTranscript() {
    if (!text.trim()) { setError('전사 내용을 붙여넣어 주세요.'); return }
    setBusy('transcript')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/meetings/${meetingId}/transcript`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '전사를 넣지 못했습니다.'); return }
      setNotice(`${body.segmentCount}줄을 넣었어요. 이제 AI로 정리할 수 있습니다.`)
      setText('')
      await load()
    } catch {
      setError('전사를 넣지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * 원본에서 다시 가져오기.
   *
   * 노트가 발행 뒤에 바뀌면 CRM 스냅샷은 옛것이 된다. 조용히 두면 사람은
   * 없어진 내용을 사실로 읽는다 — 그래서 배지로 알리고 여기서 따라잡는다.
   * 옛 미처리 제안은 서버가 거둔다(사람이 이미 판단한 것은 건드리지 않는다).
   */
  async function resync() {
    setBusy('resync')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/meetings/${meetingId}/resync`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '원본을 다시 가져오지 못했습니다.'); return }
      setNotice(
        `원본에서 다시 가져왔어요.${body.segmentCount ? ` 회의 내용 ${body.segmentCount}줄.` : ''}` +
        (body.expiredSuggestions > 0
          ? ` 옛 제안 ${body.expiredSuggestions}건은 거뒀습니다 — 지금은 "AI로 정리하기"를 다시 눌러 주세요.`
          : ''),
      )
      await load()
    } catch {
      setError('원본을 다시 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  async function extract() {
    setBusy('extract')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/meetings/${meetingId}/extract`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? 'AI가 정리하지 못했습니다.'); return }

      const a = body.axes ?? {}
      const total = Object.values(a).reduce((n: number, v) => n + Number(v), 0)
      setNotice(
        total === 0
          ? '전사에서 확실한 내용을 못 찾았어요. 대화가 짧거나 근거가 분명하지 않으면 비워 둡니다.'
          : `${body.suggested}건을 인박스로 보냈어요.` +
            (body.dropped > 0 ? ` (근거가 분명하지 않은 ${body.dropped}건은 뺐습니다)` : ''),
      )
      await load()
    } catch {
      setError('AI가 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  if (loading && !m) return <AXDotLoader />
  if (error && !m) return <ErrorState message={error} onRetry={() => void load()} />
  if (!m) return null

  const transcribed = m.recordings.some((r) => r.status === 'TRANSCRIBED')
  const failed = m.recordings.find((r) => r.status === 'FAILED')

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title={m.title}
        icon={<Mic size={20} />}
        description={formatKstDateTimeShort(m.startedAt) + (m.location ? ` · ${m.location}` : '')}
        back={{ href: '/crm/meetings', label: '미팅' }}
      />

      <FormErrorBanner message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}
      {failed?.error && (
        <p className={styles.failed}>전사에 실패했어요: {failed.error}</p>
      )}

      {/* 원본이 그 뒤 수정됐다 — 조용히 어긋나게 두지 않는다 */}
      {m.note?.isStale && (
        <p className={styles.notice}>
          원본 회의노트가 {formatKstDateTimeShort(m.note.updatedAt ?? '')}에 수정됐어요.{' '}
          <NbButton onClick={() => void resync()} disabled={busy === 'resync'}>
            {busy === 'resync' ? '가져오는 중…' : '다시 가져오기'}
          </NbButton>
        </p>
      )}

      {/* 원본이 사라졌다 — 스냅샷은 그대로 보이지만 사실을 말한다 */}
      {m.noteId && m.note && !m.note.exists && (
        <p className={styles.failed}>
          원본 회의노트가 삭제됐습니다. 아래 내용은 올릴 때 떠 둔 사본입니다.
        </p>
      )}

      <RecordLayout
        fields={
          <RecordPanel title="이 미팅은">
            <RecordFieldList>
              <RecordField label="회사">
                {m.companyId ? <Link href={`/crm/companies/${m.companyId}`}>회사 열기</Link> : null}
              </RecordField>
              <RecordField label="딜">
                {m.dealId ? <Link href={`/crm/deals/${m.dealId}`}>딜 열기</Link> : null}
              </RecordField>
              <RecordField label="전사">
                {transcribed ? `${m.segments.length}줄` : null}
              </RecordField>
              <RecordField label="회의노트">
                {/* 열어 볼 수 있을 때만 링크를 그린다 — '나만 보기'로 둔 원본은 열리지 않는다.
                    CRM 은 스냅샷을 갖고 있어 링크가 없어도 화면이 비지 않는다. */}
                {m.note?.exists && m.note.canOpen
                  ? <Link href={`/meeting-notes/${m.note.id}`}>{m.note.title || '원본 열기'}</Link>
                  : m.note?.exists
                    ? <span className={styles.conf}>비공개 원본</span>
                    : null}
              </RecordField>
            </RecordFieldList>
          </RecordPanel>
        }
        timeline={
          <RecordPanel
            title="전사"
            action={transcribed ? (
              <NbButton onClick={() => void extract()} disabled={busy === 'extract'}>
                {busy === 'extract' ? 'AI가 읽는 중…' : 'AI로 정리하기'}
              </NbButton>
            ) : undefined}
          >
            {!transcribed ? (
              <>
                <p className={styles.hint}>
                  회의 내용을 붙여넣으세요. <code>이름: 말</code> 형태면 화자를 알아봅니다.
                  녹음 파일 업로드는 음성 인식 업체를 연결하면 열립니다.
                </p>
                <textarea
                  className="input-field"
                  rows={10}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'김대표: 예산은 3억으로 품의 올렸습니다.\n윤수석: 보안 검토가 남아서 다음 달은 어려울 것 같아요.'}
                  aria-label="전사 내용"
                />
                <NbButton onClick={() => void saveTranscript()} disabled={busy === 'transcript'}>
                  {busy === 'transcript' ? '넣는 중…' : '전사 넣기'}
                </NbButton>
              </>
            ) : (
              <ul className={styles.transcript}>
                {m.segments.map((s) => (
                  <li
                    key={s.id}
                    className={`${styles.segment}${highlight.has(s.id) ? ` ${styles.segmentOn}` : ''}`}
                    id={`seg-${s.id}`}
                  >
                    <span className={styles.speaker}>{s.speaker}</span>
                    <span className={styles.segText}>{s.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </RecordPanel>
        }
        related={
          <RecordPanel title="AI가 찾은 것">
            {m.suggestions.length === 0 ? (
              <EmptyState
                title={transcribed ? '아직 정리하지 않았어요' : '전사를 먼저 넣어 주세요'}
                description={transcribed
                  ? '"AI로 정리하기"를 누르면 누가 나왔고 무엇이 걸림돌인지 뽑아 인박스로 보냅니다.'
                  : '회의 내용을 붙여넣으면 AI가 읽습니다.'}
              />
            ) : (
              <ul className={styles.found}>
                {m.suggestions.map((s) => {
                  const axis = AXIS[s.axis] ?? { label: s.axis, status: 'note' as StatusKey }
                  const ids = s.evidenceJson?.segmentIds ?? []
                  return (
                    <li key={s.id} className={styles.foundItem}>
                      <div className={styles.foundHead}>
                        <NbBadge status={axis.status}>{axis.label}</NbBadge>
                        <span className={styles.target}>{TARGET_LABEL[s.targetType] ?? s.targetType}</span>
                        {s.status !== 'PENDING' && <NbBadge status="done">처리됨</NbBadge>}
                        <span className={styles.conf}>확신 {Math.round(s.confidence * 100)}%</span>
                      </div>
                      <p className={styles.foundText}>{describeSuggestionValue(s.proposedValueJson, s, '(내용 없음)')}</p>
                      {s.evidenceJson?.quote && (
                        // 근거를 누르면 전사의 그 대목으로 간다 — 결론만 보여 주지 않는다
                        <button
                          type="button"
                          className={styles.evidence}
                          onClick={() => {
                            setHighlight(new Set(ids))
                            if (ids[0]) document.getElementById(`seg-${ids[0]}`)?.scrollIntoView({ block: 'center' })
                          }}
                        >
                          “{s.evidenceJson.quote}”
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </RecordPanel>
        }
      />
    </>
  )
}
