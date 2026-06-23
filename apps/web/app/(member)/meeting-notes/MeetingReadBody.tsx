'use client'

// 조회(읽기전용) 본문 카드.
//  - [AI 정제본 | 원본] 탭은 모두 읽기 표시(정제본=요약/결정사항 텍스트, 원본=RichText). 편집 textarea 없음.
//  - [AI 분석] 액션: 요약/결정사항 자동 생성·저장(읽기 갱신) + 추출 후보는 ExtractConfirmModal로 확정.
//  - 수동 텍스트 수정은 편집(에디터) 화면에서 — 조회엔 편집 컨트롤을 두지 않는다(CRUD 모드 분리).
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import RichText from '@/components/ui/RichText'
import { saveMeetingSummary } from './actions'
import ExtractConfirmModal, { type ExtractResult } from './ExtractConfirmModal'

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
}

type ApiEnvelope<T> = { success: boolean; data?: T; error?: string }

export default function MeetingReadBody({
  meetingNoteId, body, bodyPlain, initialSummary, initialDecisions, people, currentAttendees, currentUserIds, autoAnalyze,
}: Props) {
  const router = useRouter()
  const [summary, setSummary] = useState(initialSummary)
  const [decisions, setDecisions] = useState(initialDecisions)
  const hasRefined = Boolean(summary.trim() || decisions.trim())
  const [tab, setTab] = useState<'refined' | 'original'>(hasRefined ? 'refined' : 'original')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [modalResult, setModalResult] = useState<ExtractResult | null>(null)

  const hasBody = bodyPlain.trim().length > 0

  async function runAnalyze() {
    if (!hasBody || busy) return
    setBusy(true); setErr(''); setInfo('')
    try {
      const [sumRes, extRes] = await Promise.all([
        fetch('/api/ai/meeting-summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingNoteId }) }),
        fetch('/api/ai/meeting-extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingNoteId }) }),
      ])
      const sum = (await sumRes.json()) as ApiEnvelope<{ summary: string; decisions: string }>
      const ext = (await extRes.json()) as ApiEnvelope<ExtractResult>

      if (sum.success && sum.data) {
        const nextSummary = sum.data.summary ?? ''
        const nextDecisions = sum.data.decisions ?? ''
        setSummary(nextSummary)
        setDecisions(nextDecisions)
        if (nextSummary.trim() || nextDecisions.trim()) {
          setTab('refined')
          // 정제본을 즉시 저장 → 새로고침/재방문에도 읽기표시 유지. 실패 시 사용자에게 안내.
          const saveRes = await saveMeetingSummary(meetingNoteId, { summary: nextSummary.trim(), decisions: nextDecisions.trim() })
          if (!saveRes.ok) setErr('정제본 자동저장에 실패했습니다 — [편집]에서 직접 저장해 주세요.')
          else router.refresh()
        }
      }

      if (!sum.success && !ext.success) {
        setErr(sum.error ?? ext.error ?? 'AI 분석에 실패했습니다.')
        return
      }

      // 추출 후보가 있으면 확정 모달 오픈(자동등록 금지 — 사용자 선택분만).
      const hasCandidates = !!ext.data && (ext.data.tasks.length > 0 || ext.data.events.length > 0 || (ext.data.attendees?.length ?? 0) > 0 || ext.data.highlights.length > 0)
      if (ext.success && hasCandidates && ext.data) {
        setModalResult(ext.data)
      } else {
        setInfo('AI가 본문을 정제했습니다. 추출할 업무·일정 후보는 없습니다.')
      }
    } catch {
      setErr('AI 서버 연결에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

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
          <h2 id="mn-body-h" className="tape-title" style={{ margin: 0 }}>회의 본문</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div role="tablist" aria-label="본문 보기 전환" style={{ display: 'inline-flex', gap: 'var(--space-1)', padding: 'var(--space-1)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)' }}>
            <BodyTab label="AI 정제본" selected={tab === 'refined'} onClick={() => setTab('refined')} />
            <BodyTab label="원본" selected={tab === 'original'} onClick={() => setTab('original')} />
          </div>
          {hasBody && (
            <NbButton onClick={runAnalyze} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Sparkles size={15} /> {busy ? '분석 중…' : 'AI 분석'}
            </NbButton>
          )}
        </div>
      </div>

      {tab === 'refined' ? (
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
          ) : (
            <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
              {hasBody ? '아직 AI 정제본이 없습니다. [AI 분석]을 실행하거나 [편집]에서 직접 입력하세요.' : '본문이 없습니다.'}
            </p>
          )}
        </div>
      ) : (
        <div role="tabpanel">
          <RichText html={body} placeholder="본문이 비어 있습니다." />
        </div>
      )}

      {err && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{err}</p>}
      {info && <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{info}</p>}

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

function BodyTab({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={selected} onClick={onClick}
      style={{
        padding: 'var(--space-1) var(--space-3)', minHeight: 36, border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
        fontSize: 'var(--fs-sm)', fontWeight: selected ? 700 : 500,
        background: selected ? 'var(--surface-card)' : 'transparent', color: selected ? 'var(--text)' : 'var(--text-muted)',
        boxShadow: selected ? 'var(--shadow-sm)' : 'none',
      }}>
      {label}
    </button>
  )
}
