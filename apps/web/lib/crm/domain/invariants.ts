/**
 * 불변식 I1~I9 — 어긋난 값이 DB 에 들어가는 것을 막는다
 *
 * **왜 «경고»가 아니라 «거부»인가**: 금액은 조용히 틀리면 아무도 모른다.
 * 경고로 두면 그 경고는 반드시 무시되고, 무시된 경고는 없는 것과 같다.
 *
 * **원인을 짚는다**: «다르다»만 말하면 소용없다. 어느 항목이 얼마 어긋났는지를
 * 함께 돌려줘야 사람이 고칠 수 있다.
 */

import { computeTax, pctToBp, type TaxBasis, type TaxKind } from './money.ts'

export interface Violation {
  /** I1 ~ I9 */
  code: string
  /** 사람이 읽는 말 — 화면에 그대로 뜬다 */
  message: string
  expectedMinor?: bigint
  actualMinor?: bigint
  /** 어디가 문제인지 (라인 id · 섹션 id …) */
  at?: string
}

export interface LineLike {
  id?: string
  sectionId?: string | null
  lineTotalMinor: bigint
  taxKind?: TaxKind
  taxRatePct?: number | string
}

export interface SectionLike {
  id: string
  subtotalMinor: bigint
}

export interface QuoteLike {
  netMinor: bigint
  discountMinor?: bigint
  proposedNetMinor: bigint
  taxMinor: bigint
  grossMinor: bigint
}

/** I1 — 라인 합 = 섹션 소계 */
export function checkI1(sections: readonly SectionLike[], lines: readonly LineLike[]): Violation[] {
  const out: Violation[] = []
  for (const s of sections) {
    const sum = lines.filter((l) => l.sectionId === s.id).reduce((a, l) => a + l.lineTotalMinor, BigInt(0))
    if (sum !== s.subtotalMinor) {
      out.push({
        code: 'I1',
        message: `섹션 소계가 라인 합과 다릅니다 — ${diff(s.subtotalMinor, sum)}`,
        expectedMinor: sum, actualMinor: s.subtotalMinor, at: s.id,
      })
    }
  }
  return out
}

/** I2 — 섹션 소계 합 = 견적 소계 */
export function checkI2(sections: readonly SectionLike[], quoteNetMinor: bigint): Violation[] {
  const sum = sections.reduce((a, s) => a + s.subtotalMinor, BigInt(0))
  if (sum === quoteNetMinor) return []
  return [{
    code: 'I2',
    message: `견적 소계가 섹션 합과 다릅니다 — ${diff(quoteNetMinor, sum)}`,
    expectedMinor: sum, actualMinor: quoteNetMinor,
  }]
}

/** I3 — 소계 − 할인 = 제안가 */
export function checkI3(q: QuoteLike): Violation[] {
  const expected = q.netMinor - (q.discountMinor ?? BigInt(0))
  if (expected === q.proposedNetMinor) return []
  return [{
    code: 'I3',
    message: `제안가가 «소계 − 할인»과 다릅니다 — ${diff(q.proposedNetMinor, expected)}`,
    expectedMinor: expected, actualMinor: q.proposedNetMinor,
  }]
}

/** I4 — 세율별 과세표준 × 세율의 합 = 세액 */
export function checkI4(lines: readonly LineLike[], taxMinor: bigint): Violation[] {
  const byRate = new Map<string, bigint>()
  for (const l of lines) {
    const kind = l.taxKind ?? 'TAXABLE'
    const key = `${kind}:${pctToBp(l.taxRatePct ?? 10)}`
    byRate.set(key, (byRate.get(key) ?? BigInt(0)) + l.lineTotalMinor)
  }
  let sum = BigInt(0)
  for (const [key, base] of Array.from(byRate.entries())) {
    const [kind, bpStr] = key.split(':')
    sum += computeTax({
      amountMinor: base, taxBasis: 'NET',
      taxKind: kind as TaxKind, taxRatePct: Number(bpStr) / 100,
    }).taxMinor
  }
  if (sum === taxMinor) return []
  return [{
    code: 'I4',
    message: `세액이 세율별 계산과 다릅니다 — ${diff(taxMinor, sum)}`,
    expectedMinor: sum, actualMinor: taxMinor,
  }]
}

/** I5 — 제안가 + 세액 = 총액 */
export function checkI5(q: QuoteLike): Violation[] {
  const expected = q.proposedNetMinor + q.taxMinor
  if (expected === q.grossMinor) return []
  return [{
    code: 'I5',
    message: `총액이 «제안가 + 세액»과 다릅니다 — ${diff(q.grossMinor, expected)}`,
    expectedMinor: expected, actualMinor: q.grossMinor,
  }]
}

