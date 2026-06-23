// 날짜별 보기(일일업무 스타일) — meeting_at 기준 날짜 그룹 섹션 + 회의 카드.
import Link from 'next/link'
import { CalendarClock, Users } from 'lucide-react'
import { groupByMeetingDate } from '@/lib/meeting/group-by-date'
import type { MeetingListItemView } from './list-types'

const STATUS_META: Record<string, { label: string; status: 'done' | 'doing' | 'planned' }> = {
  draft: { label: '작성중', status: 'planned' },
  final: { label: '확정', status: 'done' },
  archived: { label: '보관', status: 'doing' },
}

function timeOf(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export default function MeetingDateView({ items, deptNameById }: { items: MeetingListItemView[]; deptNameById: Map<string, string> }) {
  const groups = groupByMeetingDate(items)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', padding: 'var(--space-5) var(--space-6)' }}>
      {groups.map((g) => (
        <section key={g.dateKey} aria-label={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', position: 'sticky', top: 0 }}>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>{g.label}</h3>
            <span className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>{g.items.length}건</span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {g.items.map((m) => {
              const meta = STATUS_META[m.status] ?? { label: m.status, status: 'planned' as const }
              const deptName = m.department_id ? deptNameById.get(m.department_id) : null
              const attendeeCount = (m.attendees?.length ?? 0)
              return (
                <li key={m.id}>
                  <Link href={`/meeting-notes/${m.id}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)', textDecoration: 'none', border: 'var(--hairline) solid var(--border-light)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      {m.meeting_at && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--brand)', whiteSpace: 'nowrap' }}>
                          <CalendarClock size={13} /> {timeOf(m.meeting_at)}
                        </span>
                      )}
                      <strong style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{m.title || '(제목 없음)'}</strong>
                      <span className="badge" data-status={meta.status} style={{ fontSize: 'var(--fs-2xs)' }}>{meta.label}</span>
                      {deptName && <span className="badge badge-indigo" style={{ fontSize: 'var(--fs-2xs)' }}>{deptName}</span>}
                      {attendeeCount > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                          <Users size={12} /> {attendeeCount}명
                        </span>
                      )}
                    </div>
                    {(m.summary || m.body_plain) && (
                      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {m.summary || m.body_plain}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
