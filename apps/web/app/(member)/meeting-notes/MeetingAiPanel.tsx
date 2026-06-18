'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, ListChecks, CheckSquare, CalendarPlus, Star } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { saveMeetingSummary, applyExtractedItems } from './actions'

interface TaskCandidate {
  title: string
  confidence: number
  source_quote: string
}
interface EventCandidate {
  title: string
  confidence: number
  source_quote: string
  suggested_date: string | null
  suggested_time: string | null
}
interface HighlightCandidate {
  title: string
  confidence: number
  source_quote: string
}

interface ExtractResult {
  tasks: TaskCandidate[]
  events: EventCandidate[]
  highlights: HighlightCandidate[]
}

interface Props {
  meetingNoteId: string
  bodyPlain: string
  initialSummary: string
  initialDecisions: string
}

type ApiEnvelope<T> = { success: boolean; data?: T; error?: string }

// 후보 키: 종류 + 인덱스로 선택 상태 식별
const taskKey = (i: number) => `task-${i}`
const eventKey = (i: number) => `event-${i}`

export default function MeetingAiPanel({ meetingNoteId, bodyPlain, initialSummary, initialDecisions }: Props) {
  const router = useRouter()

  // ── 정제(요약·결정사항) ──
  const [summary, setSummary] = useState(initialSummary)
  const [decisions, setDecisions] = useState(initialDecisions)
  const [refineBusy, setRefineBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [refineMsg, setRefineMsg] = useState('')
  const [refineErr, setRefineErr] = useState('')

  // ── 추출(업무·일정·하이라이트) ──
  const [extractBusy, setExtractBusy] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [extractErr, setExtractErr] = useState('')
  const [extractInfo, setExtractInfo] = useState('')
  const [result, setResult] = useState<ExtractResult | null>(null)
  // 추출 후보 중 사용자가 체크한 항목 — task/event만 반영 대상(highlight는 표시 전용)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const hasBody = bodyPlain.trim().length > 0

  async function runRefine() {
    if (!hasBody || refineBusy) return
    setRefineBusy(true); setRefineErr(''); setRefineMsg('')
    try {
      const res = await fetch('/api/ai/meeting-summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingNoteId }),
      })
      const json = (await res.json()) as ApiEnvelope<{ summary: string; decisions: string }>
      if (!res.ok || !json.success || !json.data) { setRefineErr(json.error ?? 'AI 정제에 실패했습니다.'); return }
      setSummary(json.data.summary ?? '')
      setDecisions(json.data.decisions ?? '')
      setRefineMsg('AI가 요약·결정사항을 채웠습니다 — 확인·수정 후 저장하세요.')
    } catch {
      setRefineErr('AI 서버 연결에 실패했습니다.')
    } finally {
      setRefineBusy(false)
    }
  }

  async function saveRefine() {
    setSaveBusy(true); setRefineErr(''); setRefineMsg('')
    try {
      const res = await saveMeetingSummary(meetingNoteId, { summary: summary.trim(), decisions: decisions.trim() })
      if (!res.ok) { setRefineErr(res.error); return }
      setRefineMsg('요약·결정사항을 저장했습니다.')
      router.refresh()
    } catch {
      setRefineErr('저장에 실패했습니다.')
    } finally {
      setSaveBusy(false)
    }
  }

  async function runExtract() {
    if (!hasBody || extractBusy) return
    setExtractBusy(true); setExtractErr(''); setExtractInfo(''); setResult(null); setChecked(new Set())
    try {
      const res = await fetch('/api/ai/meeting-extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingNoteId }),
      })
      const json = (await res.json()) as ApiEnvelope<ExtractResult>
      if (!res.ok || !json.success || !json.data) { setExtractErr(json.error ?? 'AI 추출에 실패했습니다.'); return }
      const data = json.data
      setResult(data)
      // task/event 전체 기본 선택 (highlight는 반영 대상 아님)
      const next = new Set<string>()
      data.tasks.forEach((_, i) => next.add(taskKey(i)))
      data.events.forEach((_, i) => next.add(eventKey(i)))
      setChecked(next)
      const totalCount = data.tasks.length + data.events.length + data.highlights.length
      if (totalCount === 0) setExtractInfo('추출된 항목이 없습니다.')
    } catch {
      setExtractErr('AI 서버 연결에 실패했습니다.')
    } finally {
      setExtractBusy(false)
    }
  }

  function toggle(key: string) {
    setChecked((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  async function apply() {
    if (!result) return
    const tasks = result.tasks.filter((_, i) => checked.has(taskKey(i)))
    const events = result.events.filter((_, i) => checked.has(eventKey(i)))
    if (tasks.length === 0 && events.length === 0) return
    setApplyBusy(true); setExtractErr(''); setExtractInfo('')
    try {
      const res = await applyExtractedItems(meetingNoteId, {
        tasks: tasks.map((t) => ({ title: t.title })),
        events: events.map((e) => ({ title: e.title, suggested_date: e.suggested_date, suggested_time: e.suggested_time })),
      })
      if (!res.ok) { setExtractErr(res.error); return }
      const evNote = res.eventsCreated < events.length ? ` (일정 ${events.length - res.eventsCreated}건은 날짜가 없어 제외)` : ''
      setExtractInfo(`업무 ${res.tasksCreated}건 · 일정 ${res.eventsCreated}건을 반영했습니다.${evNote}`)
      setResult(null); setChecked(new Set())
      router.refresh()
    } catch {
      setExtractErr('반영에 실패했습니다.')
    } finally {
      setApplyBusy(false)
    }
  }

  const checkedApplyCount =
    (result?.tasks.filter((_, i) => checked.has(taskKey(i))).length ?? 0) +
    (result?.events.filter((_, i) => checked.has(eventKey(i))).length ?? 0)

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }} aria-labelledby="mn-ai-h">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Sparkles size={16} color="var(--brand)" />
        <h2 id="mn-ai-h" className="tape-title" style={{ margin: 0 }}>AI 정제 · 추출</h2>
      </div>

      {!hasBody && (
        <p role="status" style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
          본문을 작성하면 AI 정제·추출을 사용할 수 있습니다.
        </p>
      )}

      {/* ── AI 정제 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <NbButton onClick={runRefine} disabled={refineBusy || !hasBody} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Sparkles size={15} /> {refineBusy ? '정제 중…' : 'AI 정제'}
          </NbButton>
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>본문을 요약·결정사항으로 정리합니다</span>
        </div>

        {refineErr && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{refineErr}</p>}
        {refineMsg && <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{refineMsg}</p>}

        <div>
          <label className="label" htmlFor="mn-summary">요약</label>
          <textarea id="mn-summary" className="input-field"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            placeholder="AI 정제를 실행하거나 직접 입력하세요"
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <label className="label" htmlFor="mn-decisions">결정사항</label>
          <textarea id="mn-decisions" className="input-field"
            value={decisions}
            onChange={(e) => setDecisions(e.target.value)}
            rows={3}
            placeholder="회의에서 결정된 사항"
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <div>
          <NbButton variant="secondary" onClick={saveRefine} disabled={saveBusy}>
            {saveBusy ? '저장 중…' : '요약·결정사항 저장'}
          </NbButton>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: 'var(--hairline) solid var(--border-color)', margin: 0 }} />

      {/* ── AI 추출 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <NbButton onClick={runExtract} disabled={extractBusy || !hasBody} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <ListChecks size={15} /> {extractBusy ? '추출 중…' : 'AI 추출'}
          </NbButton>
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>업무·일정·하이라이트 후보를 찾습니다 (선택 후 반영)</span>
        </div>

        {extractErr && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{extractErr}</p>}
        {extractInfo && <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{extractInfo}</p>}

        {result && (result.tasks.length > 0 || result.events.length > 0 || result.highlights.length > 0) && (
          <>
            {result.tasks.length > 0 && (
              <CandidateGroup icon={<CheckSquare size={14} color="var(--brand)" />} label="업무 후보">
                {result.tasks.map((c, i) => (
                  <CandidateRow
                    key={taskKey(i)}
                    selectable
                    checked={checked.has(taskKey(i))}
                    onToggle={() => toggle(taskKey(i))}
                    title={c.title}
                    confidence={c.confidence}
                    quote={c.source_quote}
                  />
                ))}
              </CandidateGroup>
            )}

            {result.events.length > 0 && (
              <CandidateGroup icon={<CalendarPlus size={14} color="var(--brand)" />} label="일정 후보">
                {result.events.map((c, i) => (
                  <CandidateRow
                    key={eventKey(i)}
                    selectable
                    checked={checked.has(eventKey(i))}
                    onToggle={() => toggle(eventKey(i))}
                    title={c.title}
                    confidence={c.confidence}
                    quote={c.source_quote}
                    hint={[c.suggested_date, c.suggested_time].filter(Boolean).join(' ') || undefined}
                  />
                ))}
              </CandidateGroup>
            )}

            {result.highlights.length > 0 && (
              <CandidateGroup icon={<Star size={14} color="var(--warning)" />} label="하이라이트 (표시 전용)">
                {result.highlights.map((c, i) => (
                  <CandidateRow
                    key={`hl-${i}`}
                    selectable={false}
                    title={c.title}
                    confidence={c.confidence}
                    quote={c.source_quote}
                  />
                ))}
              </CandidateGroup>
            )}

            <div>
              <NbButton onClick={apply} disabled={applyBusy || checkedApplyCount === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <ListChecks size={15} /> {applyBusy ? '반영 중…' : `선택 ${checkedApplyCount}건 반영`}
              </NbButton>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function CandidateGroup({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
        {icon} {label}
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {children}
      </ul>
    </div>
  )
}

function CandidateRow({
  selectable, checked, onToggle, title, confidence, quote, hint,
}: {
  selectable: boolean
  checked?: boolean
  onToggle?: () => void
  title: string
  confidence: number
  quote: string
  hint?: string
}) {
  return (
    <li style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)' }}>
      {selectable && (
        <input type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`${title} 선택`}
          style={{ marginTop: 4 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{title}</strong>
          {hint && <span className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>{hint}</span>}
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>신뢰도 {Math.round(confidence * 100)}%</span>
        </div>
        {quote && (
          <div title={quote} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            근거: {quote}
          </div>
        )}
      </div>
    </li>
  )
}
