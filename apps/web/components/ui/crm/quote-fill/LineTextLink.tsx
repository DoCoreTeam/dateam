'use client'

// 표 항목 옆 「글 N째 줄」 — 이 항목이 글의 어느 줄에서 나왔나. 누르면 편집기가 그 줄을 고른다.
// 편집 화면에만 선다. 견적서에는 안 실린다.

import { TEXT_FILL } from '@/lib/terms'
import type { QuoteLineDraft } from '../quote-draft-shape'
import { fromLinesOf } from './text-fill-apply'
import { textLink, useTextLink } from './text-link-store'
import styles from './quote-fill.module.css'

export default function LineTextLink({ line }: { line: QuoteLineDraft }) {
  const { active } = useTextLink()
  const from = fromLinesOf(line)
  if (from.length === 0) return null
  const on = active !== null && from.includes(active)
  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.chipLink} ${on ? styles.chipActive : ''}`}
      aria-pressed={on}
      onClick={() => textLink.reveal(from[0])}
    >
      {TEXT_FILL.fromLine(from[0])}
    </button>
  )
}
