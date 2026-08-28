'use client'

/**
 * 목록 위의 «간략 합계» (SSOT)
 *
 * **왜 부품인가**: 합계는 목록마다 필요한데(딜·견적·회사), 화면마다 그리면
 * 어떤 목록은 있고 어떤 목록은 없다 — 실제로 딜 목록에 합계가 **아예 없었다**
 * (사용자 지적: 「이거 합계라던지 이런것도 없네? 간략 합계라도 보여줘야지」).
 *
 * **통화를 섞지 않는다.** 1,200 USD 와 1,200,000원을 더한 숫자는 아무 뜻이 없다.
 * 통화마다 따로 적고, 그게 여럿이면 여럿을 보여 준다.
 *
 * **빠진 것을 말한다.** 금액 미정 딜을 0으로 치면 합계가 실제보다 작아지는데
 * 화면은 그 사실을 숨긴다. 몇 건이 빠졌는지 함께 적는다.
 */

import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import styles from './list-summary.module.css'

export interface ListSummaryProps {
  /** 왼쪽 라벨 — 「열린 딜」·「이번 달 수주」처럼 **무엇의** 합계인지 */
  label: string
  /** 건수 */
  count: number
  /** 통화 → minor 문자열 */
  byCurrency: Record<string, string>
  /** 금액이 없어 합계에서 빠진 건수. 0이면 안 그린다 */
  unpriced?: number
  /** 합계가 무엇을 뜻하는지 한 줄 — 「수주 총액 기준」처럼 */
  note?: string
}

export default function ListSummary({ label, count, byCurrency, unpriced = 0, note }: ListSummaryProps) {
  const entries = Object.entries(byCurrency).filter(([, v]) => v !== '0')

  return (
    <div className={styles.bar}>
      <span className={styles.label}>{label}</span>
      <span className={styles.count}>{count}건</span>

      {entries.length === 0 ? (
        // 0원이라고 단정하지 않는다 — 금액을 적은 딜이 없는 것과 합이 0인 것은 다르다
        <span className={styles.none}>금액 미정</span>
      ) : (
        <span className={styles.amounts}>
          {entries.map(([cur, minor]) => (
            <b key={cur} className={styles.amount}>{formatAmount(minor, cur)}</b>
          ))}
        </span>
      )}

      {unpriced > 0 && (
        <span className={styles.unpriced}>금액 미정 {unpriced}건 제외</span>
      )}
      {note && <span className={styles.note}>{note}</span>}
    </div>
  )
}
