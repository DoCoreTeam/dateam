'use client'

// 견적 합계 — 공급가액부터 **합계 금액**까지, 그리고 그 사이의 절사.
//
// 편집 모달에서 떼어 낸 이유: 이 덩어리는 **한 가지 질문에 답한다** — 「얼마인가」.
// 항목을 고치는 일(품목·수량·단가)과 섞여 있으면, 절사를 고치러 온 사람이
// 항목 스무 줄을 지나쳐 내려가야 한다.
//
// **계산은 여기서 하지 않는다.** 받은 값을 그릴 뿐이다.
// 화면이 보여 주는 숫자와 저장되는 숫자는 `quote-math` 한 함수에서 나온다.

import { ROUNDING_UNITS, roundAmount, type RoundingMode, type computeTotals } from '@/lib/crm/domain/quote-math'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import {
  QUOTE, ROUNDING_MODES, roundingUnitLabel, roundingNote, type RoundingModeKey,
} from '@/lib/terms'
import styles from './quote-panel.module.css'

export interface QuoteTotalsProps {
  totals: ReturnType<typeof computeTotals>
  currency: string
  roundingUnit: number
  roundingMode: string
  /** 보낸 견적은 못 고친다 */
  locked: boolean
  onRoundingChange: (patch: { unit?: number; mode?: string }) => void
}

export default function QuoteTotals({
  totals, currency, roundingUnit, roundingMode, locked, onRoundingChange,
}: QuoteTotalsProps) {
  return (
  <div className={styles.totals}>
    <div className={styles.totalRow}>
      <span>{QUOTE.subtotal}</span><span>{formatAmount(totals.subtotalMinor.toString(), currency)}</span>
    </div>
    <div className={styles.totalRow}>
      <span>{QUOTE.discount}</span>
      <span>{totals.discountMinor > BigInt(0) ? '− ' : ''}{formatAmount(totals.discountMinor.toString(), currency)}</span>
    </div>
    <div className={styles.totalRow}>
      <span>{QUOTE.tax}</span><span>{formatAmount(totals.taxMinor.toString(), currency)}</span>
    </div>
    {/*
      **「계」는 절사 직전 금액이다.** 절사가 걸렸을 때만 세운다 —
      안 걸렸으면 합계와 같은 숫자라 같은 값이 두 줄이 된다.
    */}
    {totals.roundingMinor !== BigInt(0) && (
      <div className={styles.totalRow}>
        <span>{QUOTE.netTotal}</span>
        <span>{formatAmount(totals.netTotalMinor.toString(), currency)}</span>
      </div>
    )}
    {/*
      **절사를 여기서 고른다.** 협상 막바지에 「끝자리만 떨어뜨려 주세요」가 나오는데,
      그때 단가를 손으로 조작해 맞추면 나중에 그 단가를 아무도 설명할 수 없다.
      단가는 그대로 두고 절사액만 따로 남긴다.

      **자리가 세금 뒤인 이유**: 절사는 «합계 금액»에 건다. 앞에 두면 그 뒤에
      부가세가 다시 얹혀 고객이 받는 숫자가 또 안 떨어진다
      (실측 v0.7.696: 백만원 버림인데 합계가 303,600,000원이었다).
    */}
    <div className={styles.roundingRow}>
      <label className="label" htmlFor="q-round-unit">{QUOTE.rounding}</label>
      <select
        id="q-round-unit"
        className="input-field"
        value={String(roundingUnit)}
        disabled={locked}
        onChange={(e) => onRoundingChange({ unit: Number(e.target.value) })}
      >
        {/*
          **결과를 라벨에 붙인다.** 「백만원 단위」는 ⓐ 백만원의 배수로 맞춘다
          ⓑ 백만원 자리를 없앤다 두 가지로 읽혀서, 이름만으로는 어느 쪽인지
          고르는 사람이 알 수 없다(사용자 지적 2026-09-08).
          **숫자를 먼저 보여 주면 해석이 갈릴 자리가 없다.**
        */}
        {ROUNDING_UNITS.map((u) => (
          <option key={u} value={u}>
            {u === 0
              ? roundingUnitLabel(0)
              : `${roundingUnitLabel(u)} · ${formatAmount(
                roundAmount(totals.netTotalMinor, { unit: u, mode: roundingMode as RoundingMode }).toString(),
                currency,
              )}`}
          </option>
        ))}
      </select>
      <select
        id="q-round-mode"
        className="input-field"
        value={roundingMode}
        disabled={locked || roundingUnit === 0}
        onChange={(e) => onRoundingChange({ mode: e.target.value })}
      >
        {ROUNDING_MODES.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span className={styles.roundingAmount}>
        {totals.roundingMinor === BigInt(0)
          ? ''
          /*
            **부호를 값에서 읽는다.** 올림은 «깎은» 것이 아니라 더한 것이라
            절사액이 음수다 — 「−」를 박아 두면 올림에서 부호가 거꾸로 찍힌다.
          */
          : `${totals.roundingMinor > BigInt(0) ? '−' : '＋'} ${formatAmount(
            (totals.roundingMinor > BigInt(0) ? totals.roundingMinor : -totals.roundingMinor).toString(),
            currency,
          )}`}
      </span>
    </div>
    {/*
      **무엇에 맞췄는지 말한다.** 숫자만 두면 읽는 사람이 «깎인 금액의 자릿수»로
      단위를 역산하게 되고, 그러면 백만원 버림이 십만원 버림으로 읽힌다
      (실측 v0.7.698: 「− 600,000원」만 보고 십만원 단위로 오해).
    */}
    {roundingNote(roundingUnit, roundingMode as RoundingModeKey) && (
      <p className={styles.roundingNote}>
        {roundingNote(roundingUnit, roundingMode as RoundingModeKey)}
      </p>
    )}
    <div className={styles.grandRow}>
      <span>{QUOTE.total}</span><span>{formatAmount(totals.totalMinor.toString(), currency)}</span>
    </div>
  </div>
  )
}
