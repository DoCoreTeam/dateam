'use client'

// AI 추출 후보 확정 모달 — 조회 화면의 [AI 분석] 액션이 띄움.
//  - 업무/일정/참석자 후보를 체크리스트로 보여주고 사용자가 선택분만 반영(§5-3 추출형 표준).
//  - 반영: applyExtractedItems(업무→daily, 일정→캘린더) + updateMeetingNote(참석자 합집합).
//  - 모달 표준(§2-2): useEscClose · X닫기 · tape-title · 광원형 shadow(--shadow-modal) · backdrop(--modal-backdrop).
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, CheckSquare, CalendarPlus, Star, Users } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { useEscClose } from '@/lib/use-esc-close'
import { applyExtractedItems, updateMeetingNote } from './actions'
import { matchAttendees, normalizeName } from '@/lib/meeting/match-attendees'

interface TaskCandidate { title: string; confidence: number; source_quote: string }
interface EventCandidate { title: string; confidence: number; source_quote: string; suggested_date: string | null; suggested_time: string | null }
interface HighlightCandidate { title: string; confidence: number; source_quote: string }
interface AttendeeCandidate { name: string; confidence: number; source_quote: string; affiliation: 'internal' | 'external' | 'unknown' }

export interface ExtractResult {
  tasks: TaskCandidate[]
  events: EventCandidate[]
  highlights: HighlightCandidate[]
  attendees: AttendeeCandidate[]
}

interface Props {
  meetingNoteId: string
  result: ExtractResult
  people: { id: string; name: string }[]
  currentAttendees: string[]
  currentUserIds: string[]
  onClose: () => void
}

const taskKey = (i: number) => `task-${i}`
const eventKey = (i: number) => `event-${i}`
const attendeeKey = (i: number) => `attendee-${i}`

