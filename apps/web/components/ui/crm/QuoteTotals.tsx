'use client'

// 견적 합계 — 공급가액부터 **합계 금액**까지, 그리고 그 사이의 절사.
//
// 편집 모달에서 떼어 낸 이유: 이 덩어리는 **한 가지 질문에 답한다** — 「얼마인가」.
// 항목을 고치는 일(품목·수량·단가)과 섞여 있으면, 절사를 고치러 온 사람이
// 항목 스무 줄을 지나쳐 내려가야 한다.
//
// **계산은 여기서 하지 않는다.** 받은 값을 그릴 뿐이다.
// 화면이 보여 주는 숫자와 저장되는 숫자는 `quote-math` 한 함수에서 나온다.

import { useState } from 'react'
import { ROUNDING_UNITS, roundAmount, type RoundingMode, type computeTotals } from '@/lib/crm/domain/quote-math'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import {
  QUOTE, ROUNDING_MODES, roundingUnitLabel, roundingNote, type RoundingModeKey,
  RATE_AXIS_ORDER, RATE_AXIS_LABEL, LINE_NOTE_ORDER, LINE_NOTE_LABEL,
  TOTAL_CONV_ORDER, TOTAL_CONV_LABEL,
  HOURS_BASIS_ORDER, HOURS_BASIS_LABEL, HOURS_BASIS_HINT, HOURS_BASIS_NO_SUPPLY,
  HOURS_BASIS_NOTE, HOURS_BASIS_NOTE_HOURS, HOURS_BASIS_NO_MONTHS,
  RATE_PERIOD_MISSING, RATE_HOURS_MISSING, APPROX_PREFIX, RATE_GROUP_TITLE,
  type HoursBasisKey,
} from '@/lib/terms'
import {
  computePeriod, hourlyFromTotal, monthsFromHours, DEFAULT_HOURS_PER_MONTH,
} from '@/lib/crm/domain/quote-rate'
import { LINE_KIND_UNIT } from '@/lib/terms/cost'
import styles from './quote-panel.module.css'

export interface QuoteTotalsProps {
  totals: ReturnType<typeof computeTotals>
  currency: string
  roundingUnit: number
  roundingMode: string
  /** 보낸 견적은 못 고친다 */
  locked: boolean
  onRoundingChange: (patch: { unit?: number; mode?: string }) => void
  /**
   * 금액 표시. **종류가 사용량·기간요금인 줄이 있을 때만** 이 자리가 선다 —
   * 장비 납품 견적에 「시간당 얼마」를 묻는 칸이 서면 쓰지도 않을 것을 매번 지나쳐야 한다.
   */
  rate?: QuoteRateChoice
  onRateChange?: (patch: Partial<QuoteRateChoice>) => void
  /** 모든 품목이 같은 기간일 때 그 기간. 선택지 옆 미리보기 숫자를 여기서 만든다 */
  ratePeriod?: { start: string; end: string } | null
  /**
   * 기간이 없을 때 **수량이 말하는 총 시간**(「1,440 Hours」). 기간이 있으면 null 이다.
   *
   * 이 값이 있으면 날짜를 안 적어도 견적서가 시간당과 월 금액을 인쇄한다 —
   * 그래서 미리보기도 안내 문구도 이 값을 보고 갈라진다.
   */
  rateHours?: number | null
  /**
   * **한 줄이라도 환산이 그려지나.** 안내는 이 값으로 갈린다 — 합계 환산이 서느냐와
   * 다른 질문이라, 한 신호로 쓰면 되는 것을 안 된다고 말하게 된다.
   */
  rateAnyHours?: boolean
  /**
   * 매입 견적이 쓰는 월 기준 시간. 없으면 「매입에 맞춤」이 못 쓰는 상태로 선다.
   * **지금은 늘 null 이다** — 매입과 견적을 잇는 일은 이 플랜 범위 밖이고,
   * 실측에서 취급 상품 88개 중 24개는 매입 자료가 아예 없다.
   */
  supplyHoursPerMonth?: number | null
}

