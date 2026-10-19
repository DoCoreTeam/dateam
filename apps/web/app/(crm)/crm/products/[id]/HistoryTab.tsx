'use client'

// 변경 이력 — 품목 정상가가 언제 얼마에서 얼마로, 누가 어디서(손으로, 파일, 견적) 바꿨나.
// 더해지기만 하는 표다. 지난 견적은 이 흐름과 상관없이 그날 값 그대로다.

import { useEffect, useState } from 'react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import Sensitive from '@/components/crm/Sensitive'
import { PRICEBOOK } from '@/lib/terms'
import { kstDateKey } from '@/lib/datetime/kst'
import { won } from './detail-shape'
import styles from './detail.module.css'

interface Row {
  id: string
  itemName: string
  field: string
  amountMinor: string | null
  effectiveFrom: string
  sourceKind: string
  sourceName: string | null
  createdAt: string
}

const SOURCE: Record<string, string> = { HAND: PRICEBOOK.historyByHand, SEED: '처음 채움', QUOTE: '견적에서' }

export default function HistoryTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/crm/pricebook/products/${productId}/history`, { cache: 'no-store' })
        const body = await res.json()
        if (!alive) return
        if (!res.ok) { setError(body?.error?.message ?? '이력을 불러오지 못했습니다.'); return }
        setRows(body.items ?? [])
      } catch {
        if (alive) setError('이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      }
    })()
    return () => { alive = false }
  }, [productId])

  if (error) return <ErrorState message={error} />
  if (!rows) return <AXDotLoader />
  if (rows.length === 0) return <EmptyState title={PRICEBOOK.historyEmpty} />

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{PRICEBOOK.tabItem}</th>
            <th className={styles.num}>{PRICEBOOK.listPrice}</th>
            <th>{PRICEBOOK.gradeFrom}</th>
            <th>{PRICEBOOK.historyWhere}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.itemName}</td>
              <td className={styles.num}>
                {r.field === 'confirmed' ? PRICEBOOK.confirmed : r.amountMinor === null ? '—' : <Sensitive>{won(r.amountMinor)}</Sensitive>}
              </td>
              <td>{r.effectiveFrom.slice(0, 10)}</td>
              <td>
                {r.sourceKind === 'FILE' && r.sourceName ? PRICEBOOK.historyByFile(r.sourceName) : (SOURCE[r.sourceKind] ?? r.sourceKind)}
                <span className={styles.small}> · {kstDateKey(r.createdAt)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
