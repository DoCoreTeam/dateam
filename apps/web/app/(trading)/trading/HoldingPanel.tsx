// app/(trading)/trading/HoldingPanel.tsx — 지금 들고 있는 것
//
// **카드 한 장이다.** 「내가 적은 것」·「증권사가 준 체결」·「증권사 계좌」 셋은 전부
// 같은 질문에 답한다 — 지금 뭘 들고 있고 얼마인가. 칸을 셋으로 갈라 두면 스크롤이 셋이 되고,
// 읽는 사람은 셋을 눈으로 맞춰야 한다 (사용자 지적 2026-09-27 「지금 화면 스크롤은 너무 과한데?」,
// 2026-09-30 「자리 너무 많이 차지해」).
//
// 세 블록의 **뜻이 다르다는 것**은 소제목이 말한다. 내가 적은 것과 증권사가 준 것을
// 섞어 읽으면 대조가 무의미해진다.

import EntryPanel, { type EntryPanelProps } from './EntryPanel'
import PositionPanel from './PositionPanel'
import AccountPanel from './AccountPanel'
import type { HoldingRow, DayPnlRow } from '@/lib/trading/overview-shape'
import { HOLDING_PANEL_LABEL } from '@/lib/trading/position-labels'
import styles from './HoldingPanel.module.css'

export default function HoldingPanel(props: {
  entry: EntryPanelProps
  holding: HoldingRow | null
  dayPnl: DayPnlRow
}) {
  return (
    <section className={`card ${styles.panel}`}>
      <h2 className={styles.title}>{HOLDING_PANEL_LABEL.title}</h2>
      {/* 내가 적은 것이 먼저다 — 증권사 계좌가 막혀 있어도 이 줄은 늘 산다 */}
      <EntryPanel {...props.entry} />
      <hr className={styles.rule} />
      <PositionPanel holding={props.holding} dayPnl={props.dayPnl} />
      <hr className={styles.rule} />
      <AccountPanel />
    </section>
  )
}
