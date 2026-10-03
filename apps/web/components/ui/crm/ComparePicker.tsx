'use client'

/**
 * 비교 고르는 칸: **한 부품**
 *
 * 왜 부품인가: 리포트의 두 탭이 같은 비교를 고른다. 각자 칩 묶음을 그리면 한쪽만
 * 고쳐지고, 그때부터 같은 화면의 두 탭이 다른 말과 다른 모양으로 같은 것을 묻는다.
 * 이 플랜이 I01 에서 고친 사고가 정확히 그것이었다(기간 이름이 다섯 곳에 따로 있었다).
 *
 * 말은 용어집이 들고(`COMPARE_LABEL`) 목록과 순서는 도메인이 든다(`COMPARE_ORDER`).
 * 이 파일은 그 둘을 그리기만 한다.
 */

import { COMPARE_ORDER, type CompareKey } from '@/lib/crm/domain/period-compare'
import { COMPARE_LABEL, REPORT } from '@/lib/terms/report'
import styles from './compare-picker.module.css'

export default function ComparePicker({ value, onChange }: {
  value: CompareKey
  onChange: (next: CompareKey) => void
}) {
  return (
    <div className={styles.bar} role="group" aria-label={REPORT.compare}>
      {COMPARE_ORDER.map((c) => (
        <button
          key={c} type="button"
          className={`${styles.tab}${c === value ? ` ${styles.tabOn}` : ''}`}
          onClick={() => onChange(c)}
          aria-pressed={c === value}
        >
          {COMPARE_LABEL[c]}
        </button>
      ))}
    </div>
  )
}
