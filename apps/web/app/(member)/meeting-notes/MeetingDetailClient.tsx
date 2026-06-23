'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Pencil, CalendarClock } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import RichText from '@/components/ui/RichText'
import NbButton from '@/components/ui/nb/NbButton'
import MeetingEditor from './MeetingEditor'
import MeetingAiPanel from './MeetingAiPanel'
import AttendeesPanel from './AttendeesPanel'

export interface MeetingNoteRecord {
  id: string
  title: string
  meeting_at: string | null
  status: string
  attendees: string | null
  attendee_user_ids: string[] | null
  department_id: string | null
  tags: string[] | null
  body: string | null // HTML
  body_plain: string | null
  summary: string | null
  decisions: string | null
  created_at: string
}

const STATUS_META: Record<string, { label: string; status: 'done' | 'doing' | 'planned' }> = {
  draft: { label: '작성중', status: 'planned' },
  final: { label: '확정', status: 'done' },
  archived: { label: '보관', status: 'doing' },
}

function formatMeetingAt(value: string | null): string {
  if (!value) return '일시 미지정'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '일시 미지정'
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// 콤마 문자열(getMeetingNote 반환) → 이름 배열
function splitAttendees(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export default function MeetingDetailClient({ note, people }: { note: MeetingNoteRecord; people: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState(false)
  // 저장 직후 자동분석(C안): MeetingEditor가 ?analyze=1로 이동시킴 → AI 패널이 1회 자동 실행.
  const autoAnalyze = useSearchParams().get('analyze') === '1'

  if (editing) {
    return (
      <div>
        <PageHeader title="회의노트 편집" description="내용을 수정한 뒤 변경을 저장하세요" />
        <MeetingEditor
          mode="edit"
          initial={{
            id: note.id,
            title: note.title,
            meeting_at: note.meeting_at,
            department_id: note.department_id,
            tags: note.tags ?? [],
            body: note.body ?? '',
          }}
        />
      </div>
    )
  }

  const meta = STATUS_META[note.status] ?? { label: note.status, status: 'planned' as const }

  return (
    <div>
      <PageHeader
        title={note.title || '(제목 없음)'}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Link href="/meeting-notes" className="btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', minHeight: 44 }}>
              <ArrowLeft size={15} /> 목록
            </Link>
            <NbButton onClick={() => setEditing(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Pencil size={15} /> 편집
            </NbButton>
          </div>
        }
      />

      {/* 메타 */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <span className="badge" data-status={meta.status}>{meta.label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          <CalendarClock size={14} color="var(--text-faint)" /> {formatMeetingAt(note.meeting_at)}
        </span>
        {note.tags && note.tags.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            {note.tags.map((t) => <span key={t} className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>#{t}</span>)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {/* 본문 — AI 정제본(기본) / 원본 탭. 정제본 없으면 원본 폴백. */}
        <BodySection
          body={note.body}
          summary={note.summary}
          decisions={note.decisions}
        />

        {/* 참석자 관리(내부=조직원/외부=텍스트) */}
        <AttendeesPanel
          noteId={note.id}
          initialAttendees={splitAttendees(note.attendees)}
          initialUserIds={note.attendee_user_ids ?? []}
          people={people}
        />

        {/* AI 정제·추출 패널 */}
        <MeetingAiPanel
          meetingNoteId={note.id}
          bodyPlain={note.body_plain ?? ''}
          initialSummary={note.summary ?? ''}
          initialDecisions={note.decisions ?? ''}
          people={people}
          currentAttendees={splitAttendees(note.attendees)}
          currentUserIds={note.attendee_user_ids ?? []}
          autoAnalyze={autoAnalyze}
        />
      </div>
    </div>
  )
}

// 본문 표시: [정제본 | 원본] 탭. 정제본(summary)이 있으면 기본 정제본, 없으면 원본 폴백.
// 정제본 = AI 요약(summary) + 결정사항(decisions), plain text. 원본 = body_html(RichText).
function BodySection({ body, summary, decisions }: { body: string | null; summary: string | null; decisions: string | null }) {
  const hasRefined = Boolean(summary?.trim() || decisions?.trim())
  const [tab, setTab] = useState<'refined' | 'original'>(hasRefined ? 'refined' : 'original')
  // 저장 직후 자동분석 → router.refresh()는 컴포넌트를 리마운트하지 않으므로(초기 useState 미적용),
  // 정제본이 처음 생기는 순간 기본 탭을 정제본으로 전환한다("정제본 기본표시" 요구). 이후 사용자가
  // 원본을 고르면 hasRefined가 그대로라 이 effect는 재발화하지 않아 사용자 선택이 유지된다.
  useEffect(() => {
    if (hasRefined) setTab('refined')
  }, [hasRefined])
  const active = !hasRefined ? 'original' : tab

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)' }} aria-labelledby="mn-body-h">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <h2 id="mn-body-h" className="tape-title" style={{ margin: 0 }}>회의 본문</h2>
        {hasRefined && (
          <div role="tablist" aria-label="본문 보기 전환" style={{ display: 'inline-flex', gap: 'var(--space-1)', padding: 'var(--space-1)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)' }}>
            <BodyTab label="AI 정제본" selected={active === 'refined'} onClick={() => setTab('refined')} />
            <BodyTab label="원본" selected={active === 'original'} onClick={() => setTab('original')} />
          </div>
        )}
      </div>

      {active === 'refined' ? (
        <div role="tabpanel">
          {summary?.trim() && (
            <div style={{ marginBottom: decisions?.trim() ? 'var(--space-4)' : 0 }}>
              <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>요약</h3>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 'var(--fs-base)', lineHeight: 1.7 }}>{summary}</p>
            </div>
          )}
          {decisions?.trim() && (
            <div>
              <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>결정사항</h3>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 'var(--fs-base)', lineHeight: 1.7 }}>{decisions}</p>
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel">
          <RichText html={body} placeholder="본문이 비어 있습니다." />
        </div>
      )}
    </section>
  )
}

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
