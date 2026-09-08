/**
 * 목표 총액에 맞추기 — 「부가세 포함 3억 수준으로 만들어 줘」
 *
 * ## 왜 생겼나 (사용자 지적 2026-09-08)
 *
 * 「말로 채우기」에 *"부가세포함으로 해서 총액 3억 수준에 맞춰서 만들어줘"* 라고 적었더니
 * 화면이 「부가세포함」·「수준에 맞춰서」를 **못 알아봤다고** 내놓았다.
 * *"우리 AI 탑재 시스템이고 정량적인 항목을 채우는건데 이해를 못한다?"*
 *
 * AI 는 정상 호출되고 있었다. 이해할 **재료를 준 적이 없었다**:
 *   · 프롬프트에 부가세 개념이 없다 — 화면엔 「부가세 %」 칸이 있는데 AI 는 그 말을 모른다
 *   · 총액 목표 개념이 없다 — 「3억에 맞춰」를 받을 자리가 없다
 *   · **현재 견적에 무엇이 있는지 안 준다** — 「맞춰서」는 맞출 대상이 있어야 성립한다
 *
 * ## 왜 계산을 AI 에게 안 맡기나
 *
 * 견적은 고객에게 나가는 문서다. AI 가 단가를 하나 잘못 풀면 그 숫자가 그대로 제안가가 되고
 * 되돌릴 방법은 「죄송합니다」뿐이다(`quote-draft.v1` 주석의 원칙).
 * 그래서 역할을 나눈다 — **AI 는 «얼마에 맞춰 달라»는 의도만 읽고, 숫자는 여기서 낸다.**
 * 그래야 「3억이 왜 이 단가가 됐는지」를 사람이 따라갈 수 있고, 가드로 잠글 수 있다.
 */

import { computeTotals, type QuoteLineInput, type RoundingInput } from './quote-math.ts'
import { toMinor } from './money.ts'
import { roundingUnitName } from '../../terms/quote.ts'

/** AI 가 읽어 낸 «맞춰 달라»는 의도. 숫자는 이 파일이 낸다 */
export interface QuoteTargetIntent {
  /** 목표 금액(원 단위 정수). 없으면 목표가 없는 것이다 */
  totalMinor: number | null
  /**
   * 그 금액이 **부가세를 포함한 값**인가.
   *
   * 「부가세 포함 3억」과 「공급가 3억」은 3천만 원 차이다 —
   * 이 한 칸을 안 물으면 그 차이가 조용히 제안가가 된다.
   */
  includesTax: boolean
}

export interface ScaleResult {
  /** 조정된 줄들 — 단가만 바뀐다(수량·할인·세율은 사람이 정한 그대로) */
  lines: QuoteLineInput[]
  /** 실제로 맞춰진 총액 */
  achievedMinor: bigint
  /** 목표와의 차이. 절사·반올림 때문에 0 이 아닐 수 있다 */
  gapMinor: bigint
  /** 못 맞춘 이유. 맞췄으면 null */
  reason: 'EMPTY' | 'ZERO_BASE' | 'NO_TARGET' | null
}

/** 목표를 못 맞췄을 때 원래 줄을 그대로 돌려준다 — 조용히 0원짜리를 만들지 않는다 */
function keep(lines: readonly QuoteLineInput[], reason: ScaleResult['reason']): ScaleResult {
  return { lines: [...lines], achievedMinor: BigInt(0), gapMinor: BigInt(0), reason }
}

/**
 * 지금 줄들의 **비율을 유지한 채** 총액을 목표에 맞춘다.
 *
 * 비율을 유지하는 이유: 사람이 이미 「크레딧 2.8억 · EDGE 1억」처럼 구성을 정해 뒀다.
 * 목표에 맞추려고 어느 한 줄만 깎으면 그건 다른 견적이다 — 전체를 같은 비율로 민다.
 *
 * 마지막 줄로 잔차를 흡수한다. 줄마다 반올림하면 합계가 목표에서 몇 원씩 어긋나는데,
 * 견적서에서 총액이 1원 틀리는 것은 «계산을 못 하는 회사»로 읽힌다.
 */
