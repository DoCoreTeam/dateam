'use client'

// 회의노트 목록 뷰 모드 토글 — [리스트 | 날짜별 | 캘린더].
// 탭은 SegmentedTabs(렌더러 SSOT)만 그린다. 여기선 ?mode= 링크만 만든다.
// 현재 URL 파라미터(검색·정렬·필터)는 통째로 보존한다 — 탭을 옮겼다고 조건이 날아가면 안 된다.
import { useSearchParams } from 'next/navigation'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { List, CalendarDays, CalendarRange } from 'lucide-react'

type ViewMode = 'list' | 'date' | 'calendar'

interface Props {
  mode: ViewMode
}

const VIEWS: { value: ViewMode; label: string; icon: typeof List }[] = [
  { value: 'list', label: '리스트', icon: List },
  { value: 'date', label: '날짜별', icon: CalendarDays },
  { value: 'calendar', label: '캘린더', icon: CalendarRange },
]

export default function MeetingViewTabs({ mode }: Props) {
  const searchParams = useSearchParams()

  function href(v: ViewMode): string {
    const params = new URLSearchParams(searchParams.toString())
    if (v === 'list') params.delete('mode')
    else params.set('mode', v)
    params.delete('page') // 보기를 바꾸면 1페이지부터
    const qs = params.toString()
    return `/meeting-notes${qs ? `?${qs}` : ''}`
  }

  return (
    <SegmentedTabs
      ariaLabel="보기 모드"
      tabs={VIEWS.map(({ value, label, icon: Icon }) => ({
        id: value, label, href: href(value), icon: <Icon size={14} />,
      }))}
      activeId={mode}
    />
  )
}