/** 무엇을 함께 인쇄할지 — 넷이 한 벌이다 */
export interface QuoteRateChoice {
  rateAxisKeys: string[]
  lineNoteKeys: string[]
  totalConvKeys: string[]
  /** 빈 문자열이면 설정 기본값(730) */
  rateHoursPerMonth: string
}

/**
 * 적힌 수가 네 선택지 중 어느 것인가.
 *
 * **빈 값은 「직접」이 아니라 기본값이다**(730). 그래서 「직접」을 누른 사실은
 * 값만 봐서는 알 수 없고 — 눌러서 칸을 비우면 다시 730 으로 읽힌다 — 화면이
 * 따로 들고 있어야 한다(`customOn`).
 */
function basisOf(choice: QuoteRateChoice, supply: number | null): HoursBasisKey {
  const raw = choice.rateHoursPerMonth
  if (raw === '') return 'h730'
  const n = Number(raw)
  if (supply != null && n === supply) return 'supply'
  if (n === DEFAULT_HOURS_PER_MONTH) return 'h730'
  if (n === 720) return 'h720'
  return 'custom'
}

/** 선택지가 가리키는 시간. 「직접」은 적은 수가 범위 안일 때만 숫자가 된다 */
function hoursFor(
  k: HoursBasisKey, choice: QuoteRateChoice, supply: number | null,
): number | null {
  if (k === 'h730') return DEFAULT_HOURS_PER_MONTH
  if (k === 'h720') return 720
  if (k === 'supply') return supply
  const n = Number(choice.rateHoursPerMonth)
  return Number.isInteger(n) && n >= 1 && n <= 8784 ? n : null
}

