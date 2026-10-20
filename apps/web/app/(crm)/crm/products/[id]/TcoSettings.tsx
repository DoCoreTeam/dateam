'use client'

// 총비용 계산 기간 — 미리 계산의 「N년 총비용」 한 줄에만 쓰인다. 견적에는 안 쓰인다.
// 그래서 기본 정보가 아니라 그 줄 바로 아래에 둔다(사용자 지적 2026-10-20 「이게 가격 기준에 들어가는 내용이라는 게 이해가 안 되는데」).

import { useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import { ACTION, PRICEBOOK, progress } from '@/lib/terms'
import { readResponse } from '@/lib/crm/api/read-error'
import type { DetailJson } from './detail-shape'
import styles from './detail.module.css'

const MAX_DIGITS = 2
const digits = (v: string) => v.replace(/\D/g, '').slice(0, MAX_DIGITS)

export default function TcoSettings({ data, onSaved }: { data: DetailJson; onSaved: () => void }) {
  const p = data.product
  const [years, setYears] = useState(String(p.tcoYears))
  const [free, setFree] = useState(String(p.freeYears))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = years !== String(p.tcoYears) || free !== String(p.freeYears)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: p.version, tcoYears: Number(years) || p.tcoYears, freeYears: Number(free || 0) }),
      })
      const r = await readResponse(res, '저장하지 못했습니다.')
      if (!r.ok) { setError(r.message); return }
      onSaved()
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.tcoSettings}>
      <label className={styles.unitInput}>
        <span>{PRICEBOOK.tcoYears}</span>
        <input className="input-field" inputMode="numeric" value={years} onChange={(e) => setYears(digits(e.target.value))} aria-label={PRICEBOOK.tcoYears} />
        <span aria-hidden>{PRICEBOOK.yearUnit}</span>
      </label>
      <label className={styles.unitInput}>
        <span>{PRICEBOOK.freeYears}</span>
        <input className="input-field" inputMode="numeric" value={free} onChange={(e) => setFree(digits(e.target.value))} aria-label={PRICEBOOK.freeYears} />
        <span aria-hidden>{PRICEBOOK.yearUnit}</span>
      </label>
      <NbButton variant="ghost" disabled={!dirty || busy} onClick={() => void save()}>{busy ? progress(ACTION.save) : ACTION.save}</NbButton>
      <p className={styles.small}>{PRICEBOOK.tcoExplain(Number(years) || p.tcoYears, Number(free || 0))} · {PRICEBOOK.tcoNotInQuote}</p>
      {error && <p role="alert" className={styles.alert}>{error}</p>}
    </div>
  )
}
