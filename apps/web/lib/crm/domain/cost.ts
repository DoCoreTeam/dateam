/**
 * 원가 계산 (SSOT) — 기획 「원가에서 견적까지」 §03·§05
 *
 * **입력 방식이 셋인데 결과는 하나다.** 금액을 직접 넣든, 공수×단가로 넣든,
 * 매출의 %로 넣든 **`amountMinor` 로 수렴**한다. 그래야 합계가 한 번에 나오고
 * 「어떤 방식으로 넣었느냐」가 계산을 갈라놓지 않는다.
 *
 * **사람은 숫자를 안 친다**(기획 결정 7). 사람이 넣는 것은 «공수·단가·비율»이고
 * 금액은 여기서 만든다. 화면이 곱셈을 하면 화면마다 반올림이 달라진다.
 *
 * `quote-math.ts` 와 같은 규약: BigInt 정수 · 순수 함수 · 화면도 서버도 이것만 부른다.
 */

import { divRound, toMinor, toNum, pctOfMinor } from './money.ts'
import { rollupToBase, type RateSnapshot } from './currency.ts'
import { costGroupOf, type CostCategory, type CostGroup, type CostInputMode, type CostStage } from '../../terms/cost.ts'

/** 소수 두 자리까지 받는 공수를 정수 배수로 — 부동소수를 금액 계산에 들이지 않는다 */
const MM_SCALE = 100

export interface CostInput {
  category: CostCategory
  stage: CostStage
  inputMode: CostInputMode
  /** AMOUNT 로 넣었을 때 */
  amountMinor?: bigint | string | number | null
  /** EFFORT 로 넣었을 때 */
  effortMm?: number | string | null
  gradeCostPerMmMinor?: bigint | string | number | null
  /** RATIO 로 넣었을 때 */
  ratioPct?: number | string | null
  ratioBase?: 'REVENUE' | 'COST' | null
}

/**
 * 한 항목의 금액.
 *
 * **비율 항목은 여기서 계산하지 않는다.** 무엇의 %인지는 «다른 항목들의 합»이라
 * 항목 하나만 보고는 알 수 없다 — `computeCostTotals` 가 두 번 돌며 채운다.
 */
export function computeCostAmount(
  input: CostInput,
  base?: { revenueMinor: bigint; costMinor: bigint },
): bigint {
  if (input.inputMode === 'EFFORT') {
    // 공수 × 등급 단가. 공수는 소수 둘까지라 정수로 올려 곱하고 마지막에 내린다
    const mm = BigInt(Math.round(toNum(input.effortMm) * MM_SCALE)) // minor-ok — 금액이 아니라 «공수»를 소수 둘까지 정수로 올린 값(0.25 M/M → 25)
    const unit = toMinor(input.gradeCostPerMmMinor)
    return divRound(mm * unit, BigInt(MM_SCALE))
  }

  if (input.inputMode === 'RATIO') {
    if (!base) return BigInt(0)
    const on = input.ratioBase === 'COST' ? base.costMinor : base.revenueMinor
    return pctOfMinor(on, input.ratioPct)
  }

  return toMinor(input.amountMinor)
}

export interface CostRow extends CostInput {
  id?: string
  name?: string
  /**
   * 이 금액이 **어느 돈인가.** 안 적으면 기준 통화로 본다(옛 행이 그렇다).
   *
   * 이 칸이 없던 동안 USD 금액이 원화와 그대로 더해졌다 — 합계는 숫자가 나왔고
   * 아무도 못 알아봤다. **단위가 다른 것을 더하면 틀린 줄도 모른다.**
   */
  currency?: string | null
  /** 그 행에 **박아 둔** 환율(1 통화당 기준통화). 행마다 고시일이 다르므로 행마다 들고 있다 */
  fxRate?: number | string | null
  /** 그 환율의 고시일 — 화면이 「9-14 고시」라고 밝히는 근거 */
  fxDate?: string | null
}

