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
import { ENTITY } from '@/lib/terms'
import { Mic, CheckCircle2, HelpCircle } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { backTarget, linkWithBack } from '@/lib/crm/nav/back-link'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import RecordLayout, { RecordPanel, RecordField, RecordFieldList } from '@/components/ui/crm/RecordLayout'
import MeetingWorkbench from '@/components/meeting/MeetingWorkbench'
import MeetingFacts from './MeetingFacts'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { describeSuggestionValue, TARGET_LABEL } from '@/lib/crm/format/suggestion'
import { axisMeta } from '@/lib/crm/ui/suggestion-axis'
import { useRecordingSession, useIsRecording } from '@/lib/meeting/recording-context'
import type { FinishResult } from '@/lib/crm/services/meeting-finish'
import styles from './meeting-detail.module.css'

interface Segment { id: string; idx: number; speaker: string; text: string }
interface Recording { id: string; status: string; sttVendor: string | null; error: string | null }
interface Suggestion {
  id: string; axis: string; field: string | null; status: string; targetType: string
  proposedValueJson: unknown; confidence: number
  evidenceJson: { quote?: string; segmentIds?: string[] } | null
}
/** 원본 회의노트 상태 — 본문은 안 온다(공개 범위 때문에). 살아 있나·언제 바뀌었나·열어도 되나만 */
/**
 * 서버 `lib/crm/services/meeting-publish.ts` 의 `NoteMeta` 를 그대로 비춘 것.
 * 그 모듈은 service_role 클라이언트를 끌고 오므로 클라이언트 컴포넌트가 직접 import 하지 않는다.
 * **필드를 늘릴 때는 양쪽을 함께 고친다** — 안 맞으면 tsc 가 여기서 잡아 준다.
 */
interface NoteMeta {
  id: string; exists: boolean; title: string | null
  updatedAt: string | null; visibility: 'private' | 'crm' | null
  canOpen: boolean; isOwner: boolean; isStale: boolean
  /** 원본에 사람이 쓴 본문이 있나 — AI 가 읽을 재료가 있는지 판정한다 */
  hasBody: boolean
  /** CRM 제목이 원본과 같은가. 원본이 없으면 null */
  titleMatches: boolean | null
}
interface Meeting {
  id: string; title: string; startedAt: string; endedAt: string | null; location: string | null
  companyId: string | null; dealId: string | null; summaryMd: string | null
  companyName: string | null; dealName: string | null
  noteId: string | null; noteSyncedAt: string | null; note: NoteMeta | null
  recordings: Recording[]; segments: Segment[]; suggestions: Suggestion[]
}


/** 어디에 붙는 제안인지 — 이게 없으면 "왜 금액이 여기 있지"가 된다 */
const WHERE_IT_GOES: Record<string, string> = { deal: '딜', person: '인물', company: '회사', meeting: '이 미팅' }