export default function QuoteTotals({
  totals, currency, roundingUnit, roundingMode, locked, onRoundingChange,
  rate, onRateChange, ratePeriod, rateHours = null, rateAnyHours = false,
  supplyHoursPerMonth = null,
}: QuoteTotalsProps) {
  /*
    **「직접」은 값으로 알 수 없다.** 누르면 칸이 비는데 빈 값은 기본값(730)이라
    누른 순간 선택이 730 으로 되돌아가고 적을 칸이 영영 안 열린다.
    그래서 누른 사실을 여기서 들고, 저장된 수가 이미 선택지 밖이면 처음부터 열어 둔다.
  */
  const [customOn, setCustomOn] = useState(
    () => (rate ? basisOf(rate, supplyHoursPerMonth) === 'custom' : false),
  )
  const basis: HoursBasisKey | null = rate
    ? (customOn ? 'custom' : basisOf(rate, supplyHoursPerMonth))
    : null
  /*
    **선택지 옆에 결과를 붙인다.** 절사 칸이 이미 그렇게 되어 있다(「백만원 단위 · 303,000,000원」).
    이름만 두면 730 과 720 이 무엇을 바꾸는지 고르는 사람이 알 수 없다 — 1.4% 가 얼마인지는 더 모른다.

    여기서 보이는 것은 **시간당 환산값**이다. 월 중심이면 합계는 기준이 바뀌어도 안 움직이고
    이 숫자만 달라지기 때문이다.
  */
  const hourlyAt = (hours: number): string | null => {
    /*
      **총 시간의 근거는 둘이다** — 기간을 적었으면 기간이, 안 적었으면 수량이 센다.
      전에는 기간만 봐서, 날짜 없는 시간 품목에서는 고를 때 아무 숫자도 안 보였다.
      수량이 센 시간은 기준을 730 으로 하든 720 으로 하든 안 움직인다(그때 갈리는 것은
      개월이고, 그 사실은 아래 안내 문구가 말한다).
    */
    const totalHours = ratePeriod
      ? computePeriod(ratePeriod.start, ratePeriod.end, hours)?.totalHours ?? null
      : rateHours
    if (!totalHours) return null
    /*
      **견적서가 나눌 그 금액을 똑같이 나눈다.** 문서 조립은 품목 금액의 합
      (할인 반영·세금 제외)을 나눈다(`quote-document.ts` totalConv). 여기서
      계(세금 얹은 값)를 나누면 미리 보여 준 숫자와 인쇄된 숫자가 갈린다 —
      실측 1,506원 대 1,369원.
    */
    const lineSum = Number((totals.subtotalMinor - totals.discountMinor).toString())
    const h = hourlyFromTotal(lineSum, totalHours)
    if (!h) return null
    const money = formatAmount(String(h.minor), currency)
    return h.exact ? money : `${APPROX_PREFIX} ${money}`
  }

  /*
    **선택지 옆에 붙는 결과는 무엇이 달라지느냐를 따른다.**

    기간이 시간을 세면 기준에 따라 총 시간이 달라지므로 바뀌는 것은 시간당이다.
    수량이 세면(「1,440 Hours」) 총 시간이 고정이라 시간당도 안 움직이고, 바뀌는 것은
    그 시간을 **몇 달로 보느냐**다 — 1,440시간은 720 기준이면 2개월이고 730 기준이면
    개월이 안 떨어져 월 금액을 못 적는다. 실측 2026-10-05: 그때 두 선택지 옆에
    1,388원이 나란히 서서 **고르는 사람이 무엇을 고르는지 알 수 없었다.**
  */
  const resultAt = (hours: number): string | null => {
    if (ratePeriod) return hourlyAt(hours)
    if (!rateHours) return null
    const m = monthsFromHours(rateHours, hours)
    return m == null ? HOURS_BASIS_NO_MONTHS : `${m}${LINE_KIND_UNIT.PERIOD}`
  }

  const toggle = (list: string[], key: string): string[] =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key]

  return (
  <div className={styles.totals}>
    <div className={styles.totalRow}>
      <span>{QUOTE.subtotal}</span><span>{formatAmount(totals.subtotalMinor.toString(), currency)}</span>
    </div>
    {/*
      **할인이 0이면 할인 줄이 없다.** 「할인 0원」은 빈칸으로 안 읽히고
      «일부러 안 줬다»로 읽힌다(사용자 지적 2026-09-20). 여기서 안 보이는 줄은
      견적서·인쇄·엑셀에서도 안 보인다 — 셋이 같은 규칙을 쓴다.
    */}
    {totals.discountMinor !== BigInt(0) && (
      <div className={styles.totalRow}>
        <span>{QUOTE.discount}</span>
        <span>{totals.discountMinor > BigInt(0) ? '− ' : ''}{formatAmount(totals.discountMinor.toString(), currency)}</span>
      </div>
    )}
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
    {/*
      **금액 표시 — 종류가 사용량·기간요금일 때만 선다.**

      장비 납품 견적에 「시간당 얼마」를 묻는 칸이 서면 쓰지도 않을 것을 매번 지나쳐야 한다.
      부르는 쪽이 그 판단을 해서 rate 를 주거나 안 준다.
    */}
    {rate && onRateChange && (
      <div className={styles.rateBlock}>
        <span className="label">{QUOTE.rateDisplay}</span>
        {/*
          **못 그리는 것만 말한다.** 수량이 시간이면 날짜가 없어도 시간당과 월 금액이
          인쇄되므로, 그때 「못 쓴다」고 적으면 되는 것을 안 된다고 읽게 만든다.
        */}
        {!ratePeriod && (
          <p className={styles.rateNote}>
            {rateAnyHours ? RATE_PERIOD_MISSING : RATE_HOURS_MISSING}
          </p>
        )}

        <fieldset className={styles.rateGroup} disabled={locked}>
          <legend className={styles.rateLegend}>{RATE_GROUP_TITLE.axis}</legend>
          {RATE_AXIS_ORDER.map((k) => (
            <label key={k} className={styles.rateCheck}>
              <input
                type="checkbox"
                checked={rate.rateAxisKeys.includes(k)}
                onChange={() => onRateChange({ rateAxisKeys: toggle(rate.rateAxisKeys, k) })}
              />
              <span>{RATE_AXIS_LABEL[k]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className={styles.rateGroup} disabled={locked}>
          <legend className={styles.rateLegend}>{RATE_GROUP_TITLE.lineNote}</legend>
          {LINE_NOTE_ORDER.map((k) => (
            <label key={k} className={styles.rateCheck}>
              <input
                type="checkbox"
                checked={rate.lineNoteKeys.includes(k)}
                onChange={() => onRateChange({ lineNoteKeys: toggle(rate.lineNoteKeys, k) })}
              />
              <span>{LINE_NOTE_LABEL[k]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className={styles.rateGroup} disabled={locked}>
          <legend className={styles.rateLegend}>{RATE_GROUP_TITLE.totalConv}</legend>
          {TOTAL_CONV_ORDER.map((k) => (
            <label key={k} className={styles.rateCheck}>
              <input
                type="checkbox"
                checked={rate.totalConvKeys.includes(k)}
                onChange={() => onRateChange({ totalConvKeys: toggle(rate.totalConvKeys, k) })}
              />
              <span>{TOTAL_CONV_LABEL[k]}</span>
            </label>
          ))}
        </fieldset>

        {/*
          **월 기준 시간 — 선택지 옆에 그 선택의 결과를 붙인다.**
          절사 칸이 이미 그렇게 되어 있다. 730 과 720 이 무엇을 바꾸는지는
          이름으로 알 수 없고, 바뀌는 것은 **시간당 환산값 하나**다.
        */}
        <fieldset className={styles.rateGroup} disabled={locked}>
          <legend className={styles.rateLegend}>{QUOTE.hoursPerMonth}</legend>
          {HOURS_BASIS_ORDER.map((k) => {
            const on = basis === k
            const noSupply = k === 'supply' && supplyHoursPerMonth == null
            /*
              **「직접」은 선택하기 전까지 숫자를 안 보인다.** 적힌 수는 지금 고른 선택지의
              것이라, 730 을 고른 채로 「직접」 옆에 그 환산값을 적으면 **고르지도 않은
              선택지가 결과를 약속한다**(실측: 720 을 고르자 「직접」 옆에도 720 값이 섰다).
            */
            const hours = k === 'custom' && basis !== 'custom'
              ? null : hoursFor(k, rate, supplyHoursPerMonth)
            const result = hours != null ? resultAt(hours) : null
            return (
              <label key={k} className={`${styles.rateRadio}${on ? ` ${styles.rateRadioOn}` : ''}`}>
                <input
                  type="radio"
                  name="q-hours-basis"
                  checked={on}
                  disabled={noSupply}
                  onChange={() => {
                    setCustomOn(k === 'custom')
                    // 「직접」은 칸을 비워 열어 둔다 — 적기 전까지는 기본값으로 저장된다
                    onRateChange({
                      rateHoursPerMonth: k === 'h730' ? String(DEFAULT_HOURS_PER_MONTH)
                        : k === 'h720' ? '720'
                        : k === 'supply' ? String(supplyHoursPerMonth ?? '') : '',
                    })
                  }}
                />
                <span className={styles.rateRadioBody}>
                  <span>{HOURS_BASIS_LABEL[k]}</span>
                  {/* 못 쓰는 선택지는 **왜 못 쓰는지**를 그 자리에 적는다 */}
                  <span className={styles.rateRadioNote}>
                    {noSupply ? HOURS_BASIS_NO_SUPPLY : (result ?? HOURS_BASIS_HINT[k])}
                  </span>
                </span>
              </label>
            )
          })}
        </fieldset>

        {basis === 'custom' && (
          <input
            className="input-field"
            inputMode="numeric"
            aria-label={QUOTE.hoursPerMonth}
            value={rate.rateHoursPerMonth}
            disabled={locked}
            /* 밖으로 나가는 값이라 숫자만 추린다 — 서버와 DB 도 범위를 다시 본다 */
            onChange={(e) => onRateChange({ rateHoursPerMonth: e.target.value.replace(/[^\d]/g, '') })}
          />
        )}

        <p className={styles.rateNote}>
          {ratePeriod ? HOURS_BASIS_NOTE : rateHours ? HOURS_BASIS_NOTE_HOURS : HOURS_BASIS_NOTE}
        </p>
      </div>
    )}
    <div className={styles.grandRow}>
      <span>{QUOTE.total}</span><span>{formatAmount(totals.totalMinor.toString(), currency)}</span>
    </div>
  </div>
  )
}
