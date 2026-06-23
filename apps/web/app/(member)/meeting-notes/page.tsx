import Link from 'next/link'
import { NotebookPen, Plus, CalendarClock } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { listMeetingNotes } from './actions'
import MeetingListFilters from './MeetingListFilters'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

// 회의노트 상태 → 뱃지 표시 (badge[data-status] 토큰 재사용)
const STATUS_META: Record<string, { label: string; status: 'done' | 'doing' | 'planned' }> = {
  draft: { label: '작성중', status: 'planned' },
  final: { label: '확정', status: 'done' },
  archived: { label: '보관', status: 'doing' },
}

interface SearchParams {
  q?: string
  sort?: string
  filter?: string
  page?: string
}

interface MeetingNoteItem {
  id: string
  title: string
  meeting_at: string | null
  status: string
  summary: string | null
  body_plain: string | null
  created_at: string
  department_id: string | null
  tags: string[] | null
}

function formatMeetingAt(value: string | null): string {
  if (!value) return '일시 미지정'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '일시 미지정'
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default async function MeetingNotesPage({ searchParams }: { searchParams: SearchParams }) {
  const q = searchParams.q?.trim() ?? ''
  const sort = searchParams.sort ?? 'recent'
  const filter = searchParams.filter ?? 'all'
  const page = Math.max(1, Number(searchParams.page) || 1)

  let items: MeetingNoteItem[] = []
  let total = 0
  let limit = PAGE_SIZE
  let loadError: string | null = null

  try {
    const result = await listMeetingNotes({ q, sort, filter, page, limit: PAGE_SIZE })
    items = (result?.items ?? []) as MeetingNoteItem[]
    total = result?.total ?? 0
    limit = result?.limit ?? PAGE_SIZE
  } catch {
    loadError = '회의노트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const hasFilters = Boolean(q) || filter !== 'all' || sort !== 'recent'

  function pageHref(target: number): string {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (sort !== 'recent') params.set('sort', sort)
    if (filter !== 'all') params.set('filter', filter)
    if (target > 1) params.set('page', String(target))
    const qs = params.toString()
    return `/meeting-notes${qs ? `?${qs}` : ''}`
  }

  return (
    <div>
      <PageHeader
        title="회의노트"
        description="회의 기록을 정리하고 AI로 요약·업무 추출까지 한 번에"
        actions={
          <Link
            href="/meeting-notes/new"
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)', minHeight: 44 }}
          >
            <Plus size={16} /> 새 회의노트
          </Link>
        }
      />

      <div className="card">
        <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: 'var(--border-w-2) solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <NotebookPen size={16} color="var(--brand)" />
          <h2 className="tape-title" style={{ margin: 0 }}>전체 회의노트</h2>
          <span className="badge badge-slate">
            {total}{hasFilters ? '건 (필터됨)' : '건'}
          </span>
        </div>

        <MeetingListFilters q={q} sort={sort} filter={filter} />

        {loadError ? (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-12) var(--space-4)', color: 'var(--danger)', textAlign: 'center', gap: 'var(--space-3)' }}>
            <p style={{ margin: 0 }}>{loadError}</p>
            <Link href="/meeting-notes" className="btn-ghost" style={{ textDecoration: 'none', padding: 'var(--space-2) var(--space-4)' }}>다시 시도</Link>
          </div>
        ) : items.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--space-12) var(--space-4)', color: 'var(--text-faint)', fontSize: 'var(--fs-base)', textAlign: 'center', gap: 'var(--space-3)' }}>
            <NotebookPen size={36} style={{ opacity: 0.3 }} />
            <p style={{ margin: 0 }}>{hasFilters ? '검색 결과가 없습니다' : '아직 작성된 회의노트가 없습니다'}</p>
            {!hasFilters && (
              <Link href="/meeting-notes/new" className="btn-primary" style={{ textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Plus size={15} /> 첫 회의노트 작성
              </Link>
            )}
          </div>
        ) : (
          <table className="table-base table-card" style={{ tableLayout: 'fixed' }}>
            {/* 컬럼폭 고정: 요약 컬럼이 폭을 독식해 제목·일시·상태가 줄바꿈되던 회귀 방지.
                전역 .table-base(table-layout:auto)는 다른 테이블에 영향 가므로 이 테이블에만 fixed 적용. */}
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '200px' }} />
              <col style={{ width: '88px' }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>제목</th>
                <th>회의일시</th>
                <th>상태</th>
                <th>요약</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => {
                const meta = STATUS_META[m.status] ?? { label: m.status, status: 'planned' as const }
                return (
                  <tr key={m.id}>
                    <td className="card-header">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', width: '100%' }}>
                        <Link href={`/meeting-notes/${m.id}`} style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none', fontSize: 'var(--fs-md)' }}>
                          {m.title || '(제목 없음)'}
                        </Link>
                        {m.tags && m.tags.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                            {m.tags.slice(0, 4).map((t) => (
                              <span key={t} className="badge badge-slate" style={{ fontSize: 'var(--fs-2xs)' }}>#{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td data-label="회의일시">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: 'var(--fs-sm)', color: m.meeting_at ? 'var(--text)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        <CalendarClock size={13} color="var(--text-faint)" style={{ flexShrink: 0 }} /> {formatMeetingAt(m.meeting_at)}
                      </span>
                    </td>
                    <td data-label="상태">
                      <span className="badge" data-status={meta.status}>{meta.label}</span>
                    </td>
                    <td data-label="요약">
                      {m.summary ? (
                        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {m.summary}
                        </span>
                      ) : m.body_plain ? (
                        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {m.body_plain}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--border-subtle)', fontSize: 'var(--fs-sm)' }}>-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {!loadError && totalPages > 1 && (
          <nav aria-label="페이지 이동" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-6)', borderTop: 'var(--border-w-2) solid var(--border-color)' }}>
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="btn-ghost" style={{ textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>이전</Link>
            ) : (
              <span className="btn-ghost" aria-disabled style={{ padding: 'var(--space-2) var(--space-4)', minHeight: 44, display: 'inline-flex', alignItems: 'center', opacity: 0.4, cursor: 'not-allowed' }}>이전</span>
            )}
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="btn-ghost" style={{ textDecoration: 'none', padding: 'var(--space-2) var(--space-4)', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>다음</Link>
            ) : (
              <span className="btn-ghost" aria-disabled style={{ padding: 'var(--space-2) var(--space-4)', minHeight: 44, display: 'inline-flex', alignItems: 'center', opacity: 0.4, cursor: 'not-allowed' }}>다음</span>
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
