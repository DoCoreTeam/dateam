/**
 * 가격 기준 검증 — 일곱 겹 가운데 규칙으로 도는 넷(2~6)
 *
 *   1 파일 형식과 크기     `checkQuoteFile` (견적 파일 읽기와 같은 검사, 서비스가 부른다)
 *   2 원문 대조            읽은 숫자가 원문에 실제로 있는가                → 그 줄 「확인 전」
 *   3 단위                 「단위: 만원」을 읽었으면 1만을 곱했는가          → 제품 전체 「확인 전」
 *   4 규칙 모양            비율 0~100, 상한 양수, 가리키는 품목이 있는가, 돌지 않는가 → 그 규칙을 끈 채로 저장
 *   5 계산 예시 재현       미리 계산이 예시 금액을 내는가                     → 제품 전체 「확인 전」
 *   6 차이 보기            바뀐 정상가, 새 품목, 없어진 품목                  → 없어진 품목은 판매 중지
 *   7 나란히 보기          원본과 읽은 결과를 한 화면에 (화면이 맡는다)
 *
 * AI 가 읽은 결과를 AI 가 다시 검사하지 않는다. 여기는 늘 같은 답을 낸다.
 */

import { buildSolutionQuote } from './solution-engine.ts'
import { RULE_KINDS, VAR_KEYS, type PriceProduct, type PriceRule } from './types.ts'

export interface RuleProblem {
  index: number
  message: string
}

/** 4 규칙 모양. 걸린 규칙의 번호와 사유를 돌려준다 — 저장은 그 규칙을 끈 채로 한다 */
export function checkRules(p: PriceProduct): RuleProblem[] {
  const ids = new Set(p.items.map((i) => i.id))
  const out: RuleProblem[] = []
  const missing = (index: number, id: string) => out.push({ index, message: `규칙이 가리키는 품목이 없어요: ${id}` })

  p.rules.forEach((r: PriceRule, index) => {
    if (!RULE_KINDS.includes(r.kind)) { out.push({ index, message: '모르는 규칙 종류예요' }); return }
    switch (r.kind) {
      case 'ONE_OF':
        if (r.items.length < 2) out.push({ index, message: '하나만 고름 규칙에는 품목이 둘 이상 있어야 해요' })
        r.items.forEach((i) => { if (!ids.has(i)) missing(index, i) })
        break
      case 'WITH':
        if (!ids.has(r.item)) missing(index, r.item)
        r.with.forEach((i) => { if (!ids.has(i)) missing(index, i) })
        break
      case 'INCLUDES':
        if (!ids.has(r.item)) missing(index, r.item)
        ;(r.items ?? []).forEach((i) => { if (!ids.has(i)) missing(index, i) })
        if (r.varKey && !VAR_KEYS.includes(r.varKey)) out.push({ index, message: '모르는 조건이에요' })
        if (r.varKey && !(Number(r.qty) > 0)) out.push({ index, message: '기본 포함 수는 양수여야 해요' })
        break
      case 'QTY_FROM':
        if (!ids.has(r.item)) missing(index, r.item)
        if (!VAR_KEYS.includes(r.varKey)) out.push({ index, message: '모르는 조건이에요' })
        break
      case 'CAP':
        if (!ids.has(r.item)) missing(index, r.item)
        if (!(Number(r.max) > 0)) out.push({ index, message: '상한은 양수여야 해요' })
        break
      case 'ELIGIBLE':
        if (!ids.has(r.item)) missing(index, r.item)
        if (r.classes.length === 0) out.push({ index, message: '고를 수 있는 구분이 하나도 없어요' })
        break
      case 'DISCOUNT':
        if (!(r.pct >= 0 && r.pct <= 100)) out.push({ index, message: '할인율은 0에서 100 사이여야 해요' })
        break
      case 'SCALE_CAP':
        if (!p.items.some((i) => i.section === r.section)) out.push({ index, message: `규모 조정이 가리키는 묶음이 없어요: ${r.section}` })
        if (!VAR_KEYS.includes(r.varKey)) out.push({ index, message: '모르는 조건이에요' })
        if (!(Number(r.perUnitMinor) > 0)) out.push({ index, message: '규모 조정 단위 금액은 양수여야 해요' })
        break
    }
  })

  // 같은 품목에 서로 어긋나는 규칙: 하나만 고르는 무리 안의 두 품목을 같이 들어가게 하면 막는다
  p.rules.forEach((r, index) => {
    if (r.kind !== 'WITH') return
    for (const g of p.rules) {
      if (g.kind !== 'ONE_OF') continue
      if (g.items.includes(r.item) && r.with.some((w) => g.items.includes(w))) {
        out.push({ index, message: '하나만 고르는 품목끼리 같이 들어가게 할 수 없어요' })
      }
    }
  })
  return out
}

/** 품목 쪽 모양 — 비율 0~100, 비율의 대상 묶음이 있는가, 비율이 비율을 가리켜 돌지 않는가 */
export function checkItems(p: PriceProduct): { itemId: string; message: string }[] {
  const out: { itemId: string; message: string }[] = []
  const sections = new Set(p.items.map((i) => i.section))
  const ratioSections = new Set(p.items.filter((i) => i.basis === 'RATIO').map((i) => i.section))
  for (const it of p.items) {
    if (it.basis === 'RATIO') {
      if (!(Number(it.ratioPct) >= 0 && Number(it.ratioPct) <= 100)) out.push({ itemId: it.id, message: '비율은 0에서 100 사이여야 해요' })
      if (!it.ratioOfSection || !sections.has(it.ratioOfSection)) out.push({ itemId: it.id, message: '비율이 가리키는 묶음이 없어요' })
      else if (ratioSections.has(it.ratioOfSection)) out.push({ itemId: it.id, message: '비율이 다른 비율 묶음을 가리켜요' })
    } else if (it.basis !== 'SURVEY' && it.listPriceMinor !== null && it.listPriceMinor < BigInt(0)) {
      out.push({ itemId: it.id, message: '정상가는 0 이상이어야 해요' })
    }
  }
  return out
}

