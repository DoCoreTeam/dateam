'use client'

// app/(member)/meeting-notes/MeetingListView.tsx — 회의노트 목록 표현 계층
// 목록 표준(§2-6): 검색·정렬·상태필터·페이지는 URL이 진실(useListQuery)이고,
// 그리는 건 ListToolbar/ListSurface/ListPager 한 벌뿐이다. 데이터는 서버(page.tsx)가 준다.

import type { ReactNode } from 'react'
import { noteStatusMeta } from '@/lib/meeting/ui/note-status'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, Users } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { SavedListPrefs } from '@/lib/ui/list-query'
// 기본값은 서버(page.tsx)도 읽는다 — 'use client' 밖에 둬야 RSC 경계를 안 넘는다
import { MEETING_LIST_DEFAULTS } from './list-defaults'
import type { MeetingListItemView } from './list-types'


const SORT_OPTIONS = [
  { key: 'meeting_at', label: '회의일시' },
  { key: 'created_at', label: '작성일' },
  { key: 'title', label: '제목' },
]

const FILTERS = [{
  key: 'filter',
  label: '상태',
  options: [
    { value: 'draft', label: '작성중' },
    { value: 'final', label: '확정' },
    { value: 'archived', label: '보관' },
  ],
}]


function formatMeetingAt(value: string | null): string {
  if (!value) return '일시 미지정'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '일시 미지정'
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  items: MeetingListItemView[]
  total: number
  deptNames: Record<string, string>
  loadError: string | null
  /** 리스트 이외(날짜별·캘린더)는 본문을 서버에서 받아 그대로 끼운다 */
  mode: 'list' | 'date' | 'calendar'
  saved: SavedListPrefs | null
  children?: ReactNode
}

export default function MeetingListView({ items, total, deptNames, loadError, mode, saved, children }: Props) {
  const router = useRouter()
  const { query, set } = useListQuery(MEETING_LIST_DEFAULTS, { saved, persistKey: '/meeting-notes' })

  const columns: ColumnDef<MeetingListItemView>[] = [
    {
      key: 'title', header: '제목 · 부서 · 참석자', primary: true, sortable: 'title',
      cell: (m) => {
        const deptName = m.department_id ? deptNames[m.department_id] : null
        const attendees = m.attendees ?? []
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', width: '100%' }}>
            <Link href={`/meeting-notes/${m.id}`} onClick={(e) => e.stopPropagation()}
              style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none', fontSize: 'var(--fs-md)' }}>
              {m.title || '(제목 없음)'}
            </Link>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center' }}>
              {deptName && <span className="badge badge-indigo" style={{ fontSize: 'var(--fs-2xs)' }}>{deptName}</span>}
              {attendees.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
                  <Users size={11} /> {attendees.slice(0, 3).join(', ')}{attendees.length > 3 ? ` 외 ${attendees.length - 3}` : ''}
                </span>
              )}
              {m.tags?.slice(0, 3).map((t) => (
                <span key={t} className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>#{t}</span>
              ))}
            </div>
          </div>
        )
      },
    },
    {
      key: 'meeting_at', header: '회의일시', sortable: 'meeting_at',
      cell: (m) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: 'var(--fs-sm)', color: m.meeting_at ? 'var(--text)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>
          <CalendarClock size={13} color="var(--text-faint)" style={{ flexShrink: 0 }} /> {formatMeetingAt(m.meeting_at)}
        </span>
      ),
    },
    {
      key: 'status', header: '상태',
      cell: (m) => {
        const meta = noteStatusMeta(m.status)
        return <span className="badge" data-status={meta.status}>{meta.label}</span>
      },
    },
    {
      key: 'summary', header: '요약', hideOnCard: true,
      cell: (m) => m.summary
        ? <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.summary}</span>
        : m.body_plain
          ? <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.body_plain}</span>
          : <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>-</span>,
    },
  ]

  const hasCondition = Boolean(query.q) || Boolean(query.filters.filter)

  return (
    <>
      {/* 캘린더는 월 단위라 검색·정렬 도구를 두지 않는다 */}
      {mode !== 'calendar' && (
        <ListToolbar
          query={query}
          onChange={set}
          searchPlaceholder="제목·본문 검색"
          filters={FILTERS}
          sortOptions={SORT_OPTIONS}
          views={['table']}
          showSize={mode === 'list'}
          total={total}
        />
      )}

      {children ?? (
        <>
          <ListSurface
            rows={items}
            columns={columns}
            query={query}
            rowKey={(m) => m.id}
            onChange={set}
            error={loadError ? { message: loadError, onRetry: () => router.refresh() } : null}
            empty={hasCondition
              ? { title: '조건에 맞는 회의노트가 없어요', description: '검색어나 상태 필터를 바꿔보세요' }
              : { title: '아직 회의노트가 없어요', description: '회의 내용을 남기면 AI가 요약·업무 추출까지 도와줍니다', action: { label: '첫 회의노트 작성', href: '/meeting-notes/new' } }}
            onRowClick={(m) => router.push(`/meeting-notes/${m.id}`)}
          />
          <ListPager query={query} total={total} onChange={set} />
        </>
      )}
    </>
  )
}
