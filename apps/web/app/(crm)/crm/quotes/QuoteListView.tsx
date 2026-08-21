'use client'

// 견적 목록
//
// **왜 생겼나**: 견적은 이미 있었다 — 표·계산·승인·상태 전이까지 서버에 다 있었다.
// 그런데 **딜 상세 안에서만** 볼 수 있었고 사이드바에는 없었다. API 도 `dealId` 없이 부르면
// 거절했다. 그래서 사용자에게는 "견적이 없는" 것과 같았다 —
// 만들어 두고 갈 길을 안 낸 것이 이 저장소에서 반복된 함정이다(v0.7.438).
//
// 여기서는 **훑는 일**만 한다. 만들고 고치는 것은 딜 상세의 QuotePanel 이 계속 맡는다 —
// 견적은 딜에 딸린 문서라 딜 없이 새로 만들 자리가 없다. 그래서 이 화면의 행은
// 견적이 붙은 **딜 상세로 간다**(§2-3-1 목록 행은 살아 있어야 한다).
//
// 목록 표준(§2-6)을 그대로 쓴다 — ListToolbar·ListSurface·ListPager + useListQuery.

import { useCallback, useEffect, useState, useMemo } from 'react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import NbBadge from '@/components/ui/nb/NbBadge'
import { kstDateKey } from '@/lib/datetime/kst'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import { QUOTE_STATUS_META, QUOTE_STATUS_ORDER, quoteStatusMeta } from '@/lib/crm/ui/quote-status'
import { useListQuery } from '@/lib/ui/use-list-query'
import { useRowSelection } from '@/hooks/useRowSelection'
import { useCrmBulk } from '@/components/ui/crm/useCrmBulk'
import {
  TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn,
} from '@/components/ui/crm/trash'

export interface QuoteItem {
  id: string
  dealId: string
  quoteNo: string
  title: string
  status: string
  currency: string
  validUntil: string | null
  totalMinor: string
  discountRate: number
  approvalRequired: boolean
  approvedAt: string | null
  expired?: boolean
  dealName: string
  companyName: string | null
  updatedAt: string
}

const FAINT = { color: 'var(--text-faint)' }

const COLUMNS: ColumnDef<QuoteItem>[] = [
  {
    key: 'quoteNo',
    header: '견적',
    primary: true,
    // 번호만 보면 무슨 건인지 모른다 — 제목을 함께 준다
    cell: (r) => (
      <>
        <span>{r.quoteNo}</span>
        <span style={{ ...FAINT, marginLeft: 'var(--space-2)' }}>{r.title}</span>
      </>
    ),
  },
  {
    key: 'deal',
    header: '딜',
    cell: (r) => (
      <>
        {r.dealName}
        {r.companyName && <span style={{ ...FAINT, marginLeft: 'var(--space-2)' }}>{r.companyName}</span>}
      </>
    ),
  },
  {
    key: 'status',
    header: '상태',
    cell: (r) => {
      const meta = quoteStatusMeta(r)
      return (
        <>
          <NbBadge status={meta.status}>{meta.label}</NbBadge>
          {/* 승인이 필요한데 아직 못 받은 건 목록에서 바로 보여야 한다 — 열어 봐야 아는 건 늦다 */}
          {r.approvalRequired && !r.approvedAt && (
            <span style={{ marginLeft: 'var(--space-2)' }}>
              <NbBadge status="blocker">승인 필요</NbBadge>
            </span>
          )}
        </>
      )
    },
  },
  {
    key: 'total',
    header: '금액',
    cell: (r) => (
      <>
        {formatAmount(r.totalMinor, r.currency)}
        {r.discountRate > 0 && (
          <span style={{ ...FAINT, marginLeft: 'var(--space-2)' }}>할인 {r.discountRate}%</span>
        )}
      </>
    ),
  },
  {
    key: 'validUntil',
    header: '유효기간',
    hideOnCard: true,
    cell: (r) => (r.validUntil ? `${kstDateKey(r.validUntil)}까지` : <span style={FAINT}>기한 없음</span>),
  },
]

/** 상태 필터 — 말은 QUOTE_STATUS_META 가 정한다(화면이 다시 적지 않는다) */
const STATUS_FILTER = {
  key: 'status',
  label: '상태',
  options: [
    { value: '', label: '전체' },
    ...QUOTE_STATUS_ORDER.map((s) => ({ value: s, label: QUOTE_STATUS_META[s].label })),
  ],
}

export default function QuoteListView() {
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 20, sort: { key: 'updatedAt', dir: 'desc' }, mode: 'more',
    filterKeys: ['status', ...TRASH_FILTER_KEYS],
  })
  const [rows, setRows] = useState<QuoteItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const q = query.q ?? ''
  const status = query.filters?.status ?? ''
  const trash = isTrashView(query)

  const load = useCallback(async (append: boolean, nextCursor: string | null) => {
    // 조회 조건의 서명. 아래는 개별 필드를 읽지만, **기본값으로 되돌리는 조작**은
    // 주소가 그대로라 개별 필드로는 보이지 않는다 — 그 변화는 queryKey 로만 들어온다.
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

      const res = await fetch(`/api/crm/quotes?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        // 실패를 조용히 삼키지 않는다 — 서버가 준 문장을 그대로 보여 준다
        setError(body?.error?.message ?? '견적을 불러오지 못했습니다.')
        return
      }
      setRows((prev) => (append ? [...prev, ...body.items] : body.items))
      setCursor(body.nextCursor)
      if (!append) setTotal(typeof body.total === 'number' ? body.total : undefined)
    } catch {
      setError('견적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [queryKey, q, status, trash, query.size])

  // 조건이 바뀌면 처음부터 다시 — 커서를 이어 쓰면 조건이 섞인다
  useEffect(() => { void load(false, null) }, [load])

  /** 골라서 한 번에 — 회사 목록과 같은 한 벌을 쓴다(§2-5) */
  const selection = useRowSelection(rows, (r) => r.id)
  const nameOf = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id)
      return row ? `${row.quoteNo} ${row.title}`.trim() : '번호를 알 수 없는 견적'
    },
    [rows],
  )
  const { restore, restoreError } = useRestore('/api/crm/quotes', () => void load(false, null))
  const columns = useMemo(
    () => (trash ? [...COLUMNS, restoreColumn<QuoteItem>((id) => void restore(id))] : COLUMNS),
    [trash, restore],
  )
  const crmBulk = useCrmBulk({
    endpoint: '/api/crm/quotes',
    entity: '견적', unit: '건',
    selection, labelOf: nameOf, trash,
    onReload: () => void load(false, null),
  })

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="견적번호·제목·딜 이름으로 검색"
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
        // 견적 자체의 상세 화면은 없다 — 견적을 고치는 자리는 딜 상세다. 거기로 보낸다
        rowHref={trash ? undefined : (r) => `/crm/deals/${r.dealId}`}
        loading={loading && rows.length === 0}
        error={(error ?? restoreError) ? { message: (error ?? restoreError)!, onRetry: () => void load(false, null) } : null}
        empty={trash ? TRASH_EMPTY : {
          title: q || status ? '조건에 맞는 견적이 없어요' : '아직 쓴 견적이 없어요',
          description: q || status
            ? '검색어나 상태를 바꿔 보세요.'
            : '견적은 딜 안에서 씁니다. 딜을 열고 "견적"에서 항목·할인·세금을 적으면 금액이 계산됩니다.',
          action: q || status ? undefined : { label: '딜 보러 가기', href: '/crm/deals' },
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
    </>
  )
}
