'use client'

// 회사 목록 (dacrm T1-02)
//
// 호스트 목록 표준(§2-6)을 그대로 쓴다 — ListToolbar·ListSurface·ListPager + useListQuery.
// 새 목록 부품을 만들지 않는다. 검색어·보기는 URL 이 진실이라 링크를 공유하면 같은 화면이 열린다.
//
// 페이지 이동은 'more' 모드다(커서 API — 목록이 움직여도 같은 회사를 두 번 보지 않는다).
// 다만 **총 건수는 보여 준다.** 예전엔 그마저 없어서 372건이 들어와도 화면은
// 20건씩 '더 보기'만 반복하고 규모를 알 길이 없었다 — 끝이 안 보이는 목록은 사람이 끝낼 수 없다.
// count 는 첫 페이지 1회뿐이다(lib/crm/db/cursor.ts countIfFirstPage).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import {
  TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn,
} from '@/components/ui/crm/trash'
import { useListQuery } from '@/lib/ui/use-list-query'
import CompanyFormModal from './CompanyFormModal'

export interface CompanyItem {
  id: string
  name: string
  domain: string | null
  industry: string | null
  region: string | null
  version: number
  updatedAt: string
}

const COLUMNS: ColumnDef<CompanyItem>[] = [
  { key: 'name', header: '회사명', primary: true, cell: (r) => r.name },
  {
    key: 'domain',
    header: '도메인',
    cell: (r) => r.domain ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
  },
  {
    key: 'industry',
    header: '산업',
    cell: (r) => r.industry ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
  },
  {
    key: 'region',
    header: '지역',
    hideOnCard: true,
    cell: (r) => r.region ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
  },
]

export default function CompanyListView() {
  const { query, set } = useListQuery({
    view: 'table', size: 20, sort: { key: 'updatedAt', dir: 'desc' }, mode: 'more',
    filterKeys: [...TRASH_FILTER_KEYS],
  })
  const [rows, setRows] = useState<CompanyItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  // 서버는 첫 페이지에서만 총 건수를 준다 — 이어 볼 때는 이미 아는 값을 그대로 쓴다
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const q = query.q ?? ''
  const trash = isTrashView(query)

  const load = useCallback(async (append: boolean, nextCursor: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (trash) sp.set('trash', '1')
      sp.set('limit', String(query.size))
      if (nextCursor) sp.set('cursor', nextCursor)

      const res = await fetch(`/api/crm/companies?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        // 실패를 조용히 삼키지 않는다 — 서버가 준 문장을 그대로 보여 준다
        setError(body?.error?.message ?? '목록을 불러오지 못했습니다.')
        return
      }
      setRows((prev) => (append ? [...prev, ...body.items] : body.items))
      setCursor(body.nextCursor)
      if (!append) setTotal(typeof body.total === 'number' ? body.total : undefined)
    } catch {
      setError('목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [q, trash, query.size])

  // 검색어·개수가 바뀌면 처음부터 다시 — 커서를 이어 쓰면 조건이 섞인다
  useEffect(() => { void load(false, null) }, [load])

  const { restore, restoreError } = useRestore('/api/crm/companies', () => void load(false, null))
  const columns = useMemo<ColumnDef<CompanyItem>[]>(
    () => (trash ? [...COLUMNS, restoreColumn<CompanyItem>((id) => void restore(id))] : COLUMNS),
    [trash, restore],
  )

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="회사명·도메인으로 검색"
        views={['table', 'card']}
        filters={[TRASH_FILTER]}
        actions={
          <NbButton onClick={() => setFormOpen(true)}>
            <Plus size={16} /> 회사 추가
          </NbButton>
        }
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        rowHref={trash ? undefined : (r) => `/crm/companies/${r.id}`}
        loading={loading && rows.length === 0}
        error={(error ?? restoreError) ? { message: (error ?? restoreError)!, onRetry: () => void load(false, null) } : null}
        empty={trash ? TRASH_EMPTY : {
          title: q ? '검색 결과가 없어요' : '등록된 회사가 아직 없어요',
          description: q
            ? '다른 이름이나 도메인으로 찾아보세요.'
            : '거래처를 추가하면 담당자와 딜을 이어서 만들 수 있습니다.',
          action: q ? undefined : { label: '회사 추가', onClick: () => setFormOpen(true) },
        }}
      />

      <ListPager
        query={query}
        total={total}
        loaded={rows.length}
        hasMore={Boolean(cursor)}
        loading={loading}
        onChange={() => void load(true, cursor)}
      />

      {formOpen && (
        <CompanyFormModal
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void load(false, null) }}
        />
      )}
    </>
  )
}
