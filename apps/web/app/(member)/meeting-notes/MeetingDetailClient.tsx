'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Pencil, CalendarClock } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
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
        {/* 본문 카드(일원화): [정제본|원본] 탭 + AI 분석 버튼 + 추출 후보를 한 카드에 통합 */}
        <MeetingAiPanel
          meetingNoteId={note.id}
          body={note.body}
          bodyPlain={note.body_plain ?? ''}
          initialSummary={note.summary ?? ''}
          initialDecisions={note.decisions ?? ''}
          people={people}
          currentAttendees={splitAttendees(note.attendees)}
          currentUserIds={note.attendee_user_ids ?? []}
          autoAnalyze={autoAnalyze}
        />

        {/* 참석자 관리(내부=조직원/외부=텍스트) */}
        <AttendeesPanel
          noteId={note.id}
          initialAttendees={splitAttendees(note.attendees)}
          initialUserIds={note.attendee_user_ids ?? []}
          people={people}
        />
      </div>
    </div>
  )
}
