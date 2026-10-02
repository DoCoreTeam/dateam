/**
 * 딜 원가를 **견적 줄로** 옮긴다 (순수)
 *
 * ## 왜 이 길이 필요한가
 *
 * 원가는 이미 딜에 쌓여 있다 — 받은 견적서를 원가로 보내는 길(`quote-cost-intake`)이
 * 있기 때문이다. 그런데 거기서 **되돌아오는 길이 없었다.** 그래서 같은 품목을
 * 사람이 견적 편집기에 손으로 다시 적었고, 적는 동안 수량과 단가가 어긋났다.
 *
 * ## 여기서 하지 않는 것
 *
 * **저장하지 않는다.** 결과는 견적 **초안**이고, 사람이 편집기에서 보고 저장한다 —
 * 원가에서 바로 견적을 만들어 버리면 「원가 그대로 나간 견적」이 조용히 생긴다.
 *
 * **환율을 받아 오지 않는다.** 환산은 그 원가 행에 **박아 둔** 환율만 쓴다.
 * 지금 환율로 환산하면 어제 본 원가와 오늘 만든 견적이 서로를 반박한다.
 *
 * ## 마진을 안 얹으면 원가 그대로 파는 견적이 된다
 *
 * `quote-margin` 은 「마진율의 기본값은 없다」고 적는다 — 기본 20% 가 **검토 없이**
 * 나가는 것을 막으려는 것이고, 그 길(파일로 채우기)은 결과를 바로 저장한다.
 * 이 길은 다르다: 결과가 편집기를 반드시 지나므로 사람이 그 숫자를 보고 저장한다.
 * 그래서 여기서는 **미리 채워 보여 주고**, 무엇을 얼마로 올렸는지 한 줄로 말한다.
 */

import { convertMinor, type RateSnapshot } from './currency.ts'
import { sellFromCost, parseMarginPercent } from './quote-margin.ts'
import { toMinor } from './money.ts'
import { LINE_KIND_ORDER, type QuoteLineKind } from '../../terms/cost.ts'

/** 옮길 원가 한 줄 — 창구(`GET /api/crm/deals/:id/costs`)가 주는 모양 그대로 */
export interface CostSource {
  id: string
  name: string
  descriptionMd?: string | null
  remark?: string | null
  kind?: string | null
  quantity?: string | null
  unit?: string | null
  unitPriceMinor?: string | null
  amountMinor: string
  currency?: string | null
  fxRate?: string | null
  fxDate?: string | null
}

/** 견적 줄 — `quote-draft-shape.ts` 의 `QuoteLineDraft` 와 **같은 이름**이다 */
export interface QuoteLineFromCost {
  name: string
  descriptionMd: string
  remark: string
  kind: QuoteLineKind
  quantity: string
  unit: string
  unitPriceMinor: string
  discountPercent: string
  taxRate: string
}

export interface CostToQuoteOptions {
  /** 견적을 적을 통화 */
  currency: string
  /** 마진율(%). 빈 문자열이면 원가 그대로 간다 */
  marginPercent: string
  /** 새 견적의 기본 세율(%) — 부르는 쪽이 준다, 여기서 또 정하지 않는다 */
  taxRate?: string
}

export interface CostToQuoteResult {
  lines: QuoteLineFromCost[]
  /**
   * 환산에 쓴 환율과 고시일 — 견적 초안에 싣는다.
   *
   * 견적은 환율 **한 벌**만 들 수 있어(crm_quote 의 fxRate·fxDate) 환산에 쓴 것 중
   * **가장 이른 고시일**을 싣는다. 가장 보수적인 근거이고, 「언제 기준인가」를
   * 물었을 때 그보다 최근 값을 댔다가 다른 줄을 설명하지 못하는 일이 없다.
   */
  fxRate: string | null
  fxDate: string | null
  /** 환율이 없어 못 옮긴 원가 — 조용히 빼지 않는다 */
  skipped: { id: string; name: string; currency: string }[]
  /** 무엇을 얼마로 올렸는지. 안 올렸으면 null */
  note: string | null
}

/** 새 견적 줄의 기본 세율 — 부르는 쪽이 안 주면 이 값 */
const DEFAULT_TAX_RATE = '10'

/**
 * 미리 채워 보여 줄 마진율(%).
 *
 * **딜이 스스로 말하는 값을 먼저 쓴다** — 수주 매출이 있으면 그 매출과 이 원가가 이미
 * 마진율을 정하고 있고, 그 값으로 견적을 만들면 견적 총액이 딜 금액과 어긋나지 않는다.
 * 딜이 말할 것이 없으면(매출 0·원가가 매출보다 큼) 아래 값으로 시작한다 —
 * 이것은 **채워 둔 값**이고 편집기에서 사람이 보고 고친다.
 */
