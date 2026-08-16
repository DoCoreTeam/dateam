'use client'

// app/(ci)/ci/boards/[id]/BoardDetailView.tsx — 담긴 항목 목록과 빼기
//
// 빼기는 **보드에서만** 빼는 것이다 — 원본 게시물·공식·이슈는 그대로 남는다.
// 되돌릴 수 있는 일이라(다시 담으면 된다) 삭제용 확인창을 붙이지 않는다.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ApiResponse } from '@/lib/ci/contracts'
// 서버 전용 쿼리 파일이 아니라 **순수** 모듈에서 가져온다(안 그러면 빌드가 깨진다)
import type { BoardDetail, BoardItem } from '@/lib/ci/board-item'
import { boardItemTypeLabel } from '@/lib/ci/board-item'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import ErrorState from '@/components/ui/ErrorState'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'

const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'addedAt', dir: 'desc' }, view: 'table', size: 20, filterKeys: [],
}

export default function BoardDetailView({
  workspaceId, board,
}: { workspaceId: string; board: BoardDetail }) {
  const router = useRouter()
  const { query } = useListQuery(LIST_DEFAULTS, { persistKey: '/ci/boards/item' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  async function remove(itemId: string) {
    setBusy(itemId); setError(null)
    try {
      const res = await fetch(`/api/ci/boards/${board.id}/items?itemId=${itemId}`, {
        method: 'DELETE', headers: { 'X-CI-Workspace': workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      router.refresh()
    } catch {
      setError({ code: 'INTERNAL', message: '빼지 못했습니다. 잠시 후 다시 시도해 주세요' })
    } finally {
      setBusy(null)
    }
  }

  const columns: ColumnDef<BoardItem>[] = [
    {
      key: 'label', header: '담긴 것', primary: true,
      cell: (it) => (it.label == null
        // 원본이 사라진 항목을 숨기지 않는다 — 숨기면 개수가 안 맞는 이유를 알 수 없다
        ? <span className="ci-basis">원본이 사라진 항목</span>
        : it.href
          ? <Link href={it.href}>{it.label}</Link>
          : <span>{it.label}</span>),
    },
    { key: 'type', header: '종류', cell: (it) => boardItemTypeLabel(it.itemType) },
    { key: 'note', header: '메모', cell: (it) => it.note ?? <span className="ci-basis">—</span> },
    {
      key: 'addedAt', header: '담은 때', sortable: true,
      cell: (it) => (it.addedAt ? formatKstDateTimeShort(it.addedAt) : '—'),
    },
    {
      key: 'actions', header: '작업', noLabel: true, align: 'right',
      cell: (it) => (
        <span onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn-ghost"
            onClick={() => remove(it.id)} disabled={busy === it.id}
            title="보드에서만 뺍니다. 원본은 그대로 남습니다">
            {busy === it.id ? '빼는 중…' : '빼기'}
          </button>
        </span>
      ),
    },
  ]

  return (
    <>
      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <ErrorState code={error.code} message={error.message} />
        </div>
      )}
      <ListSurface
        rows={board.items}
        columns={columns}
        query={query}
        rowKey={(it) => it.id}
        empty={{
          title: '이 보드에 담긴 것이 없습니다',
          description: '트렌드나 수집함에서 "보드 담기"를 누르면 여기에 모입니다.',
          action: { label: '트렌드 보기', href: '/ci/trends' },
        }}
      />
    </>
  )
}
