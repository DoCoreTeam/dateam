'use client'

/**
 * 한 항목의 **공급 기간** 칸.
 *
 * ## 왜 따로 떨어져 있나
 *
 * 편집 모달이 800줄 상한에 닿았다(`lib/ui/quote-layout.test.ts`). 규격·비고 칸이
 * 같은 이유로 먼저 떨어져 나갔고(`QuoteLineSpecFields`), 기간도 같은 길을 간다.
 *
 * ## 왜 시간으로 파는 줄에만 서나
 *
 * 장비 납품 줄에 기간 칸이 서면 쓰지도 않을 것을 매번 지나쳐야 한다.
 * **사용량**은 시간당이 진짜 값이고 **기간요금**은 월 단가가 진짜 값이라,
 * 둘 다 여기 적은 날짜에서 개월과 총 시간을 세어 나머지 축을 만든다.
 *
 * ## 견적 유효기간과 다르다
 *
 * 유효기간은 「언제까지 이 값이 유효한가」이고 이것은 「언제부터 언제까지 공급하는가」다.
 * 둘을 한 칸으로 합치면 두 달 빌려 주는 견적의 유효기간이 두 달이 된다.
 */

import DateField from '@/components/ui/DateField'
import { PERIOD_START_LABEL, PERIOD_END_LABEL } from '@/lib/terms'
import styles from './quote-panel.module.css'

export interface QuoteLinePeriodFieldsProps {
  index: number
  startDate: string
  endDate: string
  disabled: boolean
  onChange: (patch: { startDate?: string; endDate?: string }) => void
}

export default function QuoteLinePeriodFields({
  index, startDate, endDate, disabled, onChange,
}: QuoteLinePeriodFieldsProps) {
  return (
    <>
      <div className={`${styles.field} ${styles.colPeriod}`}>
        <label className="label" htmlFor={`ln-start-${index}`}>{PERIOD_START_LABEL}</label>
        {/*
          **직접 짜지 않는다.** 날짜 칸은 연도 칸의 자릿수를 안 막아 202609년이 그대로
          통과한다 — 부품이 범위와 지우는 중·치는 중을 함께 들고 온다
          (`lib/ui/date-input-standard.test.ts`).
        */}
        <DateField
          id={`ln-start-${index}`}
          value={startDate}
          disabled={disabled}
          onValueChange={(v) => onChange({ startDate: v })}
        />
      </div>
      <div className={`${styles.field} ${styles.colPeriod}`}>
        <label className="label" htmlFor={`ln-end-${index}`}>{PERIOD_END_LABEL}</label>
        <DateField
          id={`ln-end-${index}`}
          value={endDate}
          disabled={disabled}
          /*
            **끝을 비워 둘 수 있다.** 시작만 알고 끝은 협의 중인 견적이 실제로 있고,
            딜에도 그런 경우를 위한 칸이 따로 있다. 비면 기간을 안 센다.
          */
          min={startDate || undefined}
          onValueChange={(v) => onChange({ endDate: v })}
        />
      </div>
    </>
  )
}
