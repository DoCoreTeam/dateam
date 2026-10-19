'use client'

// 제품의 품목 — 묶음마다 모아 보인다. 확인 전 품목은 줄 색이 다르고 「확인」 단추 한 번이다.
// 지우지 않고 판매 중지로 둔다 — 지난 견적이 이 품목을 가리킨다.

import { useState } from 'react'
import { Plus, Check } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
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
  const sectionOrder = [...data.product.sections.map((s) => s.name), ...data.items.map((i) => i.section ?? '기타')]
  const sections = [...new Set(sectionOrder)].filter((s) => data.items.some((i) => (i.section ?? '기타') === s))

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

  return (
    <div className={styles.wrap}>
      <div className={styles.actions}>
        <NbButton onClick={() => setEditing('new')}><Plus size={14} /> {PRICEBOOK.newItem}</NbButton>
      </div>
      {error && <p role="alert" className={styles.alert}>{error}</p>}
      {data.items.length === 0 ? (
        <EmptyState title="품목이 아직 없어요" description="가격표 파일을 올리거나 품목을 더하세요." action={{ label: PRICEBOOK.newItem, onClick: () => setEditing('new') }} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{PRICEBOOK.tabItem}</th>
                <th className={styles.num}>{PRICEBOOK.listPrice}</th>
                <th>{PRICEBOOK.basis}</th>
                <th>{PRICEBOOK.billing}</th>
                <th>{PRICEBOOK.discountable}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <SectionRows key={s} name={s} items={data.items.filter((i) => (i.section ?? '기타') === s)}
                  onEdit={setEditing} onConfirm={(i) => void confirmPrice(i)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function SectionRows({ name, items, onEdit, onConfirm }: {
  name: string; items: ItemJson[]; onEdit: (i: ItemJson) => void; onConfirm: (i: ItemJson) => void
}) {
  return (
    <>
      <tr className={styles.sectionRow}><td colSpan={6}>{name}</td></tr>
      {items.map((i) => (
        <tr key={i.id} className={i.needsReview ? styles.review : undefined}>
          <td>
            {i.name}
            {!i.isActive && <> <NbBadge status="note">{PRICEBOOK.stopped}</NbBadge></>}
            {i.needsReview && <> <NbBadge status="note">{PRICEBOOK.needsReview}</NbBadge></>}
            {i.remark && <div className={styles.small}>{i.remark}</div>}
          </td>
          <td className={styles.num}><Sensitive>{priceText(i)}</Sensitive></td>
          <td>{ITEM_BASIS_LABEL[i.basis as keyof typeof ITEM_BASIS_LABEL] ?? i.basis}{i.unit ? ` · ${i.unit}` : ''}</td>
          <td>{BILLING_LABEL[i.billing as keyof typeof BILLING_LABEL] ?? i.billing}</td>
          <td>{i.discountable ? '예' : '아니오'}</td>
          <td>
            <div className={styles.actions}>
              {i.needsReview && <NbButton variant="ghost" onClick={() => onConfirm(i)}><Check size={14} /> {PRICEBOOK.confirm}</NbButton>}
              <NbButton variant="ghost" onClick={() => onEdit(i)}>{ACTION.edit}</NbButton>
            </div>
          </td>
        </tr>
      ))}
    </>
  )
}
