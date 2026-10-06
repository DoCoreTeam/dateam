'use client'

/**
 * 한 항목의 **「얼마를 얼마 동안」** 칸 묶음.
 *
 * ## 왜 넷이 한 칸에 있나
 *
 * 수량과 기간은 **곱해지는 한 쌍**이다 — 「17대를 2개월」은 한 질문이지 두 질문이 아니다.
 * 넷을 각자 격자 칸으로 두면 12칼럼이 14가 되어 줄이 깨지고, 좁은 폭에서 기간만
 * 혼자 다음 줄로 떨어져 「17대」와 「2개월」이 서로 다른 줄에서 읽힌다.
 *
 * ## 왜 종류를 안 가리나
 *
 * 공급 기간 날짜 칸(`QuoteLinePeriodFields`)은 시간으로 파는 종류에만 세워 두었는데,
 * 실측 2026-10-06 품목 164줄 가운데 그 칸을 쓴 줄이 **0줄**이었다.
 * 숨긴 칸은 안 쓰인다. 그리고 「17대를 2개월 빌려 준다」는 **수량** 종류의 줄이라,
 * 시간으로 파는 종류에만 세우면 이번 사고가 그대로 되풀이된다.
 *
 * ## 기간은 안 적어도 되는 칸이다
 *
 * 비면 배수가 1 이고 그것이 지금까지의 셈이다 — 1 을 기본값으로 박아 두면
 * 안 적은 줄에도 「× 1개월」이 인쇄된다.
 */

import { QUOTE, DURATION, DURATION_UNIT_ORDER, DURATION_UNIT_LABEL } from '@/lib/terms'
import { LINE_KIND_QUANTITY_LABEL, type QuoteLineKind } from '@/lib/terms/cost'
import styles from './quote-panel.module.css'

export interface QuoteLineQuantityFieldsProps {
  index: number
  kind: QuoteLineKind
  quantity: string
  unit: string
  durationValue: string
  durationUnit: string
  disabled: boolean
  onChange: (patch: {
    quantity?: string
    unit?: string
    durationValue?: string
    durationUnit?: string
  }) => void
}

export default function QuoteLineQuantityFields({
  index, kind, quantity, unit, durationValue, durationUnit, disabled, onChange,
}: QuoteLineQuantityFieldsProps) {
  return (
    <div className={`${styles.field} ${styles.colAmount}`}>
      <div className={styles.axisRow}>
        <div className={styles.axisQty}>
          <label className="label" htmlFor={`ln-qty-${index}`}>
            {LINE_KIND_QUANTITY_LABEL[kind]}
          </label>
          <input
            id={`ln-qty-${index}`}
            className="input-field"
            inputMode="decimal"
            value={quantity}
            disabled={disabled}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </div>
        <div className={styles.axisUnit}>
          <label className="label" htmlFor={`ln-unit-${index}`}>{QUOTE.lineUnit}</label>
          <input
            id={`ln-unit-${index}`}
            className="input-field"
            value={unit}
            disabled={disabled}
            onChange={(e) => onChange({ unit: e.target.value })}
          />
        </div>
        {/*
          곱셈 기호를 **칸 사이에** 둔다. 라벨만으로는 두 수가 더해지는지 곱해지는지
          알 수 없고, 금액이 어떻게 나왔는지가 그 자리에서 안 따라진다.
        */}
        <span className={styles.axisTimes} aria-hidden>{QUOTE.durationTimesSign}</span>
        <div className={styles.axisQty}>
          <label className="label" htmlFor={`ln-dur-${index}`}>{DURATION.label}</label>
          <input
            id={`ln-dur-${index}`}
            className="input-field"
            inputMode="decimal"
            value={durationValue}
            disabled={disabled}
            placeholder={DURATION.placeholder}
            onChange={(e) => onChange({ durationValue: e.target.value })}
          />
        </div>
        <div className={styles.axisUnit}>
          <label className="label" htmlFor={`ln-durunit-${index}`}>{DURATION.unitLabel}</label>
          <select
            id={`ln-durunit-${index}`}
            className="input-field"
            value={durationUnit}
            disabled={disabled}
            onChange={(e) => onChange({ durationUnit: e.target.value })}
          >
            {/* 빈 선택지가 먼저다 — 기간은 **안 적어도 되는 칸**이다 */}
            <option value="">{DURATION.none}</option>
            {DURATION_UNIT_ORDER.map((u) => (
              <option key={u} value={u}>{DURATION_UNIT_LABEL[u]}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
