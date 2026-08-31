'use client'

// app/(ci)/ci/publish/PublishView.tsx — B01 게시 목록
//
// 목록 표준(§2-6)을 쓴다. 예전에는 화면이 <table>을 직접 짜고 검색·정렬이 아예 없어서
// 게시 건이 쌓이면 원하는 줄을 눈으로 찾아야 했다. 이제 검색·필터·정렬·페이지가
// URL에 남아 새로고침·공유가 그대로 성립한다.
// 데이터는 그대로 서버 컴포넌트가 한 번에 넘긴다(최대 100건) — 표현 계층만 표준으로 옮겼다.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse, CiChannelListItem } from '@/lib/ci/contracts'
import { CI_PLATFORMS, CI_PLATFORM_LABEL, type CiPlatform } from '@/lib/ci/types'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import ErrorState from '@/components/ui/ErrorState'
import DateField from '@/components/ui/DateField'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import ConfirmDeleteDialog from '@/components/ui/ConfirmDeleteDialog'
import { useCiDelete } from '@/lib/ci/use-delete'

interface PubRow {
  id: string
  platform: CiPlatform
  route: 'manual' | 'api'
  status: string
  scheduled_at: string | null
  published_at: string | null
  published_url: string | null
  error_code: string | null
  error_message: string | null
}

const STATUS_LABEL: Record<string, string> = {
  draft: '작성 중', scheduled: '예약됨', exported: '내보냄', published: '게시됨', failed: '실패',
}

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'when', dir: 'desc' },
  view: 'table',
  filterKeys: ['status', 'platform'],
}

const SORT_OPTIONS = [
  { key: 'when', label: '예약·게시' },
  { key: 'platform', label: '플랫폼' },
  { key: 'status', label: '상태' },
]

const FILTERS: ListFilterDef[] = [
  { key: 'status', label: '상태', options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })) },
  { key: 'platform', label: '플랫폼', options: CI_PLATFORMS.map((p) => ({ value: p, label: CI_PLATFORM_LABEL[p] })) },
]

/** 정렬 키 하나로 표 헤더와 도구줄이 같은 순서를 낸다 — 뷰마다 다시 짜지 않는다. */
function sortValue(row: PubRow, key: string): string {
  if (key === 'platform') return CI_PLATFORM_LABEL[row.platform] ?? row.platform
  if (key === 'status') return STATUS_LABEL[row.status] ?? row.status
  return row.published_at ?? row.scheduled_at ?? ''
}

