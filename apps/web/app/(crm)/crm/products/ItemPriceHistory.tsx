'use client'

// 품목 하나의 정상가 흐름 — 「작년 7,000,000원 → 올해 7,300,000원」을 고치는 자리에서 바로 본다

import { useEffect, useState } from 'react'
import Sensitive from '@/components/crm/Sensitive'
import { PRICEBOOK } from '@/lib/terms'
import styles from './pricebook.module.css'

interface Row { id: string; field: string; amountMinor: string | null; effectiveFrom: string; sourceKind: string }

export default function ItemPriceHistory({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/crm/pricebook/items/${itemId}/history`, { cache: 'no-store' })
        const body = await res.json()
        if (!alive) return
        if (!res.ok) { setFailed(true); return }
        setRows((body.items ?? []).filter((r: Row) => r.field === 'listPrice'))
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => { alive = false }
  }, [itemId])

  if (failed) return <p className={styles.small}>이력을 불러오지 못했어요.</p>
  if (!rows) return null
  if (rows.length === 0) return <p className={styles.small}>{PRICEBOOK.historyEmpty}</p>
  return (
    <div>
      <span className="label">{PRICEBOOK.detailHistory}</span>
      <ul className={styles.small}>
        {rows.slice(0, 5).map((r) => (
          <li key={r.id}>{r.effectiveFrom.slice(0, 10)} <Sensitive>{r.amountMinor === null ? '—' : `${Number(r.amountMinor).toLocaleString('ko-KR')}원`}</Sensitive></li>
        ))}
      </ul>
    </div>
  )
}