export default function MeetingDetail({ meetingId }: { meetingId: string }) {
  /*
    돌아갈 곳은 **주소가 정한다**. 고정으로 적으면 딜에서 회사로 들어온 사람이
    뒤로 갔을 때 목록으로 튕긴다(사용자 지적). `returnTo` 가 있으면 그리로 간다.
  */
  const backParams = useSearchParams()
  const back = backTarget(backParams, { href: '/crm/meetings', label: '미팅' })
  const [m, setM] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  /** 근거를 클릭하면 그 구간을 띄운다 — 결론만 보여 주지 않는다 */
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  /** 「미팅 끝내기」의 결과 — 무엇이 됐고 무엇이 안 됐는지 그대로 보여 준다 */
  const [finished, setFinished] = useState<FinishResult | null>(null)

  const rec = useRecordingSession()
  const recordingHere = useIsRecording(m?.note?.id ?? '')

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
   * 「원본에 맞추기」 — 이미 갈려 있던 제목을 원본 값으로 되돌린다.
   *
   * **자동으로 하지 않는다.** 어느 쪽이 사용자의 의도인지 코드는 모른다 —
   * CRM 쪽이 더 자세한 제목일 수도 있다(실제로 그랬다: 「8/31 김해사업 미팅」).
   * 그래서 사실만 보여 주고 사람이 한 번 누르게 한다.
   *
   * 저장 경로를 그대로 쓴다(`PATCH`). 같은 값이면 서버가 원본을 쓰지 않는다.
   */
  async function adoptNoteTitle(title: string) {
    if (!title.trim()) return
    setBusy('facts')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/meetings/${meetingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '제목을 맞추지 못했습니다.'); return }
      setNotice('원본 제목으로 맞췄어요.')
      await load()
    } catch {
      setError('제목을 맞추지 못했습니다. 잠시 후 다시 시도해 주세요.')
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

  /**
   * 「미팅 끝내기」 — 녹음을 멈추고, 정리하고, 5축을 뽑고, 모르는 것을 되묻는다.
   *
   * **녹음 정지가 먼저다.** 마지막 구간이 아직 안 올라간 상태에서 정리를 시작하면
   * 그 몇 분이 정리에 빠진다 — 그리고 사용자는 그 사실을 모른다.
   */
  async function finish() {
    setBusy('finish')
    setError(null)
    setNotice(null)
    setFinished(null)
    try {
      if (recordingHere) {
        try {
          await rec.stop()
        } catch {
          // 정지에 실패해도 여기서 멈추지 않는다 — 이미 올라간 구간까지로 정리한다.
          // 남은 구간은 기기에 있고 연결이 돌아오면 올라간다(lib/offline).
          setNotice('녹음을 멈추지 못해 지금까지 올라간 부분으로 정리했어요.')
        }
      }
      const res = await fetch(`/api/crm/meetings/${meetingId}/finish`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '미팅을 끝내지 못했습니다.'); return }
      setFinished(body as FinishResult)
      await load()
    } catch {
      setError('미팅을 끝내지 못했습니다. 잠시 후 다시 시도해 주세요.')
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

  /**
   * AI 가 **읽을 재료가 있나.**
   *
   * 전사 사본만 보면 안 된다. 사용자가 원본에 쓴 본문도 재료다 —
   * 추출 직전에 서버가 그것을 전사로 끌어온다(`snapshotNoteBodyForExtract`).
   * 예전엔 이 판정이 `transcribed` 하나였고, 그래서 193자를 써 둔 회의에
   * 「전사를 먼저 넣어 주세요」라고 답했다(사용자 지적 2026-08-31).
   *
   * `canOpen` 을 함께 본다 — 서버가 본문을 끌어오는 조건과 **같은 규칙**이어야 한다.
   * 화면은 읽을 수 있다는데 AI 는 못 읽으면, 버튼을 눌러 보고서야 알게 된다.
   */
  const readable = transcribed || Boolean(m.note?.exists && m.note.canOpen && m.note.hasBody)
  /** 원본이 살아 있는데 제목이 어긋난 상태 — 이미 갈려 있던 행을 사람이 한 번 눌러 맞춘다 */
  const titleDiffers = Boolean(m.note?.exists && m.note.titleMatches === false)

  return (
    <>
      <PageHeader
        eyebrow="영업 CRM"
        title={m.title}
        icon={<Mic size={20} />}
        description={formatKstDateTimeShort(m.startedAt) + (m.location ? ` · ${m.location}` : '')}
        back={back}
        actions={
          /**
           * 회의가 끝나고 차에 타면서 누르는 버튼 하나. 여기가 그 자리다.
           * 예전엔 같은 결과를 얻으려면 화면 셋을 오가며 세 번 눌러야 했다.
           */
          <NbButton variant="primary" onClick={() => void finish()} disabled={busy === 'finish'}>
            {busy === 'finish'
              ? '정리하는 중…'
              : m.endedAt ? '다시 정리하기' : '미팅 끝내기'}
          </NbButton>
        }
      />

      <FormErrorBanner message={error} />
      {notice && <p className={styles.notice}>{notice}</p>}

      {/**
        * 끝내기 결과. **된 것과 안 된 것을 함께 말한다** — 한 단계가 넘어져도 나머지는 갔다는
        * 사실을 사용자가 알아야 다음 행동을 정할 수 있다. 「완료」만 띄우면 실패가 묻힌다.
        */}
      {finished && (
        <section className={styles.finish} aria-live="polite">
          <h3 className={styles.finishHead}>
            <CheckCircle2 size={16} aria-hidden /> 미팅을 정리했어요
          </h3>
          <ul className={styles.stepList}>
            {finished.steps.map((st) => (
              <li key={st.key} className={styles.step} data-status={st.status}>
                {st.detail}
              </li>
            ))}
          </ul>

          {/**
            * **모르는 것을 되묻는다.** AI 가 채운 것만 보여 주고 못 채운 자리를 말하지 않으면
            * 사용자는 다 된 줄 안다 — 그 빈칸은 리포트가 틀린 숫자를 낼 때야 발견된다.
            */}
          {finished.questions.length > 0 && (
            <div className={styles.asks}>
              <h4 className={styles.asksHead}>
                <HelpCircle size={15} aria-hidden /> 이건 제가 몰라요 — 채워 주시겠어요?
              </h4>
              <ul className={styles.askList}>
                {finished.questions.map((q) => (
                  <li key={q.key} className={styles.ask}>
                    <Link href={q.href} className={styles.askLink}>{q.ask}</Link>
                    <span className={styles.askWhy}>{q.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {failed?.error && (
        <p className={styles.failed}>전사에 실패했어요: {failed.error}</p>
      )}

      {/* 원본이 그 뒤 수정됐다 — 조용히 어긋나게 두지 않는다 */}
      {m.note?.isStale && (
        <p className={styles.notice}>
          원본 회의노트가 {formatKstDateTimeShort(m.note.updatedAt ?? '')}에 수정됐어요.{' '}
          요약·참석자·회의 내용만 따라잡습니다 — 제목은 그대로 둡니다.{' '}
          <NbButton onClick={() => void resync()} disabled={busy === 'resync'}>
            {busy === 'resync' ? '가져오는 중…' : '다시 가져오기'}
          </NbButton>
        </p>
      )}

      {/**
        * 제목이 원본과 다르다 — **자동으로 덮지 않는다.**
        * 어느 쪽이 사용자의 의도인지 코드는 모른다. 그래서 사실만 말하고 한 번 누르게 한다.
        * 앞으로 갈리지 않게 하는 것은 저장 경로가 맡는다(`syncNoteTitle`).
        */}
      {titleDiffers && (
        <p className={styles.notice}>
          원본 회의노트의 제목은 「{m.note?.title || '(제목 없음)'}」이에요.{' '}
          {m.note?.isOwner
            ? '어느 쪽으로 맞출지 정해 주세요 — 「이 미팅은」에서 제목을 고치면 원본도 함께 바뀝니다.'
            : '원본은 만든 사람만 고칠 수 있어요.'}
          {m.note?.title && (
            <>
              {' '}
              <NbButton
                onClick={() => void adoptNoteTitle(m.note?.title ?? '')}
                disabled={busy === 'facts'}
              >
                {busy === 'facts' ? '맞추는 중…' : '원본에 맞추기'}
              </NbButton>
            </>
          )}
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
          <>
            {/**
              * **여기서 바로 고친다.** 예전엔 읽기 전용이라, 제목 하나 고치려면
              * 미팅을 만들기 전에 `/crm/meetings/new` 에서 미리 적어야 했다.
              * 그 화면을 없애려면(사용자 지시 2026-08-24) 이 자리가 먼저 있어야 했다.
              */}
            <MeetingFacts
              meetingId={meetingId}
              /**
               * 제목을 여기서 고치면 원본도 함께 바뀐다 — 그래서 **원본 주인만** 고칠 수 있다.
               * 원본이 없거나 지워진 미팅은 CRM 제목이 유일한 사본이라 그대로 고칠 수 있다.
               */
              canEditTitle={!m.note?.exists || m.note.isOwner}
              value={{
                title: m.title,
                startedAt: m.startedAt,
                location: m.location,
                companyId: m.companyId,
                companyName: m.companyName,
                dealId: m.dealId,
                dealName: m.dealName,
              }}
              onSaved={() => { void load() }}
            />

            <RecordPanel title="붙은 것">
              <RecordFieldList>
                {/*
                  **이름이 곧 링크다.** 「회사 열기」는 눌러 봐야 어느 회사인지 알 수 있다 —
                  붙은 것을 보러 온 자리에서 무엇이 붙었는지를 안 알려 주는 셈이었다
                  (사용자 지적: 「이거 너는 어떤 딜인지 알겠니? 왜 친절하지가 않아?」).
                  서버는 이름을 이미 주고 있었다.
                */}
                <RecordField label={ENTITY.company.label}>
                  {m.companyId
                    ? <Link href={`/crm/companies/${m.companyId}`}>{m.companyName ?? '이름 없음'}</Link>
                    : null}
                </RecordField>
                <RecordField label={ENTITY.deal.label}>
                  {m.dealId
                    ? <Link href={`/crm/deals/${m.dealId}`}>{m.dealName ?? '이름 없음'}</Link>
                    : null}
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
          </>
        }
        timeline={
          /**
           * 원본이 살아 있으면 **여기서 바로 쓰고·녹음하고·정리한다.**
           * 회의노트 화면과 같은 부품이다 — 화면을 옮기지 않아도 되는 것이 이 변경의 목적이다
           * (사용자 지시 2026-08-24: "같은 플랫폼을 공유해서 여기서도 바로 작성").
           *
           * 원본이 없거나(발행 전·삭제됨) 남의 노트면 CRM 이 가진 **스냅샷**을 보여 준다 —
           * 스냅샷 구조라서 원본이 사라져도 팀의 영업 기록은 산다.
           */
          /**
           * **열어도 되는 원본일 때만** 작업대를 그린다.
           *
           * 예전엔 `exists` 만 봤다(v0.7.595 이전). 그래서 남이 '나만 보기'로 둔 원본이
           * 붙은 미팅을 팀원이 열면: 작업대가 그려지고 → 원본을 요청하고 → 권한이 없어
           * 404 를 받고 → **오류 상자**를 그렸다. 사본이 있는데도 안 보여 준 것이다.
           * 사본 구조를 만든 이유("원본이 사라져도 팀의 영업 기록은 산다")가 바로 그 자리에서 무력해졌다.
           */
          m.note?.exists && m.note.canOpen ? (
            <MeetingWorkbench
              noteId={m.note.id}
              title={m.title}
              href={`/crm/meetings/${meetingId}`}
              onDigested={() => { void resync() }}
            />
          ) : (
            <RecordPanel
              title="회의 내용"
              action={readable ? (
                <NbButton onClick={() => void extract()} disabled={busy === 'extract'}>
                  {busy === 'extract' ? 'AI가 읽는 중…' : 'AI로 정리하기'}
                </NbButton>
              ) : undefined}
            >
              {/* 발행해 온 요약 — 예전엔 타입으로만 받고 **화면에 안 그렸다**(v0.7.588 실측 F-6).
                  목록 배지와 회사·딜 패널은 이 값을 쓰는데 정작 상세에서 안 보였다. */}
              {m.summaryMd?.trim() && (
                <div className={styles.snapshotSummary}>
                  <h3 className={styles.snapshotHead}>정리된 내용</h3>
                  <p className={styles.snapshotBody}>{m.summaryMd}</p>
                </div>
              )}

              {!transcribed ? (
                <>
                  <p className={styles.hint}>
                    회의 내용을 붙여넣으세요. <code>이름: 말</code> 형태면 화자를 알아봅니다.
                  </p>
                  <textarea
                    className="input-field"
                    rows={10}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={'김대표: 예산은 3억으로 품의 올렸습니다.\n윤수석: 보안 검토가 남아서 다음 달은 어려울 것 같아요.'}
                    aria-label="회의 내용"
                  />
                  <NbButton onClick={() => void saveTranscript()} disabled={busy === 'transcript'}>
                    {busy === 'transcript' ? '넣는 중…' : '넣기'}
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
          )
        }
        related={
          <RecordPanel title="AI가 찾은 것">
            {m.suggestions.length === 0 ? (
              <EmptyState
                title={readable ? '아직 정리하지 않았어요' : '읽을 회의 내용이 없어요'}
                description={readable
                  ? (transcribed
                      ? '"AI로 정리하기"를 누르면 누가 나왔고 무엇이 걸림돌인지 뽑아 인박스로 보냅니다.'
                      : '원본 회의노트에 적어 둔 내용을 읽습니다. "AI로 정리하기"를 눌러 주세요.')
                  : '회의 내용을 붙여넣거나 「작성」 탭에 적으면 AI가 읽습니다.'}
              />
            ) : (
              <ul className={styles.found}>
                {m.suggestions.map((s) => {
                  const axis = axisMeta(s.axis)
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
