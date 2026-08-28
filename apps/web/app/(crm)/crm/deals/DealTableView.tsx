'use client'

// 딜 표 (dacrm T1-03)
//
// 보드는 "지금 어느 단계에 몇 건"을 보는 눈이고, 표는 "무엇이 얼마짜리인가"를 보는 눈이다.
// 닫힌 딜은 보드에서 사라지지만 표에는 남는다 — 성사·실주를 되짚는 자리가 여기다.
//
// 목록 표준(§2-6)을 그대로 쓴다: ListToolbar·ListSurface·ListPager + useListQuery.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { readApiError, describeFetchFailure } from '@/lib/crm/api/read-error'
import Sensitive from '@/components/crm/Sensitive'
import { Plus } from 'lucide-react'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListSummary from '@/components/ui/list/ListSummary'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { useListQuery } from '@/lib/ui/use-list-query'
import { useRowSelection } from '@/hooks/useRowSelection'
import { useCrmBulk } from '@/components/ui/crm/useCrmBulk'
import {
  TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn,
} from '@/components/ui/crm/trash'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import type { BoardPipeline } from './DealBoard'
import { formatAmount } from './amount'
import { ENTITY } from '@/lib/terms'
import { BUSINESS_TYPE_LABEL, BUSINESS_TYPE_LABEL_TEXT, type BusinessTypeKey } from '@/lib/terms/ledger'

export interface DealRowItem {
  id: string
  name: string
  companyId: string
  pipelineId: string
  stageId: string
  status: string
  amountMinor: string | null
  currency: string | null
  expectedCloseDate: string | null
  /** 조인해서 온 것 — 표에 그대로 보여 준다 */
  companyName?: string | null
  ownerName?: string | null
  businessType?: string | null
  version: number
  updatedAt: string
}

/**
 * 상태는 색으로도 말한다 — 성사와 실주가 같은 회색이면 표를 훑어서는 구분이 안 된다.
 * 색은 호스트의 상태 키에 얹는다(lib/tokens/status-colors SSOT) — 화면에서 색맵을 새로 만들지 않는다.
 */
const STATUS_LABEL: Record<string, { label: string; status: StatusKey }> = {
  OPEN: { label: '진행 중', status: 'doing' },
  WON: { label: '수주', status: 'done' },
  LOST: { label: '실주', status: 'blocker' },
}

interface Props {
  pipelines: BoardPipeline[]
  onCreate: () => void
  /** 목록을 다시 읽어야 할 때 바뀌는 값(저장 직후 등) */
  reloadKey: number
}

