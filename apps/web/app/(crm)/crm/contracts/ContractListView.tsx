'use client'

// 계약서 목록 — 견적 목록과 같은 한 벌(ListToolbar, ListSurface, useCrmBulk, 휴지통)을 쓴다 (P0132 I15)
//
// 권한 없음은 오류와 다른 상태다 — 「다시 시도」를 눌러도 안 풀리는 것을 고장처럼 그리지 않는다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import NbBadge from '@/components/ui/nb/NbBadge'
import Sensitive from '@/components/crm/Sensitive'
import { kstDateKey } from '@/lib/datetime/kst'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { ENTITY, FILTER_ALL, failedTo } from '@/lib/terms'
import {
  CONTRACT_DOC, CONTRACT_LIST, CONTRACT_STATUS_LABEL, DEAL_CONTRACTS, DOC_HEADER, versionLabel,
} from '@/lib/terms/contract-doc'
import { useListQuery } from '@/lib/ui/use-list-query'
import { useRowSelection } from '@/hooks/useRowSelection'
import { useCrmBulk } from '@/components/ui/crm/useCrmBulk'
import {
  TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn,
} from '@/components/ui/crm/trash'

export interface ContractListItem {
  id: string
  dealId: string
  contractNo: string
  title: string
  status: string
  currentVersionNo: number
  sentAt: string | null
  sentVersionNo: number | null
  totalMinor: string | null
  currency: string | null
  dealName: string
  companyName: string | null
}

const ENDPOINT = '/api/crm/contracts'
const STATUS_ORDER = ['DRAFT', 'CONCLUDED', 'TERMINATED', 'CANCELLED'] as const
const STATUS_TONE: Record<string, StatusKey> = {
  DRAFT: 'note', CONCLUDED: 'done', TERMINATED: 'blocker', CANCELLED: 'blocker',
}

const COLUMNS: ColumnDef<ContractListItem>[] = [
  {
    key: 'contractNo',
    header: CONTRACT_LIST.colContract,
    primary: true,
    cell: (r) => (
      <>
        <span>{r.contractNo}</span>
        <div>{r.title}</div>
      </>
    ),
  },
  { key: 'company', header: ENTITY.company.label, cell: (r) => r.companyName ?? '—' },
  { key: 'deal', header: ENTITY.deal.label, cell: (r) => r.dealName || '—', hideOnCard: true },
  {
    key: 'status',
    header: CONTRACT_LIST.colStatus,
    cell: (r) => <NbBadge status={STATUS_TONE[r.status] ?? 'note'}>{CONTRACT_STATUS_LABEL[r.status] ?? r.status}</NbBadge>,
  },
  {
    key: 'sent',
    header: CONTRACT_LIST.colSent,
    cell: (r) => (r.sentAt && r.sentVersionNo
      ? DOC_HEADER.sentVersion(kstDateKey(r.sentAt), r.sentVersionNo)
      : DOC_HEADER.notSent),
  },
  { key: 'version', header: CONTRACT_LIST.colVersion, hideOnCard: true, cell: (r) => versionLabel(r.currentVersionNo) },
  {
    key: 'amount',
    header: CONTRACT_LIST.colAmount,
    cell: (r) => (r.totalMinor && r.currency ? <Sensitive>{formatAmount(r.totalMinor, r.currency)}</Sensitive> : '—'),
  },
]

const STATUS_FILTER = {
  key: 'status',
  label: CONTRACT_LIST.colStatus,
  options: [
    { value: '', label: FILTER_ALL },
    ...STATUS_ORDER.map((s) => ({ value: s, label: CONTRACT_STATUS_LABEL[s] })),
  ],
}

export default function ContractListView() {
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 20, sort: { key: 'updatedAt', dir: 'desc' }, mode: 'more',
    filterKeys: ['status', ...TRASH_FILTER_KEYS],
  })
  const [rows, setRows] = useState<ContractListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  const q = query.q ?? ''
  const status = query.filters?.status ?? ''
  const trash = isTrashView(query)
  const fail = failedTo(CONTRACT_DOC.entity, '불러오지')

  const load = useCallback(async (append: boolean, nextCursor: string | null) => {
    // 기본값으로 되돌리는 조작은 주소가 그대로라 개별 필드로는 안 보인다 — queryKey 로만 들어온다
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (status) sp.set('status', status)
      if (trash) sp.set('trash', '1')
      sp.set('limit', String(query.size))
      if (nextCursor) sp.set('cursor', nextCursor)
      const res = await fetch(`${ENDPOINT}?${sp.toString()}`)
      const body = await res.json()
      if (res.status === 403) { setDenied(true); setRows([]); return }
      if (!res.ok) { setError(body?.error?.message ?? fail); return }
      setDenied(false)
      setRows((prev) => (append ? [...prev, ...body.items] : body.items))
      setCursor(body.nextCursor)
    } catch {
      setError(fail)
    } finally {
      setLoading(false)
    }
  }, [queryKey, q, status, trash, query.size, fail])

  useEffect(() => { void load(false, null) }, [load])

  const selection = useRowSelection(rows, (r) => r.id)
  const nameOf = useCallback((id: string) => {
    const row = rows.find((r) => r.id === id)
    return row ? `${row.contractNo} ${row.title}`.trim() : CONTRACT_LIST.unknownName
  }, [rows])
  const { restore, restoreError } = useRestore(ENDPOINT, () => void load(false, null))
  const columns = useMemo(
    () => (trash ? [...COLUMNS, restoreColumn<ContractListItem>((id) => void restore(id))] : COLUMNS),
    [trash, restore],
  )
  const crmBulk = useCrmBulk({
    endpoint: ENDPOINT,
    entity: CONTRACT_DOC.entity, unit: CONTRACT_LIST.unit,
    selection, labelOf: nameOf, trash,
    onReload: () => void load(false, null),
  })

  const filtered = Boolean(q || status)
  const shownError = error ?? restoreError
  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder={CONTRACT_LIST.search}
        views={['table', 'card']}
        filters={[STATUS_FILTER, TRASH_FILTER]}
        selection={crmBulk.toolbarSelection}
      />

      {crmBulk.panels}

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        selection={crmBulk.surfaceSelection}
        rowHref={trash ? undefined : (r) => `/crm/contracts/${r.id}`}
        loading={loading && rows.length === 0}
        error={shownError ? { message: shownError, onRetry: () => void load(false, null) } : null}
        empty={denied ? { title: DEAL_CONTRACTS.denied } : trash ? TRASH_EMPTY : {
          title: filtered ? CONTRACT_LIST.emptyFiltered : CONTRACT_LIST.empty,
          description: filtered ? CONTRACT_LIST.emptyFilteredNext : CONTRACT_LIST.emptyNext,
          action: filtered ? undefined : { label: CONTRACT_LIST.goDeals, href: '/crm/deals' },
        }}
      />

      <ListPager
        query={query}
        loaded={rows.length}
        hasMore={Boolean(cursor)}
        loading={loading}
        onChange={() => void load(true, cursor)}
      />
    </>
  )
}
