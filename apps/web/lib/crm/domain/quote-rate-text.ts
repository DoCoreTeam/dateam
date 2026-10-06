/**
 * 금액 축과 환산 줄을 **글로 바꾸는 한 곳.**
 *
 * ## 왜 따로 있나
 *
 * 견적서는 세 군데로 나간다 — 화면(`QuoteSheet.tsx`)·인쇄(같은 본문)·엑셀(`quote-xlsx.ts`).
 * 셋이 같은 `QuoteDocument` 를 읽지만 **글을 짓는 일을 각자 하면 서서히 다른 문서가 된다.**
 * 「약」을 붙이는 규칙이 한쪽에만 고쳐지면 화면과 파일이 다른 숫자를 말하게 되고,
 * 그건 고객이 둘을 나란히 놓는 순간 들킨다.
 *
 * ## 셈은 안 한다
 *
 * 값은 문서가 이미 되짚어 두었다(`lineRate`·`totalConv`). 여기서는 **그 값을 어떻게
 * 적을지만** 정한다 — 어떤 말을 앞에 붙이고, 「약」을 붙일지.
 */

// 도메인은 **상대 경로 + .ts** 로 읽는다 — node --test 가 `@/` 별칭을 모른다
import {
  RATE_AXIS_ORDER, RATE_AXIS_LABEL, LINE_NOTE_ORDER, LINE_NOTE_LABEL,
  TOTAL_CONV_ORDER, TOTAL_CONV_LABEL, APPROX_PREFIX, QUOTE,
} from '../../terms/quote.ts'
import { LINE_KIND_UNIT } from '../../terms/cost.ts'
import type { DocumentLine, DocumentTotalConv } from './quote-document.ts'

/** 금액을 글로 바꾸는 법은 부르는 쪽이 안다 — 화면은 통화 기호까지, 엑셀은 수식과 서식이 따로다 */
export type MoneyText = (minor: string) => string

/** 시간은 늘 「1,460h」 꼴이다 — 용어집의 시간 글자를 쓴다 */
export function hoursText(n: number): string {
  return `${n.toLocaleString('ko-KR')}${QUOTE.hourUnit}`
}

/**
 * 되짚은 값에 「약」을 붙일지. **곱해서 합계로 안 돌아오면 붙인다.**
 *
 * 월 999,360원을 730 으로 나누면 1,368.98… 이라 1,369원으로 적게 되는데, 고객이
 * 그 값에 1,460시간을 곱하면 합계보다 20원 많다. 그 20원을 설명할 길이 「약」뿐이다.
 */
export function approxText(
  minor: string | null, times: number | null, totalMinor: string, money: MoneyText,
): string | null {
  if (minor == null || times == null) return null
  const exact = BigInt(minor) * BigInt(times) === BigInt(totalMinor)
  return `${exact ? '' : `${APPROX_PREFIX} `}${money(minor)}`
}

/** 금액 칸에 덧붙는 축 한 줄 */
export interface AxisText {
  key: string
  label: string
  /** 「999,360원 × 2개월」 — 곱셈식이라 통째로 붙어 다닌다 */
  body: string
}

/**
 * 고른 금액 축을 글로. **고른 것이 없거나 시간 축이 없는 줄이면 빈 목록**이다.
 *
 * 기간 총액은 금액 칸의 큰 숫자 그 자체라 곱셈식이 없다 — 대신 이름을 달아
 * 「고른 것이 그려졌다」가 눈에 보이게 한다.
 */
