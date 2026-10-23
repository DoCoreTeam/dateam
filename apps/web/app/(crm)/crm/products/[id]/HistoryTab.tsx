'use client'

// 변경 이력 — 품목 정상가가 언제 얼마에서 얼마로, 누가 어디서(손으로, 파일, 견적) 바꿨나.
// 더해지기만 하는 표다. 지난 견적은 이 흐름과 상관없이 그날 값 그대로다.

import { useEffect, useState } from 'react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import Sensitive from '@/components/crm/Sensitive'
import { PRICEBOOK } from '@/lib/terms'
import { kstDateKey } from '@/lib/datetime/kst'
import { readableFileName } from '@/lib/crm/domain/pricebook/source-label'
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

function fileLabel(name: string | null): string {
  const readable = readableFileName(name)
  return readable ? PRICEBOOK.historyByFile(readable) : PRICEBOOK.historyByImport
}

export default function HistoryTab({ productId }: { productId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const { query, set } = useListQuery({ view: 'table', size: 100, sort: { key: 'createdAt', dir: 'desc' }, mode: 'more' })
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

  const columns: ColumnDef<Row>[] = [
    { key: 'item', header: PRICEBOOK.tabItem, primary: true, cell: (r) => r.itemName },
    {
      key: 'amount', header: PRICEBOOK.listPrice, align: 'right',
      cell: (r) => (r.field === 'confirmed' ? PRICEBOOK.confirmed : r.amountMinor === null ? '—' : <Sensitive>{won(r.amountMinor)}</Sensitive>),
    },
    { key: 'from', header: PRICEBOOK.gradeFrom, cell: (r) => r.effectiveFrom.slice(0, 10) },
    {
      key: 'where', header: PRICEBOOK.historyWhere,
      cell: (r) => (
        <>
          {r.sourceKind === 'FILE' ? fileLabel(r.sourceName) : (SOURCE[r.sourceKind] ?? r.sourceKind)}
          <span className={styles.small}> · {kstDateKey(r.createdAt)}</span>
        </>
      ),
    },
  ]
  return <ListSurface rows={rows} columns={columns} query={query} onChange={set} rowKey={(r) => r.id} empty={{ title: PRICEBOOK.historyEmpty }} />
}
