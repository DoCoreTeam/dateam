'use client'

// 품목 카탈로그 관리
//
// **왜 생겼나**: 만들 수만 있고 **고칠 길이 없었다.**
// 견적을 쓰다 급히 만든 품목은 오타가 나기 쉬운데, 그 이름이 곧 **견적서에 인쇄되는 이름**이다.
// 고칠 수 없으니 사람은 「비슷한 이름을 하나 더」 만들었고 카탈로그가 갈렸다
// (사용자 지적: 「품목명이 잘못되었다면 어떻게 수정해? 관리하는 화면이 없는거 같은데?
//  수정 버튼이 있는것도 아니고」).
//
// **목록 표준(§2-6)을 그대로 쓴다** — ListToolbar·ListSurface·ListPager + useListQuery.
// 여기서만 다른 것은 하나다: 이 API 는 커서 목록이 아니라 **검색 상한**이라
// 페이지 이동이 없다. 그래서 ListPager 에 상한에 걸렸다는 사실만 알린다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Archive, RotateCcw } from 'lucide-react'
import Sensitive from '@/components/crm/Sensitive'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import { ACTION, ENTITY, count, createLabel } from '@/lib/terms'
import { QUOTE } from '@/lib/terms/quote'
import { useListQuery } from '@/lib/ui/use-list-query'
import ProductEditModal, { type ProductDraft } from './ProductEditModal'

export interface ProductItem {
  id: string
  name: string
  sku: string | null
  unitPriceMinor: string
  currency: string
  taxRate: string
  unit: string | null
  descriptionMd: string | null
  isActive: boolean
}

const FAINT = { color: 'var(--text-faint)' }

/** 그만 파는 것까지 볼 것인가 — 기본은 파는 것만(견적에 올릴 수 있는 것만) */
const ACTIVE_FILTER = {
  key: 'archived',
  label: '상태',
  options: [
    { value: '', label: '파는 것' },
    { value: '1', label: '그만 판 것까지' },
  ],
}