export function axisTexts(
  line: DocumentLine, wanted: readonly string[], money: MoneyText,
): AxisText[] {
  const r = line.rate
  /*
    **시간 축이 없는 줄에는 아무 축도 안 붙는다.**

    「기간 총액」은 근거를 세지 않아도 적을 수 있는 값이지만, **기간이 없는 줄에 붙으면
    이름이 거짓말이 된다** — 「식 1개 500,000원」 아래 「기간 총액 500,000원」이 서면
    그 줄에 없는 기간을 있는 것처럼 말하고, 같은 숫자를 두 번 적는 군더더기까지 된다
    (실측 2026-10-05, 「식」과 「Hours」가 섞인 견적).

    날짜를 안 적은 시간 품목은 **수량이 축을 세우므로**(quote-document 의 hoursAxis)
    여기서 걸리지 않는다 — 어제 고친 것이 이 규칙에 안 걸린다.
  */
  if (!r || wanted.length === 0) return []
  const out: AxisText[] = []
  for (const k of RATE_AXIS_ORDER) {
    if (!wanted.includes(k)) continue
    if (k === 'total') {
      out.push({ key: k, label: RATE_AXIS_LABEL.total, body: money(line.amountMinor) })
    }
    if (k === 'monthly' && r.monthlyMinor && r.months) {
      const m = approxText(r.monthlyMinor, r.months, line.amountMinor, money)
      if (m) out.push({ key: k, label: RATE_AXIS_LABEL.monthly, body: `${m} × ${r.months}${LINE_KIND_UNIT.PERIOD}` })
    }
    if (k === 'hourly' && r.hourlyMinor && r.totalHours) {
      const h = `${r.hourlyExact ? '' : `${APPROX_PREFIX} `}${money(r.hourlyMinor)}`
      out.push({ key: k, label: RATE_AXIS_LABEL.hourly, body: `${h} × ${hoursText(r.totalHours)}` })
    }
  }
  return out
}

/**
 * 품목 이름 아래 한 줄. 고른 근거만 가운뎃점으로 이어 붙인다.
 * 빈 문자열이면 그 줄을 안 그린다.
 */
export function lineNoteText(
  line: DocumentLine, wanted: readonly string[], money: MoneyText,
): string {
  const r = line.rate
  const parts: string[] = []
  for (const k of LINE_NOTE_ORDER) {
    if (!wanted.includes(k)) continue
    if (k === 'period' && r?.start && r.end) parts.push(`${LINE_NOTE_LABEL.period} ${r.start} ~ ${r.end}`)
    if (k === 'totalHours' && r?.totalHours) parts.push(`${LINE_NOTE_LABEL.totalHours} ${hoursText(r.totalHours)}`)
    if (k === 'hoursBasis' && r) parts.push(`${LINE_NOTE_LABEL.hoursBasis} ${hoursText(r.hoursPerMonth)}`)
    if (k === 'wasAndDiscount' && line.isSpecialDiscount && line.baseAmountMinor !== line.amountMinor) {
      parts.push(`${QUOTE.lineWasAmount} ${money(line.baseAmountMinor)} · ${line.discountPercent}%`)
    }
  }
  return parts.join(' · ')
}

/** 합계 영역에 서는 환산 한 줄 */
export interface ConvText {
  key: string
  label: string
  /** 근거 조각들 — 하나는 통째로 붙어 다니고 조각 사이에서만 접힌다 */
  basis: string[]
  amount: string
}

/**
 * 합계 환산 줄을 글로. **문서가 conv 를 안 주면 빈 목록**이고 그때는 줄이 안 생긴다.
 *
 * 나누어진 금액은 품목 금액의 합(할인 반영·세금 제외)이다 — 「약」 판정도 그 합으로 한다.
 */
export function convTexts(
  conv: DocumentTotalConv | null, wanted: readonly string[], lineSumMinor: string, money: MoneyText,
): ConvText[] {
  if (!conv) return []
  const out: ConvText[] = []
  for (const k of TOTAL_CONV_ORDER) {
    if (!wanted.includes(k)) continue
    if (k === 'monthly' && conv.monthlyMinor && conv.months) {
      const a = approxText(conv.monthlyMinor, conv.months, lineSumMinor, money)
      if (a) out.push({
        key: k, label: TOTAL_CONV_LABEL.monthly, amount: a,
        basis: [`${conv.months}${LINE_KIND_UNIT.PERIOD}`],
      })
    }
    if (k === 'hourly' && conv.hourlyMinor && conv.totalHours) {
      out.push({
        key: k, label: TOTAL_CONV_LABEL.hourly,
        amount: `${conv.hourlyExact ? '' : `${APPROX_PREFIX} `}${money(conv.hourlyMinor)}`,
        basis: [
          `${LINE_NOTE_LABEL.hoursBasis} ${hoursText(conv.hoursPerMonth)}`,
          `${QUOTE.totalHours} ${hoursText(conv.totalHours)}`,
        ],
      })
    }
  }
  return out
}

/** 품목 금액의 합(할인 반영·세금 제외) — 환산이 나누는 그 금액이다 */
export function lineSumMinor(totals: { subtotalMinor: string; discountMinor: string }): string {
  return (BigInt(totals.subtotalMinor) - BigInt(totals.discountMinor)).toString()
}