export function scaleLinesToTarget(
  lines: readonly QuoteLineInput[],
  intent: QuoteTargetIntent,
  rounding: RoundingInput,
): ScaleResult {
  if (intent.totalMinor === null || intent.totalMinor <= 0) return keep(lines, 'NO_TARGET')
  if (lines.length === 0) return keep(lines, 'EMPTY')

  const base = computeTotals(lines, rounding)
  // 목표가 «부가세 포함»이면 세금까지 포함한 총액을, 아니면 공급가(소계−할인)를 맞춘다
  const current = intent.includesTax ? base.totalMinor : base.totalMinor - base.taxMinor
  if (current <= BigInt(0)) return keep(lines, 'ZERO_BASE')

  // 금액 변환은 money.ts 의 toMinor 하나만 쓴다(SSOT · money-ssot.test.ts 가 잠근다)
  const target = toMinor(intent.totalMinor)

  /*
    단가를 비율만큼 민다. **정수 나눗셈의 오차가 쌓이지 않도록** 각 줄을 따로 곱셈으로 낸다
    (한 번 구한 배율을 소수로 들고 다니면 줄마다 다르게 반올림된다).
  */
  let scaled: QuoteLineInput[] = lines.map((l) => {
    const unit = toMinor(l.unitPriceMinor)
    const next = (unit * target) / current
    return { ...l, unitPriceMinor: next.toString() }
  })

  /*
    잔차를 마지막 줄에 얹는다 — 수량이 있는 줄이라야 단가로 흡수된다.
    수량이 0 이면 단가를 아무리 바꿔도 총액이 안 움직이므로 그런 줄은 건너뛴다.
  */
  const measure = (ls: QuoteLineInput[]) => {
    const t = computeTotals(ls, rounding)
    return intent.includesTax ? t.totalMinor : t.totalMinor - t.taxMinor
  }
  const dist = (v: bigint) => (v < BigInt(0) ? -v : v)

  /*
    **잔차를 좁힌다 — 재면서.**

    단가 1원이 총액 1원이 아니다. 세금 10%·할인 30% 가 걸려 있으면 그 사이에 배율이 끼고,
    반올림까지 겹쳐 «얼마를 올리면 얼마가 되는지»를 식으로 못 낸다. 그래서 추정하지 않고
    **한 번 얹고 다시 재는 것**을 반복한다.

    좁혀지지 않으면 즉시 되돌리고 멈춘다 — 진동하며 계속 미느니 «1원 차이»를 정직하게
    남기는 편이 낫다(그 차이는 `describeScale` 이 사람에게 말한다).
    정수 단가로는 도달할 수 없는 총액이 실제로 있다 — 그때 억지로 맞추면 다른 줄이 틀어진다.
  */
  const ABSORB_ROUNDS = 8
  let gap = target - measure(scaled)
  for (let round = 0; round < ABSORB_ROUNDS && gap !== BigInt(0); round++) {
    let moved = false
    for (let i = scaled.length - 1; i >= 0; i--) {
      const qty = Number(scaled[i].quantity ?? 0)
      if (!Number.isFinite(qty) || qty <= 0) continue
      const unit = toMinor(scaled[i].unitPriceMinor)
      const per = BigInt(Math.max(1, Math.round(qty))) // minor-ok — 수량이지 금액이 아니다
      // 몫이 0 이면 «1원씩» 민다 — 안 그러면 남은 차이를 영원히 못 줄인다
      const step = gap / per
      const bump = step === BigInt(0) ? (gap > BigInt(0) ? BigInt(1) : BigInt(-1)) : step
      const next = unit + bump
      if (next < BigInt(0)) continue

      const trial = [...scaled]
      trial[i] = { ...trial[i], unitPriceMinor: next.toString() }
      const nextGap = target - measure(trial)
      if (dist(nextGap) >= dist(gap)) continue   // 좋아지지 않으면 되돌린다(롤백 = 적용 안 함)
      scaled = trial
      gap = nextGap
      moved = true
      break
    }
    if (!moved) break
  }

  const final = computeTotals(scaled, rounding)
  const finalAchieved = intent.includesTax ? final.totalMinor : final.totalMinor - final.taxMinor
  return {
    lines: scaled,
    achievedMinor: finalAchieved,
    gapMinor: target - finalAchieved,
    reason: null,
  }
}

/**
 * 사람에게 보여 줄 한 줄 — 「무엇을 얼마로 맞췄는지」를 말한다. 조용히 바꾸지 않는다.
 *
 * **차이가 남으면 이유까지 말한다.** 절사가 걸려 있으면 총액은 그 단위의 계단으로만
 * 움직이므로 목표에 딱 떨어지지 않는 것이 정상인데, 이유를 안 밝히면 사용자는
 * 「3억이라고 했는데 왜 안 맞지」를 고장으로 읽는다(실측 v0.7.695: 십만원 절사에서 3만원 차이).
 */
export function describeScale(
  intent: QuoteTargetIntent,
  r: ScaleResult,
  roundingUnit = 0,
): string | null {
  if (r.reason !== null) return null
  const won = (v: bigint) => Number(v).toLocaleString('ko-KR')
  const base = intent.includesTax ? '부가세 포함' : '공급가 기준'
  if (r.gapMinor === BigInt(0)) {
    return `${base} 총액을 ${won(r.achievedMinor)}원으로 맞췄어요. 단가는 확인하고 고치시면 됩니다.`
  }
  const diff = won(r.gapMinor < BigInt(0) ? -r.gapMinor : r.gapMinor)
  // 단위 이름은 용어집이 갖는다 — 여기 또 적으면 화면과 다른 말이 생긴다(§0-2)
  const unitName = roundingUnitName(roundingUnit)
  const why = unitName ? ` ${unitName} 단위 절사가 걸려 있어 딱 떨어지지는 않아요.` : ''
  return `${base} 총액을 ${won(r.achievedMinor)}원으로 맞췄어요 (목표와 ${diff}원 차이).${why}`
    + ' 단가는 확인하고 고치시면 됩니다.'
}
