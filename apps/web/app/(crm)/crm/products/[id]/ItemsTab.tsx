'use client'

// 제품의 품목 — 묶음마다 모아 보인다. 확인 전 품목은 줄 색이 다르고 「확인」 단추 한 번이다.
// 지우지 않고 판매 중지로 둔다 — 지난 견적이 이 품목을 가리킨다.

import { useMemo, useState } from 'react'
import { Plus, Check } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import Sensitive from '@/components/crm/Sensitive'
import { ACTION, PRICEBOOK, ITEM_BASIS_LABEL, BILLING_LABEL } from '@/lib/terms'
import type { DetailJson, ItemJson } from './detail-shape'
import { won } from './detail-shape'
import ItemEditModal from './ItemEditModal'
import styles from './detail.module.css'

interface Props { data: DetailJson; onSaved: () => void }

function priceText(i: ItemJson): string {
  if (i.basis === 'SURVEY') return PRICEBOOK.survey
  if (i.basis === 'RATIO') return `${Number(i.ratioPct ?? 0)}% (${i.ratioOfSection ?? ''})`
  return won(i.unitPriceMinor)
}

export default function ItemsTab({ data, onSaved }: Props) {
  const [editing, setEditing] = useState<ItemJson | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { query, set } = useListQuery({ view: 'table', size: 100, sort: { key: 'position', dir: 'asc' }, mode: 'more' })
  const sectionOrder = [...data.product.sections.map((s) => s.name), ...data.items.map((i) => i.section ?? '기타')]
  const sections = [...new Set(sectionOrder)].filter((s) => data.items.some((i) => (i.section ?? '기타') === s))
  // 묶음 순서대로, 묶음 안에서는 품목 순서대로 — 가격표와 같은 순서로 읽힌다
  const rows = useMemo(() => [...data.items].sort((a, b) =>
    (sections.indexOf(a.section ?? '기타') - sections.indexOf(b.section ?? '기타')) || (a.position - b.position)), [data.items, sections])

  const confirmPrice = async (i: ItemJson) => {
    setError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/items/${i.id}/confirm`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(body?.error?.message ?? '확인하지 못했습니다.'); return }
      onSaved()
    } catch {
      setError('확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  const columns: ColumnDef<ItemJson>[] = [
    { key: 'section', header: PRICEBOOK.section, cell: (i) => i.section ?? '기타' },
    {
      key: 'name', header: PRICEBOOK.tabItem, primary: true,
      cell: (i) => (
        <>
          {i.name}
          {!i.isActive && <> <NbBadge status="note">{PRICEBOOK.stopped}</NbBadge></>}
          {i.needsReview && <> <NbBadge status="note">{PRICEBOOK.needsReview}</NbBadge></>}
          {i.remark && <div className={styles.small}>{i.remark}</div>}
        </>
      ),
    },
    { key: 'price', header: PRICEBOOK.listPrice, align: 'right', cell: (i) => <Sensitive>{priceText(i)}</Sensitive> },
    { key: 'basis', header: PRICEBOOK.basis, cell: (i) => `${ITEM_BASIS_LABEL[i.basis as keyof typeof ITEM_BASIS_LABEL] ?? i.basis}${i.unit ? ` · ${i.unit}` : ''}` },
    { key: 'billing', header: PRICEBOOK.billing, hideOnCard: true, cell: (i) => BILLING_LABEL[i.billing as keyof typeof BILLING_LABEL] ?? i.billing },
    { key: 'disc', header: PRICEBOOK.discountable, hideOnCard: true, cell: (i) => (i.discountable ? '예' : '아니오') },
    {
      key: 'actions', header: '', noLabel: true,
      cell: (i) => (
        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
          {i.needsReview && <NbButton variant="ghost" onClick={() => void confirmPrice(i)}><Check size={14} /> {PRICEBOOK.confirm}</NbButton>}
          <NbButton variant="ghost" onClick={() => setEditing(i)}>{ACTION.edit}</NbButton>
        </div>
      ),
    },
  ]

  return (
    <div className={styles.wrap}>
      <div className={styles.actions}>
        <NbButton onClick={() => setEditing('new')}><Plus size={14} /> {PRICEBOOK.newItem}</NbButton>
      </div>
      {error && <p role="alert" className={styles.alert}>{error}</p>}
      <ListSurface
        rows={rows}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEditing(r)}
        empty={{ title: '품목이 아직 없어요', description: '가격표 파일을 올리거나 품목을 더하세요.', action: { label: PRICEBOOK.newItem, onClick: () => setEditing('new') } }}
      />
      {editing && (
        <ItemEditModal
          productId={data.product.id}
          item={editing === 'new' ? null : editing}
          sections={sections.length ? sections : data.product.sections.map((x) => x.name)}
          position={editing === 'new' ? data.items.length : editing.position}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onSaved() }}
        />
      )}
    </div>
  )
}
