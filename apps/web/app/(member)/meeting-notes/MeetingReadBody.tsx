'use client'

// 조회(읽기전용) 본문 카드.
//  - [할 일·일정 뽑기] 액션: 추출 후보를 ExtractConfirmModal로 확정(자동 등록 금지).
//  - **정리(요약·결정사항)는 여기서 안 만든다** — 정리 패널 하나가 그 일을 맡는다(§2-3-6 P-4).
//  - 수동 텍스트 수정은 편집(에디터) 화면에서 — 조회엔 편집 컨트롤을 두지 않는다(CRUD 모드 분리).
import { useEffect, useRef, useState } from 'react'
import { FileText, Sparkles, FileDown } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import RichText from '@/components/ui/RichText'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import ControlRow from '@/components/ui/ControlRow'
import EmptyState from '@/components/ui/EmptyState'
import ExtractConfirmModal, { type ExtractResult } from './ExtractConfirmModal'
import MeetingExportModal from './MeetingExportModal'
import InlineError from '@/components/ui/InlineError'
import { DIGEST_LABEL, DIGEST_RUN_LABEL, DIGEST_EMPTY_TITLE, EXTRACT_LABEL, EXTRACT_RUN_LABEL, progress } from '@/lib/terms'

interface Props {
  meetingNoteId: string
  body: string | null
  bodyPlain: string
  initialSummary: string
  initialDecisions: string
  people: { id: string; name: string }[]
  currentAttendees: string[]
  currentUserIds: string[]
  autoAnalyze?: boolean
  /**
   * 본문·정제본 표시를 끄고 **AI 동작만** 남긴다.
   *
   * 회의 작업대(v0.7.592)가 본문 편집과 정리 표시를 가져갔다. 여기서 또 그리면
   * 같은 화면에 본문이 두 벌이 된다 — 사용자가 어느 쪽이 진짜인지 알 수 없다.
   * 대신 이 부품만 가진 기능(업무·일정 추출 · 문서 내보내기)은 그대로 남긴다.
   * 기본값 false — 다른 호출처는 한 글자도 안 바뀐다.
   */
  actionsOnly?: boolean
}

type ApiEnvelope<T> = { success: boolean; data?: T; error?: string }

