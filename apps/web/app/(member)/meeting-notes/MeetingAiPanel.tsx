'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, CheckSquare, CalendarPlus, Star } from 'lucide-react'
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

  const [summary, setSummary] = useState(initialSummary)
  const [decisions, setDecisions] = useState(initialDecisions)
  const [result, setResult] = useState<ExtractResult | null>(null)
  // 추출 후보 중 사용자가 체크한 항목 — task/event만 반영 대상(highlight는 표시 전용)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  const hasBody = bodyPlain.trim().length > 0

  // 1단계: 요약·결정사항 + 후보를 한 번에 분석(병렬 호출)
  async function runAnalyze() {
    if (!hasBody || analyzeBusy) return
    setAnalyzeBusy(true); setErr(''); setInfo('')
    try {
      const [sumRes, extRes] = await Promise.all([
        fetch('/api/ai/meeting-summarize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingNoteId }),
        }),
        fetch('/api/ai/meeting-extract', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingNoteId }),
        }),
      ])
      const sum = (await sumRes.json()) as ApiEnvelope<{ summary: string; decisions: string }>
      const ext = (await extRes.json()) as ApiEnvelope<ExtractResult>

      if (sum.success && sum.data) {
        setSummary(sum.data.summary ?? '')
        setDecisions(sum.data.decisions ?? '')
      }

      if (ext.success && ext.data) {
        setResult(ext.data)
        const next = new Set<string>()
        ext.data.tasks.forEach((_, i) => next.add(taskKey(i)))
        ext.data.events.forEach((_, i) => next.add(eventKey(i)))
        setChecked(next)
      } else {
        setResult(null); setChecked(new Set())
      }

      if (!sum.success && !ext.success) {
        setErr(sum.error ?? ext.error ?? 'AI 분석에 실패했습니다.')
      } else {
        setInfo('AI가 요약·결정사항과 후보를 채웠습니다 — 검토·수정 후 저장·반영하세요.')
      }
    } catch {
      setErr('AI 서버 연결에 실패했습니다.')
    } finally {
      setAnalyzeBusy(false)
    }
  }

  function toggle(key: string) {
    setChecked((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  const checkedApplyCount =
    (result?.tasks.filter((_, i) => checked.has(taskKey(i))).length ?? 0) +
    (result?.events.filter((_, i) => checked.has(eventKey(i))).length ?? 0)

  // 2단계: 요약 저장 + 선택 후보 반영을 한 번에 확정
  async function confirmAll() {
    if (confirmBusy) return
    setConfirmBusy(true); setErr(''); setInfo('')
    try {
      const saveRes = await saveMeetingSummary(meetingNoteId, { summary: summary.trim(), decisions: decisions.trim() })
      if (!saveRes.ok) { setErr(saveRes.error); return }

      let applyMsg = ''
      if (result && checkedApplyCount > 0) {
        const tasks = result.tasks.filter((_, i) => checked.has(taskKey(i)))
        const events = result.events.filter((_, i) => checked.has(eventKey(i)))
        const applyRes = await applyExtractedItems(meetingNoteId, {
          tasks: tasks.map((t) => ({ title: t.title })),
          events: events.map((e) => ({ title: e.title, suggested_date: e.suggested_date, suggested_time: e.suggested_time })),
        })
        if (!applyRes.ok) { setErr(`요약은 저장됐지만 반영에 실패했습니다: ${applyRes.error}`); router.refresh(); return }
        const evNote = applyRes.eventsCreated < events.length ? ` (일정 ${events.length - applyRes.eventsCreated}건은 날짜가 없어 제외)` : ''
        applyMsg = ` · 업무 ${applyRes.tasksCreated}건 · 일정 ${applyRes.eventsCreated}건 반영${evNote}`
        setResult(null); setChecked(new Set())
      }
      setInfo(`요약·결정사항을 저장했습니다.${applyMsg}`)
      router.refresh()
    } catch {
      setErr('저장·반영에 실패했습니다.')
    } finally {
      setConfirmBusy(false)
    }
  }

  const confirmLabel = confirmBusy
    ? '저장 중…'
    : checkedApplyCount > 0
      ? `저장 · 선택 ${checkedApplyCount}건 반영`
      : '저장'

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }} aria-labelledby="mn-ai-h">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Sparkles size={16} color="var(--brand)" />
        <h2 id="mn-ai-h" className="tape-title" style={{ margin: 0 }}>AI 분석</h2>
      </div>

      {!hasBody && (
        <p role="status" style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
          본문을 작성하면 AI 분석을 사용할 수 있습니다.
        </p>
      )}

      {hasBody && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <NbButton onClick={runAnalyze} disabled={analyzeBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Sparkles size={15} /> {analyzeBusy ? '분석 중…' : 'AI 분석'}
          </NbButton>
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>요약·결정사항과 업무·일정 후보를 한 번에 찾습니다</span>
        </div>
      )}

      {err && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{err}</p>}
      {info && <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{info}</p>}

      {/* 요약·결정사항(편집 가능) */}
      <div>
        <label className="label" htmlFor="mn-summary">요약</label>
        <textarea id="mn-summary" className="input-field"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          placeholder="AI 분석을 실행하거나 직접 입력하세요"
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

      {/* 추출 후보(선택형) */}
      {result && (result.tasks.length > 0 || result.events.length > 0 || result.highlights.length > 0) && (
        <>
          {result.tasks.length > 0 && (
            <CandidateGroup icon={<CheckSquare size={14} color="var(--brand)" />} label="업무 후보 → 일일업무">
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
            <CandidateGroup icon={<CalendarPlus size={14} color="var(--brand)" />} label="일정 후보 → 캘린더">
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
        </>
      )}

      {/* 단일 확정: 요약 저장 + 선택 후보 반영 */}
      <div>
        <NbButton onClick={confirmAll} disabled={confirmBusy || !hasBody} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <CheckSquare size={15} /> {confirmLabel}
        </NbButton>
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