export interface CostTotals {
  /** 갈래별 합계 */
  byCategory: Record<string, bigint>
  /** 대분류별 합계 */
  byGroup: Record<CostGroup, bigint>
  /** 시점별 합계 — 추정·확정·실적을 나란히 본다 */
  byStage: Record<CostStage, bigint>
  /** 이 시점의 원가 합계 — **기준 통화**다 */
  totalMinor: bigint
  /** 합계를 센 통화 — 화면이 「무슨 돈의 합계인가」를 말할 수 있어야 한다 */
  currency: string
  /** 항목별로 계산된 금액(비율 항목 포함) — **그 항목의 통화 그대로**다 */
  amounts: bigint[]
  /**
   * 항목별 **기준 통화 환산액**. 환율이 없어 못 센 항목은 null 이다.
   *
   * 0 을 넣지 않는다 — 0 은 「0원짜리 항목」이라는 뜻이고, 못 센 것과 다르다.
   */
  baseAmounts: (bigint | null)[]
  /**
   * 환율이 없어 **합계에서 빠진** 항목들.
   *
   * 버리지 않고 돌려준다 — 화면이 「일부는 환율이 없어 빠졌다」고 말해야 한다.
   * 말하지 않으면 합계는 조용히 작아지고, 작아진 원가는 마진을 크게 만든다.
   */
  skipped: { id?: string; amountMinor: bigint; currency: string }[]
}

/**
 * 한 행을 **기준 통화로** — 환율은 그 행에 박아 둔 것만 쓴다.
 *
 * **행마다 따로 환산한다.** 같은 USD 행 둘이 9월 고시(1,346)와 10월 고시(1,400)를
 * 박고 있을 수 있고, 환율표 하나로 묶으면 `findRate` 가 먼저 찾은 값을 둘 다에 쓴다 —
 * **조용히 틀리고**, 틀린 쪽이 그럴듯한 금액이 된다.
 *
 * 환율이 없으면 `null` 이다. 0 이나 원금액을 돌려주지 않는다 —
 * 1,454,112원짜리 원가가 1,080원으로 앉으면 그 딜은 「남는 장사」로 보인다.
 */
function toBaseMinor(amountMinor: bigint, row: CostRow, base: string): bigint | null {
  const from = (row.currency ?? base).toUpperCase()
  const to = base.toUpperCase()
  const rate = toNum(row.fxRate)
  const snapshots: RateSnapshot[] = from === to || rate <= 0
    ? []
    : [{ base: from, quote: to, rate, date: row.fxDate ?? '' }]

  const out = rollupToBase([{ amountMinor, currency: from }], to, snapshots)
  return out.skipped.length > 0 ? null : out.totalMinor
}

/**
 * 원가 합계.
 *
 * **비율 항목을 두 번에 걸쳐 푼다.** 「매출의 5%」·「원가의 10%」는 다른 항목이 다 정해져야
 * 계산되는데, 비율끼리 서로를 참조하면 답이 없다. 그래서:
 *   ① 비율이 아닌 항목을 먼저 더해 «기준 원가»를 만든다
 *   ② 그 위에서 비율 항목을 계산한다
 * 비율이 비율을 참조하는 구조는 만들지 않는다 — 순환이 생기고 아무도 못 푼다.
 *
 * **합계는 기준 통화로 센다.** 매출(`revenueMinor`)이 그 통화이므로 마진이 그 위에서만
 * 뜻을 갖는다. 항목 금액은 그 항목의 통화 그대로 두고(`amounts`), 환산액을 따로 돌려준다
 * (`baseAmounts`) — 화면이 「$1,080.00 (1,454,112원)」처럼 둘 다 적을 수 있어야 한다.
 */
