'use client'

// 품목 만들기 고치기 — 정상가를 바꾸면 가격 이력에 새 줄이 쌓이고 지난 견적은 안 바뀐다

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, PRICEBOOK, ITEM_BASIS_LABEL, BILLING_LABEL, progress } from '@/lib/terms'
import { ITEM_BASES } from '@/lib/crm/domain/pricebook/types'
import type { ItemJson } from './detail-shape'
import styles from './detail.module.css'

interface Props {
  productId: string
  item: ItemJson | null
  sections: string[]
  position: number
  onClose: () => void
  onSaved: () => void
}

export default function ItemEditModal({ productId, item, sections, position, onClose, onSaved }: Props) {
  const [f, setF] = useState({
    name: item?.name ?? '',
    section: item?.section ?? sections[0] ?? '',
    basis: item?.basis ?? 'FIXED',
    listPriceMinor: item && item.unitPriceMinor !== '0' ? item.unitPriceMinor : '',
    unit: item?.unit ?? '',
    billing: item?.billing ?? 'ONCE',
    ratioPct: item?.ratioPct ? String(Number(item.ratioPct)) : '',
    ratioOfSection: item?.ratioOfSection ?? '',
    discountable: item?.discountable ?? true,
    taxRate: item ? String(Number(item.taxRate)) : '10',
    remark: item?.remark ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const isRatio = f.basis === 'RATIO'
  const isSurvey = f.basis === 'SURVEY'

  const save = async () => {
    if (!f.name.trim()) { setError('품목 이름을 입력해 주세요.'); return }
    setBusy(true)
    setError(null)
    try {
      const body = { ...f, name: f.name.trim(), position, priceProductId: productId }
      const res = item
        ? await fetch(`/api/crm/pricebook/items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/crm/pricebook/products/${productId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) { setError(json?.error?.message ?? '저장하지 못했습니다.'); return }
      onSaved()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <NbModal
      title={item ? `${PRICEBOOK.tabItem} 수정` : PRICEBOOK.newItem}
      onClose={onClose}
      maxWidth={640}
      footer={(
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void save()} disabled={busy}>{busy ? progress(ACTION.save) : ACTION.save}</NbButton>
        </div>
      )}
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        <div className={styles.field}>
          <label className="label" htmlFor="it-name">{PRICEBOOK.tabItem}</label>
          <input id="it-name" className="input-field" value={f.name} autoFocus onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="it-section">{PRICEBOOK.section}</label>
            <input id="it-section" className="input-field" list="it-sections" value={f.section} onChange={(e) => set({ section: e.target.value })} />
            <datalist id="it-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="it-basis">{PRICEBOOK.basis}</label>
            <select id="it-basis" className="input-field" value={f.basis} onChange={(e) => set({ basis: e.target.value })}>
              {ITEM_BASES.map((b) => <option key={b} value={b}>{ITEM_BASIS_LABEL[b]}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="it-billing">{PRICEBOOK.billing}</label>
            <select id="it-billing" className="input-field" value={f.billing} onChange={(e) => set({ billing: e.target.value })}>
              {(['ONCE', 'ANNUAL'] as const).map((b) => <option key={b} value={b}>{BILLING_LABEL[b]}</option>)}
            </select>
          </div>
        </div>
        {isRatio ? (
          <div className={styles.row}>
            <div className={styles.field}>
              <label className="label" htmlFor="it-ratio">{PRICEBOOK.ratioPct}</label>
              <input id="it-ratio" className="input-field" inputMode="decimal" value={f.ratioPct} onChange={(e) => set({ ratioPct: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor="it-ratio-of">{PRICEBOOK.ratioOf}</label>
              <select id="it-ratio-of" className="input-field" value={f.ratioOfSection} onChange={(e) => set({ ratioOfSection: e.target.value })}>
                <option value="">—</option>
                {sections.filter((s) => s !== f.section).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        ) : !isSurvey && (
          <div className={styles.row}>
            <div className={styles.field}>
              <label className="label" htmlFor="it-price">{PRICEBOOK.listPrice}</label>
              <input id="it-price" className="input-field" inputMode="numeric" value={f.listPriceMinor} onChange={(e) => set({ listPriceMinor: e.target.value.replace(/[^\d]/g, '') })} placeholder="0" />
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor="it-unit">{PRICEBOOK.unit}</label>
              <input id="it-unit" className="input-field" value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="식 · 장 · 대" />
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor="it-tax">{PRICEBOOK.taxRate}</label>
              <input id="it-tax" className="input-field" inputMode="decimal" value={f.taxRate} onChange={(e) => set({ taxRate: e.target.value })} />
            </div>
          </div>
        )}
        <label className="label" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input type="checkbox" checked={f.discountable} onChange={(e) => set({ discountable: e.target.checked })} /> {PRICEBOOK.discountable}
        </label>
        <div className={styles.field}>
          <label className="label" htmlFor="it-remark">{PRICEBOOK.remark}</label>
          <input id="it-remark" className="input-field" value={f.remark} onChange={(e) => set({ remark: e.target.value })} />
        </div>
      </div>
    </NbModal>
  )
}