export default function DealTableView({ pipelines, onCreate, reloadKey }: Props) {
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 20, sort: { key: 'updatedAt', dir: 'desc' }, mode: 'more',
    filterKeys: ['pipelineId', 'status', ...TRASH_FILTER_KEYS],
  })
  const [rows, setRows] = useState<DealRowItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  // 서버는 첫 페이지에서만 총 건수를 준다 — 이어 볼 때는 이미 아는 값을 그대로 쓴다
  const [total, setTotal] = useState<number | undefined>(undefined)
  /** 서버가 센 금액 합계 — 화면에서 더하면 「지금 보이는 20건」의 합이 된다 */
  const [sums, setSums] = useState<{ byCurrency: Record<string, string>; countedDeals: number; unpricedDeals: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const q = query.q ?? ''
  const pipelineId = query.filters?.pipelineId ?? ''
  const status = query.filters?.status ?? ''
  const trash = isTrashView(query)

  // 단계 이름은 파이프라인 전체에서 찾는다 — 표는 여러 파이프라인을 섞어 보여 줄 수 있다
  const stageName = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of pipelines) for (const s of p.stages) map.set(s.id, s.name)
    return map
  }, [pipelines])

  const load = useCallback(async (append: boolean, nextCursor: string | null) => {
    // 조회 조건의 서명. 아래는 개별 필드를 읽지만, **기본값으로 되돌리는 조작**은
    // 주소가 그대로라 개별 필드로는 보이지 않는다 — 그 변화는 queryKey 로만 들어온다.
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (pipelineId) sp.set('pipelineId', pipelineId)
      if (status) sp.set('status', status)
      if (trash) sp.set('trash', '1')
      sp.set('limit', String(query.size))
      if (nextCursor) sp.set('cursor', nextCursor)

      const res = await fetch(`/api/crm/deals?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) { setError(readApiError(body, '딜을 불러오지 못했습니다.')); return }
      setRows((prev) => (append ? [...prev, ...body.items] : body.items))
      setCursor(body.nextCursor)
      if (!append) {
        setTotal(typeof body.total === 'number' ? body.total : undefined)
        setSums(body.sums ?? null)
      }
    } catch {
      setError(describeFetchFailure('딜'))
    } finally {
      setLoading(false)
    }
  }, [queryKey, q, pipelineId, status, trash, query.size])

  useEffect(() => { void load(false, null) }, [load, reloadKey])

  /** 골라서 한 번에 — 회사 목록과 같은 한 벌을 쓴다(§2-5) */
  const selection = useRowSelection(rows, (r) => r.id)
  const nameOf = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id)
      return row ? row.name : '이름을 알 수 없는 딜'
    },
    [rows],
  )
  const crmBulk = useCrmBulk({
    endpoint: '/api/crm/deals',
    entity: '딜', unit: '건',
    selection, labelOf: nameOf, trash: trash,
    onReload: () => void load(false, null),
  })

  const { restore, restoreError } = useRestore('/api/crm/deals', () => void load(false, null))

  const baseColumns: ColumnDef<DealRowItem>[] = useMemo(() => [
    { key: 'name', header: '딜 이름', primary: true, cell: (r) => r.name },
    /*
      **회사·담당자·사업 유형이 표에 있어야 한다.**
      예전엔 딜 이름·단계·상태·금액뿐이라 «어느 회사 건인지·누가 맡는지»를
      하나씩 열어 봐야 알 수 있었다(사용자 지적: 「왜 다 생략되었지?」).
    */
    {
      key: 'company', header: ENTITY.company.label,
      cell: (r) => r.companyName ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'owner', header: '담당자',
      cell: (r) => r.ownerName ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'businessType', header: BUSINESS_TYPE_LABEL_TEXT, hideOnCard: true,
      cell: (r) => (r.businessType
        ? BUSINESS_TYPE_LABEL[r.businessType as BusinessTypeKey] ?? r.businessType
        : <span style={{ color: 'var(--text-faint)' }}>—</span>),
    },
    {
      key: 'stage', header: '단계',
      cell: (r) => stageName.get(r.stageId) ?? <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'status', header: '상태',
      cell: (r) => {
        const meta = STATUS_LABEL[r.status] ?? { label: r.status, status: 'note' as StatusKey }
        return <NbBadge status={meta.status}>{meta.label}</NbBadge>
      },
    },
    {
      key: 'amount', header: '금액', align: 'right',
      // 회의 모드에서 가린다 — 고객 앞에서 목록을 열면 이 열이 그대로 보인다.
      // 값이 없으면 가릴 것도 없다 — 「미정」은 그대로 둔다(가리면 있는 줄 안다)
      cell: (r) => {
        const amount = formatAmount(r.amountMinor, r.currency)
        return amount
          ? <Sensitive>{amount}</Sensitive>
          : <span style={{ color: 'var(--text-faint)' }}>미정</span>
      },
    },
    {
      // 「언제 들어올 돈인가」 — 금액 옆에 있어야 예측이 읽힌다
      key: 'expectedCloseDate', header: '수주 예상일', hideOnCard: true,
      cell: (r) => (r.expectedCloseDate
        ? String(r.expectedCloseDate).slice(0, 10)
        : <span style={{ color: 'var(--text-faint)' }}>—</span>),
    },
    {
      key: 'updatedAt', header: '최근 변경', hideOnCard: true,
      cell: (r) => formatKstDateTimeShort(r.updatedAt),
    },
  ], [stageName])

  const columns = useMemo(
    () => (trash ? [...baseColumns, restoreColumn<DealRowItem>((id) => void restore(id))] : baseColumns),
    [trash, baseColumns, restore],
  )

  const filters: ListFilterDef[] = useMemo(() => [
    {
      key: 'pipelineId', label: '파이프라인',
      options: pipelines.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      key: 'status', label: '상태',
      options: [
        { value: 'OPEN', label: '진행 중' },
        { value: 'WON', label: '수주' },
        { value: 'LOST', label: '실주' },
      ],
    },
    TRASH_FILTER,
  ], [pipelines])

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="딜 이름으로 검색"
        views={['table', 'card']}
        filters={filters}
        showSize={false}
        selection={crmBulk.toolbarSelection}
        actions={<NbButton onClick={onCreate}><Plus size={16} /> 딜 추가</NbButton>}
      />

      {crmBulk.panels}

      {/* 간략 합계 — 목록 위 한 줄. 서버가 센 값이라 페이지를 넘겨도 안 바뀐다 */}

      {sums && (

        <ListSummary

          label="수주 총액"

          count={sums.countedDeals}

          byCurrency={sums.byCurrency}

          unpriced={sums.unpricedDeals}

        />

      )}


      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        selection={crmBulk.surfaceSelection}
        rowHref={trash ? undefined : (r) => `/crm/deals/${r.id}`}
        loading={loading && rows.length === 0}
        error={(error ?? restoreError) ? { message: (error ?? restoreError)!, onRetry: () => void load(false, null) } : null}
        empty={trash ? TRASH_EMPTY : {
          title: q || pipelineId || status ? '조건에 맞는 딜이 없어요' : '아직 딜이 없어요',
          description: q || pipelineId || status
            ? '검색어나 필터를 바꿔 보세요.'
            : '영업 건을 만들면 단계별로 진행 상황을 볼 수 있습니다.',
          action: q || pipelineId || status ? undefined : { label: '딜 추가', onClick: onCreate },
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