export default function ExtractConfirmModal({
  meetingNoteId, result, people, currentAttendees, currentUserIds, onClose,
}: Props) {
  const router = useRouter()
  useEscClose(onClose)

  const peopleNameSet = useMemo(() => new Set(people.map((p) => normalizeName(p.name))), [people])

  // 기본 전체 선택
  const [checked, setChecked] = useState<Set<string>>(() => {
    const s = new Set<string>()
    result.tasks.forEach((_, i) => s.add(taskKey(i)))
    result.events.forEach((_, i) => s.add(eventKey(i)))
    result.attendees?.forEach((_, i) => s.add(attendeeKey(i)))
    return s
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function toggle(key: string) {
    setChecked((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  const checkedTaskEvent =
    result.tasks.filter((_, i) => checked.has(taskKey(i))).length +
    result.events.filter((_, i) => checked.has(eventKey(i))).length
  const checkedAttendee = result.attendees?.filter((_, i) => checked.has(attendeeKey(i))).length ?? 0
  const total = checkedTaskEvent + checkedAttendee

  async function confirm() {
    if (busy) return
    setBusy(true); setErr('')
    try {
      if (checkedTaskEvent > 0) {
        const tasks = result.tasks.filter((_, i) => checked.has(taskKey(i)))
        const events = result.events.filter((_, i) => checked.has(eventKey(i)))
        const res = await applyExtractedItems(meetingNoteId, {
          tasks: tasks.map((t) => ({ title: t.title })),
          events: events.map((e) => ({ title: e.title, suggested_date: e.suggested_date, suggested_time: e.suggested_time })),
        })
        if (!res.ok) { setErr(`반영에 실패했습니다: ${res.error}`); return }
      }

      if (checkedAttendee > 0) {
        const picked = result.attendees.filter((_, i) => checked.has(attendeeKey(i)))
        const externalForced = picked.filter((a) => a.affiliation === 'external').map((a) => a.name)
        const matchable = picked.filter((a) => a.affiliation !== 'external').map((a) => a.name)
        const { matched, unmatched } = matchAttendees(matchable, people)
        const mergedIds = Array.from(new Set([...currentUserIds, ...matched.map((m) => m.id)]))
        const mergedNames = Array.from(new Set([...currentAttendees, ...matched.map((m) => m.name), ...unmatched, ...externalForced]))
        const res = await updateMeetingNote(meetingNoteId, {
          attendees: mergedNames.length > 0 ? mergedNames : null,
          attendee_user_ids: mergedIds.length > 0 ? mergedIds : null,
        })
        if (!res.ok) { setErr(`참석자 반영에 실패했습니다: ${res.error}`); return }
      }

      router.refresh()
      onClose()
    } catch {
      setErr('반영에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mn-extract-h"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-modal)' as React.CSSProperties['zIndex'], background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}
    >
      <div
        className="card"
        style={{ width: 'min(640px, 100%)', maxHeight: '88vh', overflowY: 'auto', padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', boxShadow: 'var(--shadow-modal)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <h2 id="mn-extract-h" className="tape-title" style={{ margin: 0 }}>AI 추출 — 검토 후 반영</h2>
          <button type="button" onClick={onClose} aria-label="닫기"
            style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
            <X size={18} />
          </button>
        </div>

        {result.attendees && result.attendees.length > 0 && (
          <CandidateGroup icon={<Users size={14} color="var(--brand)" />} label="참석자 후보 → 참석자">
            {result.attendees.map((c, i) => {
              const isMember = c.affiliation !== 'external' && peopleNameSet.has(normalizeName(c.name))
              return (
                <CandidateRow key={attendeeKey(i)} selectable checked={checked.has(attendeeKey(i))} onToggle={() => toggle(attendeeKey(i))}
                  title={c.name} confidence={c.confidence} quote={c.source_quote} hint={isMember ? '조직원' : '외부'} />
              )
            })}
          </CandidateGroup>
        )}

        {result.tasks.length > 0 && (
          <CandidateGroup icon={<CheckSquare size={14} color="var(--brand)" />} label="업무 후보 → 일일업무">
            {result.tasks.map((c, i) => (
              <CandidateRow key={taskKey(i)} selectable checked={checked.has(taskKey(i))} onToggle={() => toggle(taskKey(i))}
                title={c.title} confidence={c.confidence} quote={c.source_quote} />
            ))}
          </CandidateGroup>
        )}

        {result.events.length > 0 && (
          <CandidateGroup icon={<CalendarPlus size={14} color="var(--brand)" />} label="일정 후보 → 캘린더">
            {result.events.map((c, i) => (
              <CandidateRow key={eventKey(i)} selectable checked={checked.has(eventKey(i))} onToggle={() => toggle(eventKey(i))}
                title={c.title} confidence={c.confidence} quote={c.source_quote}
                hint={[c.suggested_date, c.suggested_time].filter(Boolean).join(' ') || undefined} />
            ))}
          </CandidateGroup>
        )}

        {result.highlights.length > 0 && (
          <CandidateGroup icon={<Star size={14} color="var(--warning)" />} label="하이라이트 (표시 전용)">
            {result.highlights.map((c, i) => (
              <CandidateRow key={`hl-${i}`} selectable={false} title={c.title} confidence={c.confidence} quote={c.source_quote} />
            ))}
          </CandidateGroup>
        )}

        {err && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>닫기</NbButton>
          <NbButton onClick={confirm} disabled={busy || total === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <CheckSquare size={15} /> {busy ? '반영 중…' : `선택 ${total}건 반영`}
          </NbButton>
        </div>
      </div>
    </div>
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

function CandidateRow({ selectable, checked, onToggle, title, confidence, quote, hint }: {
  selectable: boolean; checked?: boolean; onToggle?: () => void; title: string; confidence: number; quote: string; hint?: string
}) {
  return (
    <li style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)' }}>
      {selectable && (
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`${title} 선택`} style={{ marginTop: 4 }} />
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
