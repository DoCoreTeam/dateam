'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, CheckSquare, CalendarPlus, Star, Users, FileText } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import RichText from '@/components/ui/RichText'
import { saveMeetingSummary, applyExtractedItems, updateMeetingNote } from './actions'
import { matchAttendees, normalizeName } from '@/lib/meeting/match-attendees'

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
interface AttendeeCandidate {
  name: string
  confidence: number
  source_quote: string
  affiliation: 'internal' | 'external' | 'unknown'
}

interface ExtractResult {
  tasks: TaskCandidate[]
  events: EventCandidate[]
  highlights: HighlightCandidate[]
  attendees: AttendeeCandidate[]
}

interface Props {
  meetingNoteId: string
  body: string | null // 원본 HTML — 원본 탭 RichText 렌더용
  bodyPlain: string
  initialSummary: string
  initialDecisions: string
  people: { id: string; name: string }[]
  // 현재 저장된 참석자(합집합 반영용) — AI 선택분을 기존 참석자에 더한다.
  currentAttendees: string[]
  currentUserIds: string[]
  // 저장 직후 자동분석(C안) — 마운트 시 1회 자동 실행 + 요약·결정사항 자동저장.
  autoAnalyze?: boolean
}

type ApiEnvelope<T> = { success: boolean; data?: T; error?: string }

// 후보 키: 종류 + 인덱스로 선택 상태 식별
const taskKey = (i: number) => `task-${i}`
const eventKey = (i: number) => `event-${i}`
const attendeeKey = (i: number) => `attendee-${i}`

