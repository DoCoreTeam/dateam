'use client'

/**
 * 기다리는 동안 화면이 하는 말 — **한 벌만 둔다.**
 *
 * 무엇을 하는 중인지 · 경과 시간 · 오래 걸릴 때의 덧말, 셋을 같은 모양으로 그린다.
 * 회의노트가 v0.7.684 에 이 모양을 만들었는데 부품이 아니라 그 화면 안에만 있었다.
 * 그래서 견적 쪽은 같은 지적을 따로 받을 때까지 「읽는 중…」 한 마디였다
 * (사용자 지적 2026-09-20). 같은 성격은 같은 모양이어야 한다.
 *
 * **문구는 여기서 정하지 않는다.** 순수 함수(`digest-progress` · `quote-read-progress`)가
 * 정하고 이 부품은 모양만 맡는다 — 컴포넌트 안의 식은 실브라우저 말고 검증할 수단이 없다.
 */

import AXDotLoader from './AXDotLoader'
import styles from './wait-progress.module.css'

export interface WaitProgressProps {
  /** 지금 무엇을 하는 중인지 — 한 문장 */
  message: string
  /** 경과 시간. 첫 몇 초는 null 이라 안 그린다 */
  elapsedLabel?: string | null
  /** 오래 걸릴 때만 붙는 덧말 */
  reassure?: string | null
}

export default function WaitProgress({ message, elapsedLabel, reassure }: WaitProgressProps) {
  return (
    /*
      `role="status"` 와 `aria-live="polite"` 가 함께 있어야 화면 낭독기가
      **하던 말을 끊지 않고** 바뀐 문장을 읽는다. 1초마다 바뀌는 자리라 더욱 그렇다.
    */
    <div className={styles.progress} role="status" aria-live="polite">
      <AXDotLoader />
      <div className={styles.body}>
        <span className={styles.msg}>{message}</span>
        {reassure && <span className={styles.hint}>{reassure}</span>}
      </div>
      {elapsedLabel && <span className={styles.clock}>{elapsedLabel}</span>}
    </div>
  )
}
