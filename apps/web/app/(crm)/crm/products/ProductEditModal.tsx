'use client'

// 품목 만들기·고치기
//
// **고친 이름은 다음 견적부터 반영된다.** 이미 나간 견적서는 안 바뀐다 —
// 견적 줄은 이름·단가를 스스로 들고 있기 때문이다(스키마 주석 참조).
// 보낸 문서의 금액이 나중에 바뀌면 그건 다른 문서다. 그 사실을 화면이 말해 준다.

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, ENTITY, createLabel, progress } from '@/lib/terms'
import { QUOTE } from '@/lib/terms/quote'
import styles from './product-edit.module.css'

export interface ProductDraft {
  id: string | null
  name: string
  sku: string
  unitPriceMinor: string
  currency: string
  taxRate: string
  unit: string
  descriptionMd: string
}

interface Props {
  draft: ProductDraft
  onClose: () => void
  onSaved: () => void
}

export default function ProductEditModal({ draft, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProductDraft>(draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = draft.id !== null

  const set = (patch: Partial<ProductDraft>) => setForm((f) => ({ ...f, ...patch }))

  const save = async () => {
    if (!form.name.trim()) { setError('품목 이름을 입력해 주세요.'); return }
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        unitPriceMinor: form.unitPriceMinor.trim() || '0',
        currency: form.currency,
        taxRate: form.taxRate.trim() || '10',
        unit: form.unit.trim() || null,
        descriptionMd: form.descriptionMd.trim() || null,
      }
      const res = editing
        ? await fetch(`/api/crm/products/${draft.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        : await fetch('/api/crm/products', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
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
      title={editing ? `${ENTITY.product.label} 수정` : createLabel(ENTITY.product.label)}
      onClose={onClose}
      maxWidth={560}
      footer={(
        // 확정은 오른쪽 끝, 취소는 그 왼쪽 (§2-3-2 L-6)
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
          <NbButton onClick={() => void save()} disabled={busy}>
            {busy ? progress(ACTION.save) : ACTION.save}
          </NbButton>
        </div>
      )}
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />

        <div className={styles.field}>
          <label className="label" htmlFor="pd-name">{QUOTE.lineName}</label>
          <input
            id="pd-name" className="input-field" value={form.name} autoFocus
            onChange={(e) => set({ name: e.target.value })}
            placeholder="예: H100 80GB SXM"
          />
        </div>

        <div className={styles.field}>
          <label className="label" htmlFor="pd-spec">{QUOTE.lineSpec}</label>
          <input
            id="pd-spec" className="input-field" value={form.descriptionMd}
            onChange={(e) => set({ descriptionMd: e.target.value })}
            placeholder="예: SXM5 · 3년 무상보증"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="pd-price">{QUOTE.lineUnitPrice}</label>
            <input
              id="pd-price" className="input-field" inputMode="numeric" value={form.unitPriceMinor}
              onChange={(e) => set({ unitPriceMinor: e.target.value.replace(/[^\d]/g, '') })}
              placeholder="0"
            />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="pd-unit">{QUOTE.lineUnit}</label>
            <input
              id="pd-unit" className="input-field" value={form.unit}
              onChange={(e) => set({ unit: e.target.value })}
              placeholder="대 · 식 · M/M"
            />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="pd-tax">{QUOTE.tax} %</label>
            <input
              id="pd-tax" className="input-field" inputMode="decimal" value={form.taxRate}
              onChange={(e) => set({ taxRate: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className="label" htmlFor="pd-sku">SKU</label>
          <input
            id="pd-sku" className="input-field" value={form.sku}
            onChange={(e) => set({ sku: e.target.value })}
            placeholder="사내 관리 번호가 있으면"
          />
        </div>

        {editing && (
          <p className={styles.note}>
            고친 이름은 <b>다음 견적부터</b> 쓰입니다. 이미 만든 견적서의 품목명·금액은 그대로예요.
          </p>
        )}
      </div>
    </NbModal>
  )
}
