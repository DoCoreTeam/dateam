/**
 * 읽은 금액에 **판매가를 얹는다** — 마진율 또는 목표 총액
 *
 * ## 왜 필요한가
 *
 * 받은 견적서는 대개 **남이 우리에게 파는 값**이다. 그것으로 우리 견적을 만들려면
 * 어딘가에서 판매가가 되어야 하는데, 지금은 사람이 줄마다 손으로 곱해 넣는다.
 * 줄이 열이면 열 번 곱하고, 한 번 틀리면 그 줄만 마진이 다른 견적이 나간다.
 *
 * ## 기본값을 두지 않는다
 *
 * **마진율의 기본값은 없다.** 기본 20% 같은 숫자를 넣어 두면 그 숫자가 검토 없이 나간다 —
 * 비워 두면 읽은 금액이 그대로 간다. 넣은 사람만 계산을 받는다.
 *
 * ## 계산을 두 벌 두지 않는다
 *
 * 목표 총액 맞추기는 이미 `quote-target` 이 한다(말로 채우기가 쓰는 그 길).
 * 여기서 다시 구현하지 않고 **그 함수를 부르고 결과만 되돌려 놓는다** —
 * 두 벌이 되면 한쪽만 고쳐지고, 같은 견적서가 화면에 따라 다른 금액이 된다.
 *
 * ## 단가만 바꾼다
 *
 * 수량·할인·세율·단위는 사람이 정했거나 문서에서 읽은 값이다. 판매가를 얹는 일이
 * 그것들을 건드리면 「무엇이 왜 바뀌었는지」를 아무도 못 따라간다.
 */

import { computeTotals, type QuoteLineInput, type RoundingInput } from './quote-math.ts'
import { scaleLinesToTarget, describeScale, type QuoteTargetIntent } from './quote-target.ts'
import { toMinor, pctToBp, divFloor } from './money.ts'

/** 마진율의 상한 — 100% 는 «원가가 0» 이라는 뜻이라 계산 자체가 성립하지 않는다 */
const MAX_MARGIN = 100

/** 100% 를 basis point 로 — 비율 계산은 정수로만 한다(money.ts 의 규칙) */
const FULL_BP = BigInt(10_000)

/** 금액을 사람이 읽는 말로. 통화가 KRW 가 아닐 수 있어 **부르는 쪽이 준다** */
export type MoneyText = (minor: bigint) => string

export type PricePlan =
  /** 읽은 금액 그대로 — 기본값 */
  | { kind: 'keep' }
  /** 판매가 대비 남는 비율(%). 빈 문자열이면 «안 넣음» 이라 그대로 간다 */
  | { kind: 'margin'; percent: string }
  /** 총액을 목표에 맞춘다 — 계산은 quote-target 이 한다 */
  | { kind: 'target'; total: string; includesTax: boolean }

export interface PriceResult<T> {
  lines: T[]
  /** 무엇을 얼마로 바꿨는지 한 줄. 아무것도 안 바꿨으면 null — 조용히 바꾸지 않는다 */
  note: string | null
}

/**
 * 「20」·「20.5」·「」 를 숫자로.
 *
 * **빈 칸은 0 이 아니다.** 0 은 「0% 마진」이라고 적은 것이고, 빈 칸은 안 적은 것이다.
 * 범위를 벗어난 값도 null 로 본다 — 음수 마진은 손해를 보고 팔겠다는 뜻이라
 * 실수로 적힌 것이고, 100 이상은 나눗셈이 성립하지 않는다.
 */
export function parseMarginPercent(raw: string | null | undefined): number | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0 || n >= MAX_MARGIN) return null
  return n
}