/** I6 — 구성비 합 = 100.000000%. 잔여 항목이 흡수하므로 구조적으로 성립해야 한다 */
export function checkI6(pcts: readonly number[]): Violation[] {
  // 소수 6자리까지 정수로 비교한다 — 부동소수 비교를 하지 않는다
  const sum = pcts.reduce((a, p) => a + Math.round(p * 1_000_000), 0)
  if (sum === 100_000_000) return []
  return [{
    code: 'I6',
    message: `구성비 합이 100%가 아닙니다 — 현재 ${(sum / 1_000_000).toFixed(6)}%. 잔여 항목(isBalancing)이 하나인지 확인하세요`,
  }]
}

/** I7 — 구성 금액 합 = 기준 금액 */
export function checkI7(amounts: readonly bigint[], baseMinor: bigint): Violation[] {
  const sum = amounts.reduce((a, b) => a + b, BigInt(0))
  if (sum === baseMinor) return []
  return [{
    code: 'I7',
    message: `구성 금액 합이 기준과 다릅니다 — ${diff(sum, baseMinor)}. 최대잔여법 배분을 거쳤는지 확인하세요`,
    expectedMinor: baseMinor, actualMinor: sum,
  }]
}

/** I8 — 딜의 견적 금액 = 대표 견적의 제안가 */
export function checkI8(dealQuotedMinor: bigint | null, primaryProposedMinor: bigint | null): Violation[] {
  if (primaryProposedMinor === null) return []
  if (dealQuotedMinor === primaryProposedMinor) return []
  return [{
    code: 'I8',
    message: `딜의 견적 금액이 대표 견적과 다릅니다 — ${diff(dealQuotedMinor ?? BigInt(0), primaryProposedMinor)}`,
    expectedMinor: primaryProposedMinor, actualMinor: dealQuotedMinor ?? BigInt(0),
  }]
}

/**
 * I9 — 현물 ≤ 수주 매출
 *
 * 현물이 사업비보다 클 수는 없다. 지금 이걸 막는 것이 아무 데도 없어
 * «현물 제외»가 음수로 그려질 수 있었다.
 */
export function checkI9(inKindMinor: bigint, bookedMinor: bigint): Violation[] {
  if (inKindMinor <= bookedMinor) return []
  return [{
    code: 'I9',
    message: `현물 합계가 수주 매출을 넘습니다 — ${fmt(inKindMinor - bookedMinor)}원 초과`,
    expectedMinor: bookedMinor, actualMinor: inKindMinor,
  }]
}

export interface QuoteCheckInput {
  sections: readonly SectionLike[]
  lines: readonly LineLike[]
  quote: QuoteLike
}

/** 견적 저장 전 — I1~I5 를 한 번에 */
export function checkQuote(input: QuoteCheckInput): Violation[] {
  return [
    ...checkI1(input.sections, input.lines),
    ...checkI2(input.sections, input.quote.netMinor),
    ...checkI3(input.quote),
    ...checkI4(input.lines, input.quote.taxMinor),
    ...checkI5(input.quote),
  ]
}

export interface DealCheckInput {
  bookedMinor: bigint
  inKindMinor: bigint
  quotedMinor?: bigint | null
  primaryProposedMinor?: bigint | null
}

/** 딜 저장 전 — I8·I9 */
export function checkDeal(input: DealCheckInput): Violation[] {
  return [
    ...checkI8(input.quotedMinor ?? null, input.primaryProposedMinor ?? null),
    ...checkI9(input.inKindMinor, input.bookedMinor),
  ]
}

/** 위반이 있으면 던진다. 저장 경로가 이걸 부른다 */
export function assertNoViolation(vs: readonly Violation[]): void {
  if (vs.length === 0) return
  const err = new Error(vs.map((v) => `[${v.code}] ${v.message}`).join('\n'))
  ;(err as Error & { violations?: readonly Violation[] }).violations = vs
  throw err
}

function fmt(v: bigint): string {
  const s = v < BigInt(0) ? `-${(-v).toString()}` : v.toString()
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function diff(actual: bigint, expected: bigint): string {
  const d = actual - expected
  return `저장하려는 값 ${fmt(actual)} · 계산값 ${fmt(expected)} · 차이 ${d > BigInt(0) ? '+' : ''}${fmt(d)}`
}

export type { TaxBasis }
