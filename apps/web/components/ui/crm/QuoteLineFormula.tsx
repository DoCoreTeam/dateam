'use client'

/**
 * 줄 밑에 서는 **산식 한 줄**.
 *
 * 「936,000원 × 17대 × 2개월 = 31,824,000원」. 치는 즉시 따라 움직여서,
 * 사람이 **저장하기 전에** 두 축이 제대로 곱해졌는지 눈으로 본다.
 *
 * ## 왜 따로 떨어져 있나
 *
 * 편집 모달이 800줄 상한에 닿았다(`lib/ui/quote-layout.test.ts`). 규격·비고·기간이
 * 같은 이유로 먼저 떨어져 나갔고 산식도 같은 길을 간다.
 *
 * ## 왜 인쇄되는 글과 다른가
 *
 * 견적서에 찍히는 축 문구는 `quote-rate-text` 한 곳에서 짓는다 —
 * 저쪽은 「고객이 검산할 수 있게」가 기준이고 여기는 「지금 적은 것이 금액에 닿았나」가
 * 기준이라 같은 글이 아니다. 섞으면 한쪽을 고칠 때 다른 쪽이 조용히 따라 바뀐다.
 */

import { DURATION } from '@/lib/terms'
import styles from './quote-panel.module.css'

export interface QuoteLineFormulaProps {
  /** 빈 문자열이면 그 줄을 안 그린다 — 단가를 아직 안 적은 줄에 「= 0원」이 서면 안 된다 */
  text: string
}

export default function QuoteLineFormula({ text }: QuoteLineFormulaProps) {
  if (!text) return null
  return (
    <p className={styles.lineFormula}>
      <span className={styles.lineFormulaLabel}>{DURATION.formulaLabel}</span>
      <span className={styles.lineFormulaBody}>{text}</span>
    </p>
  )
}
