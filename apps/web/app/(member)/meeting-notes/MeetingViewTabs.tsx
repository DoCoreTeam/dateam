'use client'

// 회의노트 목록 뷰 모드 토글 — [리스트 | 날짜별 | 캘린더]. q/sort/filter 보존 + ?view= URL 동기화.
import Link from 'next/link'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { List, CalendarDays, CalendarRange } from 'lucide-react'

interface Props {
  view: 'list' | 'date' | 'calendar'
  q: string
  sort: string
  filter: string
}

const VIEWS: { value: 'list' | 'date' | 'calendar'; label: string; icon: typeof List }[] = [
  { value: 'list', label: '리스트', icon: List },
  { value: 'date', label: '날짜별', icon: CalendarDays },
  { value: 'calendar', label: '캘린더', icon: CalendarRange },
]

export default function MeetingViewTabs({ view, q, sort, filter }: Props) {
  function href(v: string): string {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (sort !== 'recent') params.set('sort', sort)
    if (filter !== 'all') params.set('filter', filter)
    if (v !== 'list') params.set('view', v)
    const qs = params.toString()
    return `/meeting-notes${qs ? `?${qs}` : ''}`
  }

  return (
    <SegmentedTabs
      ariaLabel="보기 모드"
      tabs={VIEWS.map(({ value, label, icon: Icon }) => ({
        id: value, label, href: href(value), icon: <Icon size={14} />,
      }))}
      activeId={view}
    />
  )
}
