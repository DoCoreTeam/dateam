'use client'

/**
 * 기간 고르는 칸: **한 부품**
 *
 * 왜 부품인가: 리포트의 두 탭이 같은 질문을 한다. 「어느 기간을 보나」인데 한쪽은
 * 칩과 앞뒤 단추로, 다른 쪽은 브라우저 기본 드롭다운 셋(종류·연도·칸)으로 묻고 있었다
 * (실측 2026-10-02). 같은 질문을 두 모양으로 물으면 쓰는 사람은 두 화면을 **다른 제품**
 * 으로 배우고, 고치는 사람은 한쪽만 고친다.
 *
 * **종류를 고르는 일과 때를 옮기는 일을 가른다.** 왼쪽 칩은 「무슨 단위로 보나」,
 * 오른쪽 앞뒤 단추는 「그 단위에서 어느 때를 보나」다. 둘을 한 줄에 섞으면
 * 「이번 달·이번 분기·올해」처럼 단위와 때가 엉킨 목록이 되고, 그러면 **지난 분기를
 * 볼 길이 사라진다**. 실제로 그랬다.
 *
 * 말은 용어집이 들고(`PERIOD_KIND_LABEL`·`REPORT.periodPrev`) 순서는 용어집이 든다
 * (`PERIOD_KIND_ORDER`). 이 파일은 그리기만 한다. 날짜 셈도 모른다. 부르는 쪽이
 * 다음 기간을 만들어 넘긴다.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PERIOD_KIND_LABEL, PERIOD_KIND_ORDER, REPORT, type PeriodKindKey } from '@/lib/terms/report'
import styles from './period-picker.module.css'

export default function PeriodPicker({
  activeKind, label, onKind, onStep, extra, trailing,
}: {
  /** 지금 고른 종류. 달력 기간이 아닌 것을 보고 있으면 `null` 이라 아무 칩도 안 눌린다 */
  activeKind: PeriodKindKey | null
  /** 지금 보고 있는 때의 이름. `null` 이면 앞뒤 단추를 안 그린다(옮길 뜻이 없는 기간) */
  label: string | null
  onKind: (kind: PeriodKindKey) => void
  onStep: (step: -1 | 1) => void
  /** 달력에 없는 기간 하나(「최근 12개월」). 쓰는 탭에서만 넘긴다 */
  extra?: { label: string; active: boolean; onPick: () => void }
  /** 기간 줄 끝에 붙는 것. 날짜 범위나 비교 고르기 */
  trailing?: React.ReactNode
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.tabs} role="group" aria-label={REPORT.period}>
        {PERIOD_KIND_ORDER.map((k) => {
          const on = activeKind === k
          return (
            <button
              key={k} type="button"
              className={`${styles.tab}${on ? ` ${styles.tabOn}` : ''}`}
              onClick={() => onKind(k)}
              aria-pressed={on}
            >
              {PERIOD_KIND_LABEL[k]}
            </button>
          )
        })}
        {extra && (
          <button
            type="button"
            className={`${styles.tab}${extra.active ? ` ${styles.tabOn}` : ''}`}
            onClick={extra.onPick}
            aria-pressed={extra.active}
          >
            {extra.label}
          </button>
        )}
      </div>

      {/* 옮길 뜻이 없는 기간(굴러가는 12개월)에는 앞뒤가 없다. 단추를 안 그린다 */}
      {label !== null && (
        <div className={styles.nav}>
          <button
            type="button" className={styles.step}
            onClick={() => onStep(-1)}
            aria-label={REPORT.periodPrev}
            title={REPORT.periodPrev}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <span className={styles.now}>{label}</span>
          <button
            type="button" className={styles.step}
            onClick={() => onStep(1)}
            aria-label={REPORT.periodNext}
            title={REPORT.periodNext}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      )}

      {trailing}
    </div>
  )
}
