'use client'

// 자동으로 채운 값 — 사람이 말하지 않아 엔진이 채운 칸을 한 줄씩. 견적서에는 안 실린다.

import { PRICEBOOK, PROVENANCE_LABEL } from '@/lib/terms'
import type { QuoteDraft } from '../quote-draft-shape'
import styles from './quote-fill.module.css'

export default function AutoFilledList({ draft }: { draft: QuoteDraft }) {
  const items = draft.autoFilled ?? []
  if (items.length === 0) return null
  return (
    <details>
      <summary className="label">{PRICEBOOK.autoFilled} {items.length}개</summary>
      <ul className={styles.filled}>
        {items.map((a, k) => (
          <li key={k}>
            <b>{a.field} {a.value}</b>: {a.provenance.note ?? PROVENANCE_LABEL[a.provenance.source as keyof typeof PROVENANCE_LABEL] ?? a.provenance.source}
          </li>
        ))}
      </ul>
    </details>
  )
}
