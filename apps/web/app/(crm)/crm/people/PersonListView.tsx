'use client'

// 인물 목록 (dacrm T1-02)
// 회사 목록과 같은 표준 부품을 쓴다 — 같은 성격의 화면이 서로 다르게 보이면 안 된다(§2-5).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import { useListQuery } from '@/lib/ui/use-list-query'
import {
  TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn,
} from '@/components/ui/crm/trash'
import PersonFormModal from './PersonFormModal'

export interface PersonItem {
  id: string
  companyId: string | null
  name: string
  email: string | null
  phone: string | null
  title: string | null
  lifecycleStage: string
  version: number
  updatedAt: string
}

/** 명세 2.1 CrmLifecycleStage — 화면 문구는 여기 한 곳에서만 정한다 */
export const STAGE_LABEL: Record<string, string> = {
  LEAD: '리드',
  MQL: '관심',
  SQL: '검증됨',
  CUSTOMER: '고객',
  CHURNED: '이탈',
}

const dash = <span style={{ color: 'var(--text-faint)' }}>—</span>

const COLUMNS: ColumnDef<PersonItem>[] = [
  { key: 'name', header: '이름', primary: true, cell: (r) => r.name },
  { key: 'title', header: '직함', cell: (r) => r.title ?? dash },
  { key: 'email', header: '이메일', cell: (r) => r.email ?? dash },
  { key: 'phone', header: '연락처', hideOnCard: true, cell: (r) => r.phone ?? dash },
  {
    key: 'lifecycleStage',
    header: '단계',
    cell: (r) => STAGE_LABEL[r.lifecycleStage] ?? r.lifecycleStage,
  },
]

export default function PersonListView() {
  const { query, set } = useListQuery({
    view: 'table', size: 20, sort: { key: 'updatedAt', dir: 'desc' }, mode: 'more',
    filterKeys: [...TRASH_FILTER_KEYS],
  })
  const [rows, setRows] = useState<PersonItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
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

      const res = await fetch(`/api/crm/people?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? '목록을 불러오지 못했습니다.')
        return
      }
      setRows((prev) => (append ? [...prev, ...body.items] : body.items))
      setCursor(body.nextCursor)
    } catch {
      setError('목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [q, trash, query.size])

  useEffect(() => { void load(false, null) }, [load])

  const { restore, restoreError } = useRestore('/api/crm/people', () => void load(false, null))
  const columns = useMemo(
    () => (trash ? [...COLUMNS, restoreColumn<PersonItem>((id) => void restore(id))] : COLUMNS),
    [trash, restore],
  )

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="이름·이메일로 검색"
        views={['table', 'card']}
        filters={[TRASH_FILTER]}
        actions={
          <NbButton onClick={() => setFormOpen(true)}>
            <Plus size={16} /> 인물 추가
          </NbButton>
        }
      />

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        rowHref={trash ? undefined : (r) => `/crm/people/${r.id}`}
        loading={loading && rows.length === 0}
        error={(error ?? restoreError) ? { message: (error ?? restoreError)!, onRetry: () => void load(false, null) } : null}
        empty={trash ? TRASH_EMPTY : {
          title: q ? '검색 결과가 없어요' : '등록된 인물이 아직 없어요',
          description: q
            ? '다른 이름이나 이메일로 찾아보세요.'
            : '담당자를 등록하면 미팅·딜에 이어 붙일 수 있습니다.',
          action: q ? undefined : { label: '인물 추가', onClick: () => setFormOpen(true) },
        }}
      />

      <ListPager
        query={query}
        hasMore={Boolean(cursor)}
        loading={loading}
        onChange={() => void load(true, cursor)}
      />

      {formOpen && (
        <PersonFormModal
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); void load(false, null) }}
        />
      )}
    </>
  )
}