export default function ProductListView() {
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 50, sort: { key: 'name', dir: 'asc' }, mode: 'more',
    filterKeys: ['archived'],
  })
  const [rows, setRows] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ProductDraft | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const q = query.q ?? ''
  const includeInactive = (query.filters?.archived ?? '') === '1'

  const load = useCallback(async () => {
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (q) sp.set('q', q)
      if (includeInactive) sp.set('all', '1')
      // 고치고 나서 다시 읽는 경로다 — 캐시를 받으면 방금 고친 이름이 그대로 옛것으로 보인다
      const res = await fetch(`/api/crm/products?${sp.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '품목을 불러오지 못했습니다.'); return }
      setRows(body.items ?? [])
    } catch {
      setError('품목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [queryKey, q, includeInactive])

  useEffect(() => { void load() }, [load])

  /** 그만 팔기 / 다시 팔기 — **지우지 않는다**. 지난 견적서가 이 품목을 가리킨다 */
  const setActive = useCallback(async (row: ProductItem, active: boolean) => {
    setActionError(null)
    try {
      const res = active
        ? await fetch(`/api/crm/products/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: true }),
        })
        : await fetch(`/api/crm/products/${row.id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) { setActionError(body?.error?.message ?? '바꾸지 못했습니다.'); return }
      await load()
    } catch {
      setActionError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [load])

  const columns = useMemo<ColumnDef<ProductItem>[]>(() => [
    {
      key: 'name',
      header: QUOTE.lineName,
      primary: true,
      cell: (r) => (
        <>
          <span>{r.name}</span>
          {!r.isActive && (
            <span style={{ marginLeft: 'var(--space-2)' }}>
              <NbBadge status="note">그만 판 것</NbBadge>
            </span>
          )}
          {r.descriptionMd && <div style={{ ...FAINT, fontSize: 'var(--fs-xs)' }}>{r.descriptionMd}</div>}
        </>
      ),
    },
    { key: 'sku', header: 'SKU', hideOnCard: true, cell: (r) => r.sku ?? <span style={FAINT}>—</span> },
    { key: 'unit', header: QUOTE.lineUnit, cell: (r) => r.unit ?? <span style={FAINT}>—</span> },
    {
      key: 'price',
      header: QUOTE.lineUnitPrice,
      // 회의 모드에서 금액을 가리는 자리 — 카탈로그 단가도 고객 앞에서 보이면 안 된다
      cell: (r) => (Number(r.unitPriceMinor) > 0
        ? <Sensitive>{formatAmount(r.unitPriceMinor, r.currency)}</Sensitive>
        : <span style={FAINT}>미정</span>),
    },
    { key: 'tax', header: `${QUOTE.tax} %`, hideOnCard: true, cell: (r) => `${r.taxRate}%` },
    {
      key: 'actions',
      header: '',
      // 액션 칸은 전파를 막는다 — 안 그러면 버튼을 눌렀는데 행이 열린다(§2-3-1)
      cell: (r) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}
          onClick={(e) => e.stopPropagation()}
        >
          <NbButton variant="ghost" onClick={() => setEditing(toDraft(r))}>
            <Pencil size={14} /> {ACTION.edit}
          </NbButton>
          {r.isActive ? (
            <NbButton variant="ghost" onClick={() => void setActive(r, false)}>
              <Archive size={14} /> 그만 팔기
            </NbButton>
          ) : (
            <NbButton variant="ghost" onClick={() => void setActive(r, true)}>
              <RotateCcw size={14} /> 다시 팔기
            </NbButton>
          )}
        </div>
      ),
    },
  ], [setActive])

  return (
    <>
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="품목 이름·SKU 로 검색"
        views={['table', 'card']}
        filters={[ACTIVE_FILTER]}
        actions={(
          <NbButton onClick={() => setEditing(emptyDraft())}>
            <Plus size={14} /> {createLabel(ENTITY.product.label)}
          </NbButton>
        )}
      />

      {actionError && <p role="alert" style={{ color: 'var(--danger)' }}>{actionError}</p>}

      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        // 상세 화면이 따로 없다 — 행을 누르면 **그 자리에서** 고친다(§2-3-1 행은 살아 있어야 한다)
        onRowClick={(r) => setEditing(toDraft(r))}
        loading={loading && rows.length === 0}
        error={error ? { message: error, onRetry: () => void load() } : null}
        empty={{
          title: q ? '조건에 맞는 품목이 없어요' : `${ENTITY.product.label}이 아직 없어요`,
          description: q
            ? '검색어를 바꿔 보세요.'
            : '견적을 쓰다가 품목 칸에서 바로 만들 수도 있어요. 여기서 만들면 다음 견적부터 검색으로 찾습니다.',
          action: q ? undefined : { label: createLabel(ENTITY.product.label), onClick: () => setEditing(emptyDraft()) },
        }}
      />

      {/* 상한에 걸렸다는 사실은 말한다 — 조용히 끊기면 「없는 것」으로 읽힌다 */}
      {rows.length >= 50 && (
        <p style={{ ...FAINT, fontSize: 'var(--fs-sm)' }}>
          {count('product', rows.length)}까지 보여 주고 있어요. 더 있으면 이름을 검색해 주세요.
        </p>
      )}

      {editing && (
        <ProductEditModal
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </>
  )
}

function toDraft(r: ProductItem): ProductDraft {
  return {
    id: r.id,
    name: r.name,
    sku: r.sku ?? '',
    unitPriceMinor: r.unitPriceMinor === '0' ? '' : r.unitPriceMinor,
    currency: r.currency,
    taxRate: String(r.taxRate),
    unit: r.unit ?? '',
    descriptionMd: r.descriptionMd ?? '',
  }
}

function emptyDraft(): ProductDraft {
  return { id: null, name: '', sku: '', unitPriceMinor: '', currency: 'KRW', taxRate: '10', unit: '', descriptionMd: '' }
}