export default function MeetingReadBody({
  meetingNoteId, body, bodyPlain, initialSummary, initialDecisions, people, currentAttendees, currentUserIds, autoAnalyze, actionsOnly = false,
}: Props) {
  // 저장된 정리 — **읽기 전용.** 만드는 것은 정리 패널이다(§2-3-6 P-4)
  const [summary] = useState(initialSummary)
  const [decisions] = useState(initialDecisions)
  const hasRefined = Boolean(summary.trim() || decisions.trim())
  const [tab, setTab] = useState<'refined' | 'original'>(hasRefined ? 'refined' : 'original')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // 요약·추출이 각각 실패할 수 있으므로 배열이다 — 한쪽만 터진 것을 뭉뚱그리지 않는다.
  const [errs, setErrs] = useState<string[]>([])
  const [info, setInfo] = useState('')
  // 설정 모델을 못 써서 다른 모델로 처리했을 때 서버가 보내는 안내 — 조용히 바꾸지 않는다.
  const [notice, setNotice] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const [modalResult, setModalResult] = useState<ExtractResult | null>(null)
  // 내보내기는 미리보기를 먼저 보여주고 형식을 고르게 한다 — 저장 뒤 파일을 열어보고서야
  // "이게 아닌데"를 알게 되는 흐름을 없앤다. 실제 다운로드는 모달이 수행한다.
  const [exportOpen, setExportOpen] = useState(false)

  const hasBody = bodyPlain.trim().length > 0
  const canExport = hasBody || hasRefined

  async function runAnalyze() {
    if (!hasBody || busy) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true); setElapsed(0); setErrs([]); setInfo(''); setNotice('')
    try {
      /*
        **요약은 여기서 안 만든다**(v0.7.688). 예전엔 요약과 추출을 함께 돌렸는데,
        그 요약이 `meeting_notes.summary` 에 저장되는 동안 정리 탭은 `meeting_note_digest`
        표만 봤다 — 같은 「정리」인데 **두 곳에 갈라져 쌓였고**, 이 버튼으로 만든 16건은
        화면 어디에도 안 나왔다(`actionsOnly ? null` 로 그리는 코드가 막혀 있었다).

        정리를 만드는 자리는 **정리 패널 하나**다(§2-3-6 P-4). 여기는 **뽑기**만 한다 —
        정리는 읽을 것을 만들고, 뽑기는 다른 화면(할 일·일정)으로 옮길 후보를 만든다.
      */
      const extS = await Promise.allSettled([
        fetch('/api/ai/meeting-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingNoteId }),
          signal: ctrl.signal,
        }).then((r) => r.json() as Promise<ApiEnvelope<ExtractResult>>),
      ])
      if (ctrl.signal.aborted) return

      const ext: ApiEnvelope<ExtractResult> =
        extS[0].status === 'fulfilled' ? extS[0].value : { success: false, error: 'AI 서버 연결에 실패했습니다.' }

      if (ext.success && ext.data?.notice) setNotice(ext.data.notice)

      // 실패를 삼키지 않는다 — 조용히 넘기면 "뽑을 후보가 없습니다"로 잘못 읽힌다(v0.7.571)
      if (!ext.success) setErrs([`${EXTRACT_LABEL} 실패 — ${ext.error ?? '알 수 없는 오류'}`])

      // 추출 후보가 있으면 확정 모달 오픈(자동등록 금지 — 사용자 선택분만).
      if (ext.success && ext.data) {
        const hasCandidates =
          ext.data.tasks.length > 0 ||
          ext.data.events.length > 0 ||
          (ext.data.attendees?.length ?? 0) > 0 ||
          ext.data.highlights.length > 0
        if (hasCandidates) setModalResult(ext.data)
        // 후보가 0건인 것은 **정상 답**이다 — 조용히 끝내면 눌렀는데 아무 일도 안 난 것으로 읽힌다
        else setInfo('옮길 할 일·일정 후보를 찾지 못했어요.')
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setErrs(['AI 서버 연결에 실패했습니다.'])
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      if (!ctrl.signal.aborted) setBusy(false)
    }
  }

  function cancelAnalyze() {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setInfo('분석을 취소했습니다.')
  }

  // 경과 시간 표시 — 응답이 수십 초 걸릴 수 있어(실측 15~85초) 숫자가 없으면 멈춘 것과 구별되지 않는다.
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [busy])

  // 저장 직후 자동분석(C안) — autoAnalyze일 때 1회만. ?analyze=1을 URL에서 제거.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!autoAnalyze || autoRan.current || !hasBody) return
    autoRan.current = true
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `/meeting-notes/${meetingNoteId}`)
    void runAnalyze()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyze, hasBody, meetingNoteId])

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} aria-labelledby="mn-body-h">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <FileText size={16} color="var(--brand)" />
          <h2 id="mn-body-h" className="tape-title" style={{ margin: 0 }}>{actionsOnly ? EXTRACT_LABEL : '회의 본문'}</h2>
        </div>
        <ControlRow gap={false}>
          {/* 작업대가 본문·정리를 그리는 화면에서는 여기서 또 고르게 하지 않는다 */}
          {!actionsOnly && (
            <SegmentedTabs
              ariaLabel="본문 보기 전환"
              tabs={[{ id: 'refined', label: 'AI 정제본' }, { id: 'original', label: '원본' }]}
              activeId={tab}
              onSelect={(id) => setTab(id === 'original' ? 'original' : 'refined')}
            />
          )}
          {canExport && (
            <NbButton variant="secondary" onClick={() => setExportOpen(true)} title={`${tab === 'refined' ? DIGEST_LABEL : '원본'}을 문서로 내보내기`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <FileDown size={15} /> 내보내기
            </NbButton>
          )}
          {hasBody && (
            <>
              <NbButton onClick={runAnalyze} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Sparkles size={15} /> {busy ? `${progress(EXTRACT_RUN_LABEL)} ${elapsed}초` : EXTRACT_RUN_LABEL}
              </NbButton>
              {busy && (
                <NbButton variant="secondary" onClick={cancelAnalyze} title={`진행 중인 ${EXTRACT_LABEL}를 중단합니다`}>
                  취소
                </NbButton>
              )}
            </>
          )}
        </ControlRow>
      </div>

      {actionsOnly ? null : tab === 'refined' ? (
        <div role="tabpanel">
          {hasRefined ? (
            <>
              {summary.trim() && (
                <div style={{ marginBottom: decisions.trim() ? 'var(--space-4)' : 0 }}>
                  <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>요약</h3>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 'var(--fs-base)', lineHeight: 1.7 }}>{summary}</p>
                </div>
              )}
              {decisions.trim() && (
                <div>
                  <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>결정사항</h3>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 'var(--fs-base)', lineHeight: 1.7 }}>{decisions}</p>
                </div>
              )}
            </>
          ) : hasBody ? (
            <EmptyState
              title={DIGEST_EMPTY_TITLE}
              description={`위 「회의 기록」의 [${DIGEST_RUN_LABEL}]를 누르면 안건·결정사항을 정리합니다`}
            />
          ) : (
            // 수정 전용 라우트는 없다(같은 페이지의 [수정] 토글) — 죽은 링크를 만들지 않고 그 버튼을 가리킨다
            <EmptyState
              title="본문이 비어 있어요"
              description="위 [수정]으로 회의 내용을 적으면 AI 요약·업무 추출을 쓸 수 있습니다"
            />
          )}
        </div>
      ) : (
        <div role="tabpanel">
          <RichText html={body} placeholder="본문이 비어 있습니다." />
        </div>
      )}

      {notice && (
        <p role="status" style={{ margin: 0, color: 'var(--warning)', fontSize: 'var(--fs-sm)' }}>{notice}</p>
      )}
      {errs.map((m) => (
        <InlineError key={m} banner>{m}</InlineError>
      ))}
      {info && <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{info}</p>}

      {exportOpen && (
        <MeetingExportModal meetingNoteId={meetingNoteId} view={tab} onClose={() => setExportOpen(false)} />
      )}

      {modalResult && (
        <ExtractConfirmModal
          meetingNoteId={meetingNoteId}
          result={modalResult}
          people={people}
          currentAttendees={currentAttendees}
          currentUserIds={currentUserIds}
          onClose={() => setModalResult(null)}
        />
      )}
    </section>
  )
}