export const FALLBACK_MARGIN_PCT = 20

export function prefillMarginPct(revenueMinor: string | null | undefined, costMinor: string | null | undefined): number {
  const revenue = Number(revenueMinor ?? 0)
  const cost = Number(costMinor ?? 0)
  if (!Number.isFinite(revenue) || !Number.isFinite(cost) || revenue <= 0 || cost <= 0) return FALLBACK_MARGIN_PCT
  const pct = ((revenue - cost) / revenue) * 100
  // 소수 한 자리까지. 0 이하거나 100 에 닿으면 딜이 말할 것이 없는 것과 같다
  const rounded = Math.floor(pct * 10) / 10
  return rounded > 0 && rounded < 100 ? rounded : FALLBACK_MARGIN_PCT
}

function kindOf(v: string | null | undefined): QuoteLineKind {
  return (LINE_KIND_ORDER as readonly string[]).includes(v ?? '') ? (v as QuoteLineKind) : 'QUANTITY'
}

/** 수량이 「셀 수 있는 값」인가 — 없거나 0 이면 금액 한 줄로 옮긴다 */
function countable(quantity: string | null | undefined, unitPriceMinor: string | null | undefined): boolean {
  const q = Number(quantity ?? 0)
  const p = Number(unitPriceMinor ?? 0)
  return Number.isFinite(q) && q > 0 && Number.isFinite(p) && p > 0
}

/** 그 행에 박아 둔 환율로만 환산한다 — 행마다 고시일이 다르다 */
function snapshotOf(row: CostSource, from: string, to: string): RateSnapshot[] {
  const rate = Number(row.fxRate ?? 0)
  if (from === to || !Number.isFinite(rate) || rate <= 0) return []
  return [{ base: from, quote: to, rate, date: row.fxDate ?? '' }]
}

/**
 * 원가 묶음 → 견적 줄 묶음.
 *
 * 수량·단위·종류는 **그대로 간다**. 그것이 이 길의 이유다 — 금액 한 칸만 옮기면
 * 「몇 대에 얼마였나」가 사라지고, 사람이 문서를 다시 열어 적게 된다.
 */
export function costToQuoteLines(
  rows: readonly CostSource[],
  options: CostToQuoteOptions,
): CostToQuoteResult {
  const to = options.currency.trim().toUpperCase()
  const percent = parseMarginPercent(options.marginPercent)
  const taxRate = options.taxRate ?? DEFAULT_TAX_RATE

  const lines: QuoteLineFromCost[] = []
  const skipped: CostToQuoteResult['skipped'] = []
  const dates: string[] = []
  const rates: number[] = []

  for (const row of rows) {
    const from = (row.currency ?? to).trim().toUpperCase()
    const snapshots = snapshotOf(row, from, to)

    const counted = countable(row.quantity, row.unitPriceMinor)
    const quantity = counted ? String(row.quantity) : '1'
    const costPerUnit = toMinor(counted ? row.unitPriceMinor : row.amountMinor)

    const converted = convertMinor({ amountMinor: costPerUnit, currency: from }, to, snapshots)
    if (converted === null) {
      // 환율을 모르는 것을 1:1 로 옮기면 달러 원가가 원화 단가로 앉는다
      skipped.push({ id: row.id, name: row.name, currency: from })
      continue
    }
    if (from !== to) {
      rates.push(snapshots[0].rate)
      if (snapshots[0].date) dates.push(snapshots[0].date)
    }

    lines.push({
      name: row.name,
      descriptionMd: row.descriptionMd ?? '',
      remark: row.remark ?? '',
      kind: kindOf(row.kind),
      quantity,
      unit: row.unit ?? '',
      unitPriceMinor: (percent === null ? converted : sellFromCost(converted, percent)).toString(),
      discountPercent: '0',
      taxRate,
    })
  }

  /*
    고시일이 여럿이면 **가장 이른 것**을 싣는다. 환율 자체도 그 날의 것을 싣는다 —
    날짜와 환율이 다른 줄에서 오면 문서가 자기 근거를 설명하지 못한다.
  */
  const earliest = dates.length > 0 ? [...dates].sort()[0] : null
  const rateOfEarliest = earliest === null
    ? (rates.length > 0 ? rates[0] : null)
    : rates[dates.indexOf(earliest)] ?? rates[0]

  return {
    lines,
    fxRate: rateOfEarliest === null || rateOfEarliest === undefined ? null : String(rateOfEarliest),
    fxDate: earliest,
    skipped,
    note: percent === null ? null : `원가에 마진 ${percent}%를 얹었어요. 단가는 확인하고 고치시면 됩니다.`,
  }
}
