'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Pencil, Trash2, CalendarClock, Users } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import MeetingEditor from './MeetingEditor'
import MeetingReadBody from './MeetingReadBody'
import { deleteMeetingNote } from './actions'

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
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function splitAttendees(raw: string | null): string[] {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export default function MeetingDetailClient({ note, people }: { note: MeetingNoteRecord; people: { id: string; name: string }[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [deleting, startDelete] = useTransition()
  const autoAnalyze = useSearchParams().get('analyze') === '1'

  const attendeeNames = useMemo(() => splitAttendees(note.attendees), [note.attendees])
  const userIds = useMemo(() => note.attendee_user_ids ?? [], [note.attendee_user_ids])

  // 읽기용 칩 분류: user_ids→조직원(indigo), 그 외 이름→외부(slate).
  const { memberChips, externalChips } = useMemo(() => {
    const byId = new Map(people.map((p) => [p.id, p.name] as const))
    const mem: { id: string; name: string }[] = []
    const memNames = new Set<string>()
    for (const id of userIds) {
      const name = byId.get(id)
      if (name) { mem.push({ id, name }); memNames.add(name) }
    }
    return { memberChips: mem, externalChips: attendeeNames.filter((n) => !memNames.has(n)) }
  }, [people, userIds, attendeeNames])

  function handleDelete() {
    if (!confirm(`회의노트 "${note.title || '(제목 없음)'}"을(를) 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    startDelete(async () => {
      try {
        const res = await deleteMeetingNote(note.id)
        if (!res.ok) { alert(res.error); return }
        router.push('/meeting-notes')
        router.refresh()
      } catch {
        alert('삭제에 실패했습니다.')
      }
    })
  }

  if (editing) {
    return (
      <div>
        <PageHeader title="회의노트 편집" description="제목·일시·부서·본문과 요약·결정사항·참석자·태그를 수정하세요" />
        <MeetingEditor
          mode="edit"
          onExit={() => setEditing(false)}
          initial={{
            id: note.id,
            title: note.title,
            meeting_at: note.meeting_at,
            department_id: note.department_id,
            tags: note.tags ?? [],
            body: note.body ?? '',
            summary: note.summary ?? '',
            decisions: note.decisions ?? '',
            attendees: attendeeNames,
            attendeeUserIds: userIds,
          }}
        />
      </div>
    )
  }

  const meta = STATUS_META[note.status] ?? { label: note.status, status: 'planned' as const }
  const isEmptyAttendees = memberChips.length === 0 && externalChips.length === 0

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
            <NbButton variant="danger" onClick={handleDelete} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Trash2 size={15} /> {deleting ? '삭제 중…' : '삭제'}
            </NbButton>
          </div>
        }
      />

      {/* 메타 (읽기) */}
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
        {/* 본문(읽기) + AI 분석 액션 */}
        <MeetingReadBody
          meetingNoteId={note.id}
          body={note.body}
          bodyPlain={note.body_plain ?? ''}
          initialSummary={note.summary ?? ''}
          initialDecisions={note.decisions ?? ''}
          people={people}
          currentAttendees={attendeeNames}
          currentUserIds={userIds}
          autoAnalyze={autoAnalyze}
        />

        {/* 참석자(읽기 전용 chips) — 수정은 [편집]에서 */}
        <section className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} aria-labelledby="mn-att-h">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Users size={16} color="var(--brand)" />
            <h2 id="mn-att-h" className="tape-title" style={{ margin: 0 }}>참석자</h2>
          </div>
          {isEmptyAttendees ? (
            <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>등록된 참석자가 없습니다. [편집]에서 추가하세요.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {memberChips.map((m) => (
                <li key={`mem-${m.id}`}><span className="badge badge-indigo">{m.name}</span></li>
              ))}
              {externalChips.map((name) => (
                <li key={`ext-${name}`}><span className="badge badge-slate">{name}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
