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
  DURATION_UNIT_LABEL,
} from '../../terms/quote.ts'
import { LINE_KIND_UNIT } from '../../terms/cost.ts'
import { hoursFromQuantity } from './quote-rate.ts'
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

/**
 * 「× 2개월」 — 수량 칸 아래에 서는 두 번째 축.
 *
 * **곱셈 기호를 함께 들고 다닌다.** 수량과 기간은 곱해지는 관계인데 「2개월」만 적으면
 * 읽는 사람이 그것을 수량의 설명으로 읽는다(「17대, 2개월짜리」). 「× 2개월」이라야
 * 금액이 어떻게 나왔는지가 그 자리에서 따라진다.
 *
 * 안 적은 줄이면 빈 문자열이고 그 자리는 아예 안 그려진다.
 */
export function durationText(duration: { value: string; unit: string } | null | undefined): string {
  if (!duration) return ''
  const label = DURATION_UNIT_LABEL[duration.unit as keyof typeof DURATION_UNIT_LABEL]
  if (!label) return ''
  return `${QUOTE.durationTimesSign} ${Number(duration.value).toLocaleString('ko-KR')}${label}`
}

/**
 * 시간당 금액이 **몇 대 기준인지**.
 *
 * 17대를 2개월 쓰는 줄의 시간당은 금액 ÷ 1,460h 라 **17대 묶음의 시간당**이다.
 * 한 대당으로 읽으면 열일곱 배 틀린 숫자를 고객에게 적어 보내게 된다 —
 * 그래서 수량이 하나보다 많으면 그 수를 이름에 적는다.
 *
 * **수량 칸이 곧 시간인 줄에는 안 붙는다.** 「1,440 Hours」짜리 줄의 시간당은
 * 금액 ÷ 1,440h 이고 그 1,440 이 바로 수량이다 — 수량이 금액에 한 번 더 곱해지지
 * 않으므로 기준을 말할 것이 없다. 붙이면 「1,440Hours 기준」이라는 뜻 없는 말이 된다.
 *
 * 수량이 1 이면 빈 문자열이다. 「1대 기준」은 없는 구별을 있는 것처럼 보이게 한다.
 */
export function hourlyBasisText(quantity: string | number, unit: string | null | undefined): string {
  const q = Number(quantity)
  if (!Number.isFinite(q) || q <= 1) return ''
  if (hoursFromQuantity(unit, quantity) != null) return ''
  const u = (unit ?? '').trim()
  return ` (${q.toLocaleString('ko-KR')}${u} ${QUOTE.hourlyBasisSuffix})`
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
      /*
        **몇 대 기준인지를 이름에 적는다.** 17대 2개월 줄의 시간당은 금액 ÷ 1,460h 라
        17대 묶음의 값이다. 이름이 그 말을 안 하면 고객이 한 대당으로 읽고,
        그 차이는 열일곱 배다.
      */
      out.push({
        key: k,
        label: `${RATE_AXIS_LABEL.hourly}${hourlyBasisText(line.quantity, line.unit)}`,
        body: `${h} × ${hoursText(r.totalHours)}`,
      })
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
