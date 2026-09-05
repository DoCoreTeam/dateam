import Link from 'next/link'
import { NotebookPen, Plus, Users } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { listMeetingNotes, getMeetingDepartments } from './actions'
import MeetingViewTabs from './MeetingViewTabs'
import MeetingDateView from './MeetingDateView'
import MeetingCalendarView from './MeetingCalendarView'
import MeetingListView from './MeetingListView'
import { MEETING_LIST_DEFAULTS } from './list-defaults'
import type { MeetingListItemView } from './list-types'
import { resolveListQuery } from '@/lib/ui/list-query'
import { loadListPrefs } from '@/lib/ui/ui-preferences'

export const dynamic = 'force-dynamic'

// 날짜별·캘린더 뷰는 페이지 없이 한 번에 그룹핑 — 개인 노트 상한.
const BULK_SIZE = 100

type ViewMode = 'list' | 'date' | 'calendar'

interface SearchParams {
  q?: string
  sort?: string
  dir?: string
  filter?: string
  page?: string
  size?: string
  view?: string
  mode?: string
  ym?: string
}

function currentYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default async function MeetingNotesPage({ searchParams }: { searchParams: SearchParams }) {
  // 목록 상태 SSOT — 서버도 클라이언트와 같은 규칙(URL > 저장설정 > 기본값)으로 접는다
  const saved = await loadListPrefs('/meeting-notes').catch(() => null)
  const query = resolveListQuery(searchParams as Record<string, string | undefined>, MEETING_LIST_DEFAULTS, saved)

  const mode: ViewMode = query.filters.mode === 'date' ? 'date' : query.filters.mode === 'calendar' ? 'calendar' : 'list'
  const ym = query.filters.ym ?? currentYm()
  const filter = query.filters.filter ?? 'all'
  const limitWanted = mode === 'list' ? query.size : BULK_SIZE

  let items: MeetingListItemView[] = []
  let total = 0
  let loadError: string | null = null
  let deptNames: Record<string, string> = {}

  try {
    const [result, depts] = await Promise.all([
      listMeetingNotes({ q: query.q, sort: query.sort.key, dir: query.sort.dir, filter, page: query.page, limit: limitWanted }),
      getMeetingDepartments().catch(() => []),
    ])
    items = (result?.items ?? []) as MeetingListItemView[]
    total = result?.total ?? 0
    deptNames = Object.fromEntries(depts.map((d) => [d.id, d.name]))
  } catch {
    loadError = '회의노트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }

  return (
    <div>
      <PageHeader
        title="회의노트"
        description="회의 기록을 정리하고 AI로 요약·업무 추출까지 한 번에"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'nowrap' }}>
            {/* 지난 회의에 적어 둔 이름을 영업 CRM 인물로 잇는 자리 — 안 만들면 옛 이름은 영영 글자로 남는다 */}
            <Link href="/meeting-notes/attendees" className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', textDecoration: 'none', minHeight: 44 }}>
              <Users size={16} /> 지난 회의에서 사람 찾기
            </Link>
            <Link href="/meeting-notes/new" className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', textDecoration: 'none', minHeight: 44 }}>
              <Plus size={16} /> 새 회의노트
            </Link>
          </div>
        }
      />

      <div className="card card-flush">
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <NotebookPen size={16} color="var(--brand)" />
            <h2 className="tape-title" style={{ margin: 0 }}>내 회의노트</h2>
          </div>
          <MeetingViewTabs mode={mode} />
        </div>

        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <MeetingListView
            items={items}
            total={total}
            deptNames={deptNames}
            loadError={loadError}
            mode={mode}
            saved={saved}
          >
            {mode === 'date'
              ? <MeetingDateView items={items} deptNameById={new Map(Object.entries(deptNames))} />
              : mode === 'calendar'
                ? <MeetingCalendarView items={items} ym={ym} q={query.q} sort={query.sort.key} dir={query.sort.dir} filter={filter} />
                : undefined}
          </MeetingListView>
        </div>
      </div>
    </div>
  )
}
