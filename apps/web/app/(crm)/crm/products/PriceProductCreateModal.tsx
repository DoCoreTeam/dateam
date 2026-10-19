'use client'

// 새 제품 — 이름과 사업 유형만 받고 상세로 간다. 품목과 규칙은 상세에서 넣는다

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { ACTION, PRICEBOOK, BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, progress } from '@/lib/terms'
import styles from './pricebook.module.css'

interface Props {
  onClose: () => void
  onCreated: (id: string) => void
}

export default function PriceProductCreateModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState('SOLUTION')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!name.trim()) { setError('제품 이름을 입력해 주세요.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/pricebook/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), businessTypeKey: type }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '만들지 못했습니다.'); return }
      onCreated(body.id)
    } catch {
      setError('만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <NbModal
      title={PRICEBOOK.newProduct}
      onClose={onClose}
      maxWidth={480}
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
          <label className="label" htmlFor="pp-name">{PRICEBOOK.productName}</label>
          <input id="pp-name" className="input-field" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="예: gcube edge" />
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor="pp-type">{PRICEBOOK.businessType}</label>
          <select id="pp-type" className="input-field" value={type} onChange={(e) => setType(e.target.value)}>
            {BUSINESS_TYPE_ORDER.map((k) => <option key={k} value={k}>{BUSINESS_TYPE_LABEL[k]}</option>)}
          </select>
        </div>
      </div>
    </NbModal>
  )
}
