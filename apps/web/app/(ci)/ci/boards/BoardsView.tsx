'use client'

// app/(ci)/ci/boards/BoardsView.tsx — 보드 목록
// 목록 표준(ListToolbar/ListSurface/ListPager + useListQuery)을 쓴다.
// 보드는 서버가 전량 내려주므로 검색·정렬·페이지는 여기서 자른다(rangeOf).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse } from '@/lib/ci/contracts'
import ErrorState from '@/components/ui/ErrorState'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import { isEnterKey } from '@/lib/ui/ime'

interface Board { id: string; name: string; itemCount: number }

// `add`는 목록 조건이 아니지만 filterKeys로 선언해 주소에 살려 둔다.
// set()이 주소를 통째로 다시 쓰기 때문에(=목록 파라미터만 남긴다), 선언하지 않으면
// 검색·정렬·페이지 한 번에 `?add=`가 사라지고 "담으러 온" 흐름이 끊긴다.
// (트렌드 화면이 tab·topicId를 살리는 방식과 같다)
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'name', dir: 'asc' },
  view: 'table',
  filterKeys: ['add'],
}
const SORT_OPTIONS = [
  { key: 'name', label: '이름' },
  { key: 'itemCount', label: '담긴 항목' },
]

export default function BoardsView({
  workspaceId, boards, pendingContentId,
}: { workspaceId: string; boards: Board[]; pendingContentId: string | null }) {
  const router = useRouter()
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/ci/boards' })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ name: name.trim() }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setName('')
      if (pendingContentId) await addTo(res.data.id)
      router.refresh()
    } finally { setBusy(false) }
  }

  async function addTo(boardId: string) {
    if (!pendingContentId) return
    const res = await fetch(`/api/ci/boards/${boardId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify({ itemType: 'content', itemId: pendingContentId }),
    }).then((r) => r.json() as Promise<ApiResponse<{ deduped: boolean }>>)
    if (res.success) {
      setSaved(res.data.deduped ? '이미 담겨 있습니다' : '보드에 담았습니다')
      router.refresh()
    }
  }

  // 검색·정렬은 URL이 진실이다 — 여기서는 그 값을 읽어 자르기만 한다
  const filtered = useMemo(() => {
    const q = query.q.trim().toLowerCase()
    const rows = q ? boards.filter((b) => b.name.toLowerCase().includes(q)) : boards
    const dir = query.sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => (
      query.sort.key === 'itemCount'
        ? (a.itemCount - b.itemCount) * dir
        : a.name.localeCompare(b.name, 'ko') * dir
    ))
  }, [boards, query.q, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)
  const rows = filtered.slice(from, to + 1)

  const columns: ColumnDef<Board>[] = [
    {
      key: 'name', header: '보드', primary: true, sortable: 'name',
      cell: (b) => <strong>{b.name}</strong>,
    },
    {
      key: 'itemCount', header: '담긴 항목', sortable: 'itemCount', align: 'right',
      cell: (b) => <><span className="ci-num">{b.itemCount}</span>건</>,
    },
    ...(pendingContentId ? [{
      key: 'actions', header: '작업', align: 'right' as const,
      cell: (b: Board) => (
        <button type="button" className="btn-primary" onClick={() => addTo(b.id)}>
          여기에 담기
        </button>
      ),
    }] : []),
  ]

  return (
    <>
      {pendingContentId && (
        <p className="ci-status ci-status-info" style={{ marginBottom: 'var(--space-4)', display: 'inline-flex' }}>
          담을 항목을 들고 왔습니다 — 아래 보드를 고르거나 새로 만드세요
        </p>
      )}
      {saved && (
        <p className="ci-status ci-status-ok" style={{ marginBottom: 'var(--space-4)', display: 'inline-flex' }}>
          {saved}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="ci-board-name" style={{ position: 'absolute', left: '-9999px' }}>보드 이름</label>
        <input className="input-field" id="ci-board-name"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); create() } }}
          placeholder="새 보드 이름 (예: 이번 달 소재)" disabled={busy} style={{ flex: 1 }}
        />
        <button type="button" className="btn-primary" onClick={create} disabled={busy || !name.trim()}>
          보드 만들기
        </button>
      </div>

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} helpHref="/ci/settings" /></div>}

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="보드 이름 검색"
        sortOptions={SORT_OPTIONS}
        total={filtered.length}
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        rowKey={(b) => b.id}
        onChange={set}
        empty={query.q
          ? { title: '찾는 보드가 없어요', description: '다른 이름으로 찾아보세요', action: { label: '검색 지우기', onClick: () => set({ q: '' }) } }
          : {
            title: '아직 만든 보드가 없어요',
            description: '트렌드나 수집함에서 “보드 담기”를 누르면 여기에 모입니다. 제작의 아이디어 열이 이 보드를 소스로 씁니다.',
            action: { label: '트렌드 보기', href: '/ci/trends?tab=outliers' },
          }}
      />

      <ListPager query={query} total={filtered.length} onChange={set} />
    </>
  )
}