/** 5 계산 예시 재현. 예시마다 맞았는지와 어긋난 값 */
export interface ExampleCheck {
  label: string
  ok: boolean
  onceMinor: bigint
  annualMinor: bigint
  tcoMinor: bigint
  mismatches: string[]
}

export function checkExamples(p: PriceProduct): ExampleCheck[] {
  return (p.examples ?? []).map((ex) => {
    const r = buildSolutionQuote(p, ex.conditions)
    const mismatches: string[] = []
    const fmt = (v: bigint) => `${Number(v).toLocaleString('ko-KR')}원`
    if (r.onceSupplyMinor !== ex.expectOnceMinor) mismatches.push(`초기 도입 금액 ${fmt(r.onceSupplyMinor)}, 예시는 ${fmt(ex.expectOnceMinor)}`)
    if (r.annualSupplyMinor !== ex.expectAnnualMinor) mismatches.push(`연 유지보수 ${fmt(r.annualSupplyMinor)}, 예시는 ${fmt(ex.expectAnnualMinor)}`)
    if (ex.expectTcoMinor != null && r.tcoMinor !== ex.expectTcoMinor) mismatches.push(`총비용 ${fmt(r.tcoMinor)}, 예시는 ${fmt(ex.expectTcoMinor)}`)
    return { label: ex.label, ok: mismatches.length === 0, onceMinor: r.onceSupplyMinor, annualMinor: r.annualSupplyMinor, tcoMinor: r.tcoMinor, mismatches }
  })
}

// ── 2 원문 대조, 3 단위 ────────────────────────────────────────────────────

/** 원문 단위 — 「단위: 만원」, 「(단위: 천원)」 */
export function sourceUnitOf(raw: string): number | null {
  const m = /단위\s*[:：]?\s*(천원|만원|백만원|억원|원)/.exec(raw)
  if (!m) return null
  return { 원: 1, 천원: 1_000, 만원: 10_000, 백만원: 1_000_000, 억원: 100_000_000 }[m[1] as '원'] ?? null
}

/** 원문에 나온 숫자들 — 쉼표를 걷어 정수로 */
export function numbersIn(raw: string): Set<string> {
  const out = new Set<string>()
  for (const m of raw.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    out.add(m[0].replace(/,/g, '').replace(/\.0+$/, ''))
  }
  return out
}

/**
 * 읽은 금액(원)이 원문에 있는가. 원문 단위가 있으면 그 단위로 나눈 수를 찾는다.
 * 단위를 못 찾았으면 원 그대로와 만원 단위 둘 다 본다.
 */
export function amountInSource(amountMinor: bigint, raw: string, unit: number | null = sourceUnitOf(raw)): boolean {
  const nums = numbersIn(raw)
  const asIs = amountMinor.toString()
  if (unit && unit > 1) {
    const u = BigInt(unit)
    if (amountMinor % u !== BigInt(0)) return false
    return nums.has((amountMinor / u).toString())
  }
  if (nums.has(asIs)) return true
  const man = BigInt(10_000)
  return amountMinor % man === BigInt(0) && nums.has((amountMinor / man).toString())
}

/**
 * 3 단위. 단위를 찾았는데 읽은 금액이 그 배수가 아니면 곱하지 않은 것이다.
 * 단위를 못 찾았으면 다른 줄과 자릿수를 비교해 혼자 100배 이상 튄 줄을 짚는다.
 */
export function unitProblems(amounts: readonly { id: string; minor: bigint | null }[], raw: string): string[] {
  const unit = sourceUnitOf(raw)
  const vals = amounts.filter((a): a is { id: string; minor: bigint } => a.minor !== null && a.minor > BigInt(0))
  if (unit && unit > 1) {
    return vals.filter((a) => a.minor % BigInt(unit) !== BigInt(0)).map((a) => a.id)
  }
  if (vals.length < 3) return []
  const digits = vals.map((a) => a.minor.toString().length).sort((x, y) => x - y)
  const median = digits[Math.floor(digits.length / 2)]
  return vals.filter((a) => Math.abs(a.minor.toString().length - median) >= 3).map((a) => a.id)
}

// ── 6 차이 보기 ────────────────────────────────────────────────────────────

export interface ProductDiff {
  changed: { name: string; fromMinor: bigint | null; toMinor: bigint | null }[]
  added: string[]
  /** 없어진 품목 — 지우지 않고 판매 중지로 둔다 */
  removed: string[]
}

export function diffItems(
  before: readonly { name: string; listPriceMinor: bigint | null }[],
  after: readonly { name: string; listPriceMinor: bigint | null }[],
): ProductDiff {
  const key = (n: string) => n.replace(/\s+/g, '').toLowerCase()
  const old = new Map(before.map((b) => [key(b.name), b]))
  const now = new Map(after.map((a) => [key(a.name), a]))
  const changed: ProductDiff['changed'] = []
  const added: string[] = []
  for (const [k, a] of now) {
    const b = old.get(k)
    if (!b) added.push(a.name)
    else if (b.listPriceMinor !== a.listPriceMinor) changed.push({ name: a.name, fromMinor: b.listPriceMinor, toMinor: a.listPriceMinor })
  }
  const removed = [...old.entries()].filter(([k]) => !now.has(k)).map(([, b]) => b.name)
  return { changed, added, removed }
}