export default function PublishView({
  workspaceId, items, ownedChannels,
}: { workspaceId: string; items: PubRow[]; ownedChannels: CiChannelListItem[] }) {
  const router = useRouter()
  const del_ = useCiDelete(workspaceId, () => router.refresh())
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/ci/publish' })
  const [platform, setPlatform] = useState<CiPlatform>('youtube')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('18:00')
  const [urlById, setUrlById] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  async function addItem() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({
          platform,
          channelId: ownedChannels.find((c) => c.platform === platform)?.id ?? null,
          ...(date ? { scheduledDate: date, scheduledTime: time } : {}),
        }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setDate('')
      router.refresh()
    } finally { setBusy(false) }
  }

  async function recordUrl(id: string) {
    const url = (urlById[id] ?? '').trim()
    if (!url) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/ci/publications/${id}/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ url }),
      }).then((r) => r.json() as Promise<ApiResponse<{ message: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setUrlById((m) => ({ ...m, [id]: '' }))
      router.refresh()
    } finally { setBusy(false) }
  }

  const columns = useMemo<ColumnDef<PubRow>[]>(() => [
    {
      key: 'platform', header: '플랫폼', primary: true, sortable: true,
      cell: (p) => CI_PLATFORM_LABEL[p.platform],
    },
    {
      key: 'status', header: '상태', sortable: true,
      cell: (p) => (
        <>
          <span className={p.status === 'published' ? 'ci-status ci-status-ok'
            : p.status === 'failed' ? 'ci-status ci-status-danger' : 'ci-status ci-status-neutral'}>
            {STATUS_LABEL[p.status] ?? p.status}
          </span>
          {p.error_message && <span className="error-state-code"> {p.error_code}: {p.error_message}</span>}
        </>
      ),
    },
    {
      key: 'when', header: '예약·게시', sortable: true,
      cell: (p) => (p.published_at ? formatKstDateTimeShort(p.published_at)
        : p.scheduled_at ? formatKstDateTimeShort(p.scheduled_at)
        : <span className="ci-basis">미정</span>),
    },
    {
      key: 'url', header: '게시 주소',
      cell: (p) => (p.published_url
        ? <a href={p.published_url} target="_blank" rel="noreferrer">원본 열기</a>
        : <span className="ci-basis">아직 기록 전</span>),
    },
    {
      key: 'action', header: '작업',
      // 이미 기록된 건은 할 일이 없다. 카드/모바일에서는 셀이 비면 '작업' 레이블만 덩그러니 남으므로
      // 같은 행의 다른 칸(미정·아직 기록 전)과 같은 방식으로 "없음"을 명시한다.
      cell: (p) => (p.published_url ? (
        // 이미 기록된 건도 잘못 올렸으면 없앨 수 있어야 한다.
        // 지우는 것은 **우리 기록**이고 플랫폼의 실제 게시물은 그대로다(대화상자가 밝힌다).
        <span onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn-ghost"
            onClick={() => del_.ask({ kind: 'publication', id: p.id, title: '이 게시 기록을 삭제할까요?' })}
            aria-label="게시 기록 삭제" title="삭제">삭제</button>
        </span>
      ) : (
        <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="label" htmlFor={`u-${p.id}`} style={{ position: 'absolute', left: '-9999px' }}>게시 주소</label>
          <input className="input-field" id={`u-${p.id}`}
            value={urlById[p.id] ?? ''}
            onChange={(e) => setUrlById((m) => ({ ...m, [p.id]: e.target.value }))}
            placeholder="올린 주소 붙여넣기" style={{ minWidth: '200px' }}
          />
          <button type="button" className="btn-primary" onClick={() => recordUrl(p.id)} disabled={busy}>
            추적 시작
          </button>
        </span>
      )),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [urlById, busy])

  // 서버가 100건을 한 번에 넘기는 목록이라 걸러내기·정렬·자르기는 여기서 한다(§2-6 전체보유 목록).
  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const rows = items.filter((p) => {
      if (query.filters.status && p.status !== query.filters.status) return false
      if (query.filters.platform && p.platform !== query.filters.platform) return false
      if (!q) return true
      return [CI_PLATFORM_LABEL[p.platform], STATUS_LABEL[p.status] ?? p.status, p.published_url ?? '']
        .join(' ').toLowerCase().includes(q)
    })
    const dir = query.sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sortValue(a, query.sort.key).localeCompare(sortValue(b, query.sort.key), 'ko') * dir)
  }, [items, query.q, query.filters.status, query.filters.platform, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)
  const pageRows = filtered.slice(from, to + 1)

  return (
    <>
      <section className="card" style={{
        display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end',
        padding: 'var(--space-4)', marginBottom: 'var(--space-6)',
      }}>
        <div>
          <label className="label" htmlFor="ci-pub-platform">플랫폼</label>
          <select className="input-field" id="ci-pub-platform" value={platform}
            onChange={(e) => setPlatform(e.target.value as CiPlatform)}>
            {CI_PLATFORMS.map((p) => <option key={p} value={p}>{CI_PLATFORM_LABEL[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ci-pub-date">예약일 (선택)</label>
          {/* '(선택)'이라 기본값 없음 — 채우면 예약 안 한 게시물이 전부 예약으로 바뀐다. */}
          <DateField id="ci-pub-date" value={date} onValueChange={setDate} />
        </div>
        <div>
          <label className="label" htmlFor="ci-pub-time">시각</label>
          <input className="input-field" id="ci-pub-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" onClick={addItem} disabled={busy}>
          게시 준비 추가
        </button>
      </section>

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} helpHref="/ci/settings" /></div>}

      <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>
        지금은 수동 게시가 기본입니다. 플랫폼에 직접 올린 뒤 주소를 여기 붙여넣으면 그 시점부터 성과를 추적합니다.
        과거에 올린 게시물도 주소만 있으면 소급 추적됩니다.
      </p>

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="플랫폼·상태·주소로 찾기"
        filters={FILTERS}
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <ListSurface
        rows={pageRows}
        columns={columns}
        query={query}
        rowKey={(p) => p.id}
        onChange={set}
        empty={items.length === 0
          ? {
            title: '게시 준비 목록이 비어 있습니다',
            description: "파이프라인에서 '게시 준비' 단계로 옮긴 아이디어를 여기서 내보내고, 올린 주소를 기록합니다.",
            action: { label: '파이프라인으로', href: '/ci/pipeline' },
          }
          : { title: '조건에 맞는 게시 건이 없어요', description: '검색어나 필터를 바꿔보세요' }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />

      {del_.pending && (
        <ConfirmDeleteDialog
          title={del_.pending.title}
          impact={del_.impact}
          loading={del_.loading}
          busy={del_.busy}
          errorMessage={del_.errorMessage}
          onConfirm={del_.confirm}
          onClose={del_.close}
        />
      )}
    </>
  )
}