export default function MeetingAiPanel({
  meetingNoteId, body, bodyPlain, initialSummary, initialDecisions, people, currentAttendees, currentUserIds, autoAnalyze,
}: Props) {
  const router = useRouter()

  const [summary, setSummary] = useState(initialSummary)
  const [decisions, setDecisions] = useState(initialDecisions)
  const [result, setResult] = useState<ExtractResult | null>(null)
  // 본문 탭: 정제본(요약·결정사항 편집면) / 원본(RichText). 정제본이 있으면 기본 정제본.
  const hasRefined = Boolean(summary.trim() || decisions.trim())
  const [tab, setTab] = useState<'refined' | 'original'>(hasRefined ? 'refined' : 'original')
  // 추출 후보 중 사용자가 체크한 항목 — task/event만 반영 대상(highlight는 표시 전용)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  const hasBody = bodyPlain.trim().length > 0

  // 조직원 이름(정규화) 집합 — 후보 배지 판정용 O(1) 조회. 후보마다 matchAttendees를 호출하지 않는다.
  // 정규화는 matchAttendees와 동일 SSOT(normalizeName)를 재사용.
  const peopleNameSet = useMemo(() => new Set(people.map((p) => normalizeName(p.name))), [people])

  // 1단계: 요약·결정사항 + 후보를 한 번에 분석(병렬 호출)
  //  autoPersist=true(저장 직후 자동분석): 요약·결정사항을 즉시 저장해 "정제본 기본표시"가 성립하게 함.
  //  추출 후보(할일/일정/참석자)는 자동저장하지 않고 체크리스트로 사용자 확정(§5-3 추출형 표준 유지).
  async function runAnalyze(autoPersist = false) {
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

      let nextSummary = ''
      let nextDecisions = ''
      if (sum.success && sum.data) {
        nextSummary = sum.data.summary ?? ''
        nextDecisions = sum.data.decisions ?? ''
        setSummary(nextSummary)
        setDecisions(nextDecisions)
        // 정제 결과가 생기면 정제본 탭으로 전환(정제본 기본표시).
        if (nextSummary.trim() || nextDecisions.trim()) setTab('refined')
      }

      if (ext.success && ext.data) {
        setResult(ext.data)
        const next = new Set<string>()
        ext.data.tasks.forEach((_, i) => next.add(taskKey(i)))
        ext.data.events.forEach((_, i) => next.add(eventKey(i)))
        ext.data.attendees?.forEach((_, i) => next.add(attendeeKey(i)))
        setChecked(next)
      } else {
        setResult(null); setChecked(new Set())
      }

      if (!sum.success && !ext.success) {
        setErr(sum.error ?? ext.error ?? 'AI 분석에 실패했습니다.')
        return
      }

      // 자동분석 경로: 정제본(요약·결정사항)을 즉시 저장 → 상세 본문이 정제본을 기본 표시.
      if (autoPersist && sum.success && (nextSummary.trim() || nextDecisions.trim())) {
        await saveMeetingSummary(meetingNoteId, { summary: nextSummary.trim(), decisions: nextDecisions.trim() })
        setInfo('저장 후 AI가 본문을 정제하고 업무·일정 후보를 찾았습니다 — 후보를 검토·확정하세요.')
        router.refresh()
      } else {
        setInfo('AI가 요약·결정사항과 후보를 채웠습니다 — 검토·수정 후 저장·반영하세요.')
      }
    } catch {
      setErr('AI 서버 연결에 실패했습니다.')
    } finally {
      setAnalyzeBusy(false)
    }
  }

  // 저장 직후 자동분석(C안) — autoAnalyze일 때 마운트 1회만 실행(useRef 가드).
  // 실행 후 ?analyze=1을 URL에서 제거(history.replaceState — 재마운트·새로고침 시 재분석 방지).
  const autoRan = useRef(false)
  useEffect(() => {
    if (!autoAnalyze || autoRan.current || !hasBody) return
    autoRan.current = true
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/meeting-notes/${meetingNoteId}`)
    }
    void runAnalyze(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyze, hasBody, meetingNoteId])

  function toggle(key: string) {
    setChecked((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  const checkedTaskEventCount =
    (result?.tasks.filter((_, i) => checked.has(taskKey(i))).length ?? 0) +
    (result?.events.filter((_, i) => checked.has(eventKey(i))).length ?? 0)
  const checkedAttendeeCount =
    result?.attendees?.filter((_, i) => checked.has(attendeeKey(i))).length ?? 0
  const checkedApplyCount = checkedTaskEventCount + checkedAttendeeCount

  // 2단계: 요약 저장 + 선택 후보 반영을 한 번에 확정
  async function confirmAll() {
    if (confirmBusy) return
    setConfirmBusy(true); setErr(''); setInfo('')
    try {
      const saveRes = await saveMeetingSummary(meetingNoteId, { summary: summary.trim(), decisions: decisions.trim() })
      if (!saveRes.ok) { setErr(saveRes.error); return }

      let applyMsg = ''
      if (result && checkedTaskEventCount > 0) {
        const tasks = result.tasks.filter((_, i) => checked.has(taskKey(i)))
        const events = result.events.filter((_, i) => checked.has(eventKey(i)))
        const applyRes = await applyExtractedItems(meetingNoteId, {
          tasks: tasks.map((t) => ({ title: t.title })),
          events: events.map((e) => ({ title: e.title, suggested_date: e.suggested_date, suggested_time: e.suggested_time })),
        })
        if (!applyRes.ok) { setErr(`요약은 저장됐지만 반영에 실패했습니다: ${applyRes.error}`); router.refresh(); return }
        const evNote = applyRes.eventsCreated < events.length ? ` (일정 ${events.length - applyRes.eventsCreated}건은 날짜가 없어 제외)` : ''
        applyMsg += ` · 업무 ${applyRes.tasksCreated}건 · 일정 ${applyRes.eventsCreated}건 반영${evNote}`
      }

      // 선택된 참석자 후보를 기존 참석자에 합집합 반영(자동확정 금지 — 사용자 선택분만)
      if (result && checkedAttendeeCount > 0) {
        const picked = result.attendees.filter((_, i) => checked.has(attendeeKey(i)))
        // AI가 외부로 판단한 참석자는 동명이인 조직원과 자동매칭하지 않고 외부 텍스트로 저장(이름충돌 오매칭 방지)
        const externalForced = picked.filter((a) => a.affiliation === 'external').map((a) => a.name)
        const matchable = picked.filter((a) => a.affiliation !== 'external').map((a) => a.name)
        const { matched, unmatched } = matchAttendees(matchable, people)

        // 기존 user_ids + 신규 매칭 id 합집합
        const mergedIds = Array.from(new Set([...currentUserIds, ...matched.map((m) => m.id)]))
        // 기존 참석자 이름 + 신규(조직원 name + 외부 텍스트 + 외부확정) 합집합
        const mergedNames = Array.from(new Set([...currentAttendees, ...matched.map((m) => m.name), ...unmatched, ...externalForced]))

        const attRes = await updateMeetingNote(meetingNoteId, {
          attendees: mergedNames.length > 0 ? mergedNames : null,
          attendee_user_ids: mergedIds.length > 0 ? mergedIds : null,
        })
        if (!attRes.ok) { setErr(`요약은 저장됐지만 참석자 반영에 실패했습니다: ${attRes.error}`); router.refresh(); return }
        applyMsg += ` · 참석자 ${picked.length}명 반영(조직원 ${matched.length} · 외부 ${unmatched.length + externalForced.length})`
      }

      if (checkedApplyCount > 0) { setResult(null); setChecked(new Set()) }
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
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} aria-labelledby="mn-body-h">
      {/* 헤더: 제목 + [정제본|원본] 탭 + AI 분석 버튼 (별도 패널 없이 본문 카드에 일원화) */}
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
            <NbButton onClick={() => runAnalyze(false)} disabled={analyzeBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Sparkles size={15} /> {analyzeBusy ? '분석 중…' : 'AI 분석'}
            </NbButton>
          )}
        </div>
      </div>

      {!hasBody && (
        <p role="status" style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
          본문을 작성하면 AI 분석을 사용할 수 있습니다.
        </p>
      )}

      {/* 탭 본문: 정제본=요약·결정사항 편집면(SSOT) / 원본=RichText */}
      {tab === 'refined' ? (
        <div role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
        </div>
      ) : (
        <div role="tabpanel">
          <RichText html={body} placeholder="본문이 비어 있습니다." />
        </div>
      )}

      {err && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{err}</p>}
      {info && <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{info}</p>}

      {/* 추출 후보(선택형) — 본문 카드 하단 통합. 분석 후에만 노출. */}
      {result && (result.tasks.length > 0 || result.events.length > 0 || result.highlights.length > 0 || (result.attendees?.length ?? 0) > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: 'var(--hairline) solid var(--border-light)' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            <Sparkles size={14} color="var(--brand)" /> AI 추출 — 검토 후 반영
          </h3>
          {result.attendees && result.attendees.length > 0 && (
            <CandidateGroup icon={<Users size={14} color="var(--brand)" />} label="참석자 후보 → 참석자">
              {result.attendees.map((c, i) => {
                // 내부(조직원)/외부 구분 배지. AI가 외부로 판단하면 동명이인이라도 외부로 표기.
                const isMember = c.affiliation !== 'external' && peopleNameSet.has(normalizeName(c.name))
                return (
                  <CandidateRow
                    key={attendeeKey(i)}
                    selectable
                    checked={checked.has(attendeeKey(i))}
                    onToggle={() => toggle(attendeeKey(i))}
                    title={c.name}
                    confidence={c.confidence}
                    quote={c.source_quote}
                    hint={isMember ? '조직원' : '외부'}
                  />
                )
              })}
            </CandidateGroup>
          )}

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
        </div>
      )}

      {/* 단일 확정: 요약·결정사항 저장 + 선택 후보 반영 (저장 버튼 일원화) */}
      {hasBody && (
        <div>
          <NbButton onClick={confirmAll} disabled={confirmBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <CheckSquare size={15} /> {confirmLabel}
          </NbButton>
        </div>
      )}
    </section>
  )
}

// 본문 카드 헤더 탭(정제본/원본).
function BodyTab({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      style={{
        padding: 'var(--space-1) var(--space-3)',
        minHeight: 36,
        border: 'none',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        fontSize: 'var(--fs-sm)',
        fontWeight: selected ? 700 : 500,
        background: selected ? 'var(--surface-card)' : 'transparent',
        color: selected ? 'var(--text)' : 'var(--text-muted)',
        boxShadow: selected ? 'var(--shadow-sm)' : 'none',
      }}
    >
      {label}
    </button>
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