export function computeCostTotals(
  rows: readonly CostRow[],
  revenueMinor: bigint,
  baseCurrency = 'KRW',
): CostTotals {
  const base = baseCurrency.toUpperCase()
  const byCategory: Record<string, bigint> = {}
  const byGroup: Record<CostGroup, bigint> = { DIRECT: BigInt(0), SUBCONTRACT: BigInt(0), INDIRECT: BigInt(0), RISK: BigInt(0) }
  const byStage: Record<CostStage, bigint> = { ESTIMATE: BigInt(0), COMMITTED: BigInt(0), ACTUAL: BigInt(0) }

  // ① 비율이 아닌 것부터 — **환산한 값으로** 센다. 단위가 다른 것을 더하면 틀린 줄도 모른다
  const amounts: bigint[] = rows.map((r) => (r.inputMode === 'RATIO' ? BigInt(0) : computeCostAmount(r)))
  const baseAmounts: (bigint | null)[] = rows.map((r, i) => (
    r.inputMode === 'RATIO' ? BigInt(0) : toBaseMinor(amounts[i], r, base)
  ))
  const baseCost = rows.reduce<bigint>(
    (a, r, i) => (r.inputMode === 'RATIO' ? a : a + (baseAmounts[i] ?? BigInt(0))),
    BigInt(0),
  )

  /*
    ② 그 위에서 비율.

    **비율 항목은 기준 통화로 나온다.** 「매출의 7%」의 매출이 기준 통화이기 때문이다 —
    그래서 환산할 것이 없고, 통화 칸이 무엇이든 그 값이 곧 환산액이다.
  */
  rows.forEach((r, i) => {
    if (r.inputMode === 'RATIO') {
      amounts[i] = computeCostAmount(r, { revenueMinor, costMinor: baseCost })
      baseAmounts[i] = amounts[i]
    }
  })

  let total = BigInt(0)
  const skipped: CostTotals['skipped'] = []
  rows.forEach((r, i) => {
    const v = baseAmounts[i]
    if (v === null) {
      // 못 센 것은 **버리지 않고 말한다** — 조용히 빠지면 원가가 작아지고 마진이 커진다
      skipped.push({ id: r.id, amountMinor: amounts[i], currency: (r.currency ?? base).toUpperCase() })
      return
    }
    byCategory[r.category] = (byCategory[r.category] ?? BigInt(0)) + v
    byGroup[costGroupOf(r.category)] += v
    byStage[r.stage] += v
    total += v
  })

  return { byCategory, byGroup, byStage, totalMinor: total, currency: base, amounts, baseAmounts, skipped }
}

export interface Margin {
  revenueMinor: bigint
  costMinor: bigint
  /** 매출 − 원가 */
  grossProfitMinor: bigint
  /**
   * 마진율(%). **표시 전용**이다 — 계산에는 안 쓴다(기획 §05).
   * 매출이 0이면 null. 0으로 나누느니 «모른다»고 말한다.
   */
  marginPct: number | null
}

export function computeMargin(revenueMinor: bigint, costMinor: bigint): Margin {
  const profit = revenueMinor - costMinor
  const marginPct = revenueMinor === BigInt(0)
    ? null
    : Number((profit * BigInt(10000)) / revenueMinor) / 100
  return { revenueMinor, costMinor, grossProfitMinor: profit, marginPct }
}

/**
 * 견적 라인 하나의 마진 — 그 라인에 붙은 원가만 본다.
 *
 * 라인에 안 붙은 원가(공통 인프라 등)는 여기 안 들어간다.
 * 딜 전체 마진에는 들어간다 — 「이 라인이 남는가」와 「이 사업이 남는가」는 다른 질문이다.
 */
export function computeLineMargin(
  lineTotalMinor: bigint,
  costs: readonly CostRow[],
  baseCurrency = 'KRW',
): Margin {
  const { totalMinor } = computeCostTotals(costs, lineTotalMinor, baseCurrency)
  return computeMargin(lineTotalMinor, totalMinor)
}
