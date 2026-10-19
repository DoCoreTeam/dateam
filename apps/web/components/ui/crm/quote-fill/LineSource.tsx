'use client'

// 칸의 출처 표시 — 편집 화면에만 선다. 견적서(고객에게 가는 문서)에는 안 실린다.
// 사람이 단가를 고치면 「사람이 고침」으로 바뀌고, 다시 채우기가 그 칸을 덮지 않는다.

import { PRICEBOOK, PROVENANCE_LABEL } from '@/lib/terms'
import type { QuoteLineDraft } from '../quote-draft-shape'
import styles from './quote-fill.module.css'

export default function LineSource({ line }: { line: QuoteLineDraft }) {
  const locked = (line.lockedFields ?? []).includes('unitPrice')
  const p = (line.provenance as { unitPrice?: { source?: string; note?: string | null } } | null)?.unitPrice
  if (!locked && !p?.source) return null
  const source = locked ? 'HUMAN' : String(p?.source)
  const label = locked ? PRICEBOOK.lockedByHuman : PROVENANCE_LABEL[source as keyof typeof PROVENANCE_LABEL] ?? source
  const cls = locked ? styles.chipHuman : source === 'UNVERIFIED' ? styles.chipReview : ''
  const list = line.listPriceMinor ? `${PRICEBOOK.listPrice} ${Number(line.listPriceMinor).toLocaleString('ko-KR')}원` : ''
  return (
    <span className={`${styles.chip} ${cls}`} title={[p?.note, list].filter(Boolean).join(' · ') || undefined}>
      {label}
    </span>
  )
}