/**
 * 원가 한 줄에서 **판매가**를 낸다.
 *
 * 마진율은 이 저장소 어디서나 **판매가 대비 남는 비율**이다
 * (`computeMargin` = 매출총이익 ÷ 매출). 그래서 원가에 곱하는 것이 아니라 나눈다 —
 * 원가 100 에 마진 20% 는 120 이 아니라 **125** 다. 곱하면 실제 마진은 16.7% 가 되고,
 * 원가 화면이 말하는 숫자와 견적 화면이 말하는 숫자가 달라진다.
 *
 * **올림한다.** 1원을 내리면 목표 마진보다 낮은 값이 되고, 그 1원은 협상이 아니라 계산 실수다.
 */
export function sellFromCost(costMinor: bigint, percent: number): bigint {
  if (percent <= 0) return costMinor
  /*
    비율은 **정수 basis point** 로만 다룬다 — `pctToBp` 가 그 변환의 한 자리다(money.ts).
    0.1 같은 소수를 곱하면 부동소수가 금액에 들어오고, 그 오차는 합계에서야 보인다.
  */
  const keepBp = FULL_BP - pctToBp(percent)
  if (keepBp <= BigInt(0)) return costMinor
  const num = costMinor * FULL_BP
  const q = divFloor(num, keepBp)
  return q * keepBp === num ? q : q + BigInt(1)
}

/** 공급가(부가세 전) — 마진 문장이 견주는 값 */
function netOf(lines: readonly QuoteLineInput[], rounding: RoundingInput): bigint {
  const t = computeTotals(lines, rounding)
  return t.totalMinor - t.taxMinor
}

/** 무엇을 얼마로 올렸는지 — **말하지 않으면 조용히 바꾼 것이다** */
export function describeMargin(percent: number, before: bigint, after: bigint, money: MoneyText): string {
  return `공급가 ${money(before)}에 마진 ${percent}%를 얹어 ${money(after)}으로 올렸어요.`
    + ' 단가는 확인하고 고치시면 됩니다.'
}

/**
 * 고른 방식대로 단가를 바꾼다. **바꾸지 못하면 원문 그대로 돌려준다** —
 * 못 맞춘 채로 0원이나 절반 값을 내놓지 않는다.
 *
 * `rounding` 을 안 주면 우리 새 견적의 기본값(절사 없음)이다.
 */
export function applyPrice<T extends QuoteLineInput>(
  lines: readonly T[],
  plan: PricePlan,
  money: MoneyText,
  rounding: RoundingInput = {},
): PriceResult<T> {
  const keep = (): PriceResult<T> => ({ lines: [...lines], note: null })
  if (lines.length === 0) return keep()

  if (plan.kind === 'margin') {
    const percent = parseMarginPercent(plan.percent)
    if (percent === null) return keep()
    const before = netOf(lines, rounding)
    const next = lines.map((l) => ({
      ...l,
      unitPriceMinor: sellFromCost(toMinor(l.unitPriceMinor), percent).toString(),
    }))
    return { lines: next, note: describeMargin(percent, before, netOf(next, rounding), money) }
  }

  if (plan.kind === 'target') {
    const total = (plan.total ?? '').trim()
    const intent: QuoteTargetIntent = {
      totalMinor: total && Number.isFinite(Number(total)) ? Number(total) : null,
      includesTax: plan.includesTax,
    }
    if (intent.totalMinor === null) return keep()
    /*
      **여기서 다시 계산하지 않는다.** 비율 유지·잔차 흡수·절사 처리는 전부 저쪽 일이고,
      우리는 저쪽이 낸 단가를 원래 줄에 되돌려 놓기만 한다(저쪽 반환 타입은 줄의 이름·규격을
      모른다 — 그대로 쓰면 견적에서 품목 이름이 사라진다).
    */
    const scaled = scaleLinesToTarget(lines, intent, rounding)
    if (scaled.reason !== null || scaled.lines.length !== lines.length) return keep()
    const next = lines.map((l, i) => ({
      ...l,
      unitPriceMinor: String(scaled.lines[i].unitPriceMinor),
    }))
    return { lines: next, note: describeScale(intent, scaled, Number(rounding.unit ?? 0)) }
  }

  return keep()
}
