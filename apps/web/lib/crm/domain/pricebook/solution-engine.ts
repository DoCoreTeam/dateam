/**
 * 제품과 조건으로 항목을 만든다 — 솔루션 갈래(품목 정상가)
 *
 * 규칙 일곱 종류(`types.ts`)를 읽어 줄을 내고, 금액은 `composeQuote` 가 센다.
 * 이 파일은 DB 도 AI 도 모른다. gcube edge 가격표의 계산 예시 두 벌이 시험으로 잠겨 있다.
 *
 * 말하지 않은 조건은 묻지 않고 채우고, 채운 칸마다 출처를 단다.
 *   에디션이 없으면 상한에 맞는 첫 에디션, 노드가 없으면 기본 포함 대수,
 *   유지보수가 없으면 첫 유지보수 품목, 할인이 없으면 기관 종류 규칙.
 */

import { composeQuote, totalCostOverYears, supplyOf, type ComposeLine, type ComposedQuote } from '../quote-compose.ts'
import { inferTier } from '../../../gpu/tier-dict.ts'
import type {
  DiscountStackMode, GpuClass, GpuPick, PriceItem, PriceProduct, PriceRule, Provenance,
  SolutionConditions, VarKey, Violation,
} from './types.ts'

export interface EngineLine extends ComposeLine {
  itemId: string
  name: string
  unit: string | null
  /** 그날 정상가 — 기준 대조와 승인이 정상가 대비로 잰다 */
  listPriceMinor: bigint | null
  remark: string | null
  /** 이 줄의 셈 — 「7,300,000 × 4장」 */
  formula: string
  /** 할인 규칙과 예산 맞추기가 걸리는 줄인가 — 구축비, 비율, 기본 포함 0원 줄은 아니다 */
  discountable: boolean
  /** 칸마다 어디서 왔나 */
  provenance: { unitPrice: Provenance; quantity: Provenance; discount: Provenance }
}

export interface AutoFilled {
  field: string
  value: string
  provenance: Provenance
}

export interface SolutionResult {
  lines: EngineLine[]
  composed: ComposedQuote
  /** 초기 도입 금액(1회 공급가액), 연 유지보수(매년 공급가액), 몇 년 총비용 */
  onceSupplyMinor: bigint
  annualSupplyMinor: bigint
  tcoMinor: bigint
  autoFilled: AutoFilled[]
  violations: Violation[]
  /** 엔진이 정한 뒤의 조건 — 화면이 「조건 고치기」에 다시 채운다 */
  resolved: SolutionConditions
}

/** NPU 는 가격표에서 워크스테이션용과 같은 줄이다. GPU 구분 함수는 NPU 를 데이터센터로 본다 */
const NPU_PATTERN = /\b(npu|warboy|rngd|atom|rebel|furiosa|gaudi)\b/i

export function gpuClassOf(pick: Pick<GpuPick, 'model' | 'classOverride'>): GpuClass {
  if (pick.classOverride) return pick.classOverride
  if (NPU_PATTERN.test(pick.model)) return 'NPU'
  const tier = inferTier(pick.model)
  return tier === 1 ? 'DC' : tier === 2 ? 'WS' : 'CONSUMER'
}

/** 조건에서 수를 뽑는다. 상시 GPU 만 구분별 라이선스를 받고, 지정 시간 GPU 는 지정 시간 라이선스만 받는다 */
export function varsOf(c: SolutionConditions): Record<VarKey, number> {
  let dc = 0, ws = 0, timed = 0, total = 0
  for (const g of c.gpus) {
    const n = Math.max(0, Math.trunc(Number(g.count) || 0))
    total += n
    if (g.timed) { timed += n; continue }
    if (gpuClassOf(g) === 'DC') dc += n
    else ws += n
  }
  return { 'gpu.dc': dc, 'gpu.ws': ws, 'gpu.timed': timed, 'gpu.total': total, nodes: c.nodes ?? 0, training: c.training ?? 0 }
}

const won = (v: bigint | number) => Number(v).toLocaleString('ko-KR')

function rulesOf<K extends PriceRule['kind']>(p: PriceProduct, kind: K): Extract<PriceRule, { kind: K }>[] {
  return p.rules.filter((r): r is Extract<PriceRule, { kind: K }> => r.kind === kind)
}

/** 하나만 고르는 무리 가운데 에디션 무리 — 상한 규칙이 걸린 품목이 든 무리 */
function editionGroup(p: PriceProduct): string[] | null {
  const capped = new Set(rulesOf(p, 'CAP').map((r) => r.item))
  return rulesOf(p, 'ONE_OF').find((r) => r.items.some((i) => capped.has(i)))?.items ?? rulesOf(p, 'ONE_OF')[0]?.items ?? null
}

function fitsCap(p: PriceProduct, itemId: string, vars: Record<VarKey, number>): boolean {
  return rulesOf(p, 'CAP').filter((r) => r.item === itemId).every((r) => vars[r.varKey] <= r.max)
}

/** 말하지 않은 조건을 채운다. 사람이 고른 것은 건드리지 않는다 */
function resolveConditions(
  p: PriceProduct,
  c: SolutionConditions,
  autoFilled: AutoFilled[],
): SolutionConditions {
  const picked = [...c.picked]
  const vars = varsOf(c)
  const byId = new Map(p.items.map((i) => [i.id, i]))

  const edition = editionGroup(p)
  if (edition && !picked.some((id) => edition.includes(id))) {
    const fit = edition.find((id) => fitsCap(p, id, vars)) ?? edition[0]
    if (fit) {
      picked.push(fit)
      const capNote = vars['gpu.total'] > 0 ? `GPU ${vars['gpu.total']}장에 맞는 첫 에디션` : '첫 에디션'
      autoFilled.push({ field: '에디션', value: byId.get(fit)?.name ?? fit, provenance: { source: 'DEFAULT', note: capNote } })
    }
  }

  // 유지보수: 비율 품목 무리에서 아무것도 안 골랐으면 첫 것
  const ratioGroup = rulesOf(p, 'ONE_OF').find((r) => r.items.every((i) => byId.get(i)?.basis === 'RATIO'))
  if (ratioGroup && !picked.some((id) => ratioGroup.items.includes(id))) {
    const first = ratioGroup.items[0]
    picked.push(first)
    const it = byId.get(first)
    autoFilled.push({
      field: '유지보수',
      value: it ? `${it.name} ${it.ratioPct ?? ''}%` : first,
      provenance: { source: 'DEFAULT', note: '기본값' },
    })
  }

  // 전환: 이미 산 품목(from)이 있는 고객이 바꿀 품목(to)을 고르면 전환 품목이 들어간다
  const owned = new Set(c.owned ?? [])
  const closure = withClosure(p, picked)
  for (const r of rulesOf(p, 'UPGRADE')) {
    if (!closure.has(r.to) || !owned.has(r.from) || picked.includes(r.item)) continue
    picked.push(r.item)
    autoFilled.push({ field: byId.get(r.item)?.name ?? r.item, value: '1식', provenance: { source: 'RULE', note: upgradeNote(p, r, c.ownedNote) } })
  }

  let nodes = c.nodes
  if (nodes === null) {
    const included = includedQty(p, picked, 'nodes')
    if (included > 0) {
      nodes = included
      autoFilled.push({ field: '노드 수', value: `${included}대`, provenance: { source: 'DEFAULT', note: '기본 구축 포함 대수로 채움' } })
    }
  }
  return { ...c, picked, nodes }
}

/** 고른 품목(같이 들어가는 것 포함)이 기본으로 포함하는 수 */
function includedQty(p: PriceProduct, selected: readonly string[], varKey: VarKey): number {
  const all = withClosure(p, selected)
  return rulesOf(p, 'INCLUDES')
    .filter((r) => r.varKey === varKey && all.has(r.item))
    .reduce((s, r) => s + (r.qty ?? 0), 0)
}

function withClosure(p: PriceProduct, selected: readonly string[]): Set<string> {
  const out = new Set(selected)
  let grew = true
  while (grew) {
    grew = false
    for (const r of rulesOf(p, 'WITH')) {
      if (!out.has(r.item)) continue
      for (const w of r.with) if (!out.has(w)) { out.add(w); grew = true }
    }
  }
  return out
}

interface DiscountPick { pct: number; provenance: Provenance; label: string | null }

function discountFor(p: PriceProduct, c: SolutionConditions, autoFilled: AutoFilled[]): DiscountPick {
  if (typeof c.discount === 'number') return { pct: c.discount, provenance: { source: 'SAID' }, label: null }
  if (c.discount === 'none' || !c.companyKind) return { pct: 0, provenance: { source: 'DEFAULT', note: '할인 없음' }, label: null }
  const rule = rulesOf(p, 'DISCOUNT').find((r) => r.companyKind === c.companyKind)
  if (!rule || rule.pct <= 0) return { pct: 0, provenance: { source: 'DEFAULT', note: '할인 없음' }, label: null }
  const note = rule.confirmed ? `기관 종류에 맞는 ${rule.label}` : `기관 종류에 맞는 ${rule.label} (할인율은 제안값)`
  autoFilled.push({ field: '할인', value: `${rule.label} ${rule.pct}%`, provenance: { source: 'COMPANY_KIND', note } })
  return { pct: rule.pct, provenance: { source: 'COMPANY_KIND', note }, label: rule.label }
}

function priceProvenance(it: PriceItem): Provenance {
  return it.needsReview ? { source: 'UNVERIFIED', note: '확인 전 가격' } : { source: 'PRICEBOOK' }
}

/** 수량을 정한다. null 이면 이 품목은 안 들어간다 */
function quantityOf(
  p: PriceProduct,
  it: PriceItem,
  selected: Set<string>,
  vars: Record<VarKey, number>,
): { qty: number; note: string | null } | null {
  const follow = rulesOf(p, 'QTY_FROM').find((r) => r.item === it.id)
  if (follow) {
    const minus = follow.minusIncluded ? includedQty(p, [...selected], follow.varKey) : 0
    const qty = vars[follow.varKey] - minus
    if (qty <= 0) return null
    const note = minus > 0 ? `${vars[follow.varKey]}에서 기본 포함 ${minus}를 뺌` : null
    return { qty, note }
  }
  if (!selected.has(it.id)) return null
  return { qty: 1, note: null }
}

/**
 * 제품과 조건으로 항목을 만든다.
 */
export function buildSolutionQuote(product: PriceProduct, input: SolutionConditions): SolutionResult {
  const autoFilled: AutoFilled[] = []
  const violations: Violation[] = []
  const c = resolveConditions(product, input, autoFilled)
  const vars = varsOf(c)
  const byId = new Map(product.items.map((i) => [i.id, i]))

  for (const id of c.picked) {
    if (!byId.has(id)) violations.push({ level: 'block', code: 'UNKNOWN_ITEM', itemId: id, message: `가격 기준에 없는 품목입니다: ${id}` })
  }

  const selected = withClosure(product, c.picked.filter((id) => byId.has(id)))

  for (const r of rulesOf(product, 'ONE_OF')) {
    const hit = r.items.filter((i) => selected.has(i))
    if (hit.length > 1) {
      violations.push({ level: 'block', code: 'ONE_OF', message: `${hit.map((i) => byId.get(i)?.name ?? i).join(', ')} 중 하나만 고를 수 있어요` })
    }
  }
  const edition = editionGroup(product)
  if (edition && !edition.some((i) => selected.has(i))) {
    violations.push({ level: 'block', code: 'NO_EDITION', message: '에디션을 골라야 해요' })
  }
  for (const r of rulesOf(product, 'CAP')) {
    if (selected.has(r.item) && vars[r.varKey] > r.max) {
      violations.push({
        level: 'block', code: 'CAP', itemId: r.item,
        message: `${byId.get(r.item)?.name ?? r.item}은 ${r.max.toLocaleString('ko-KR')}까지예요. 지금 ${vars[r.varKey].toLocaleString('ko-KR')}`,
      })
    }
  }
  for (const r of rulesOf(product, 'ELIGIBLE')) {
    if (r.item !== timedItemId(product)) continue
    const bad = c.gpus.filter((g) => g.timed && !r.classes.includes(gpuClassOf(g)))
    for (const g of bad) {
      violations.push({ level: 'block', code: 'ELIGIBLE', itemId: r.item, message: `${g.model}은 지정 시간 제공을 고를 수 없어요` })
    }
  }

  for (const r of rulesOf(product, 'UPGRADE')) {
    if (selected.has(r.item) && !(c.owned ?? []).includes(r.from)) {
      violations.push({
        level: 'warn', code: 'UPGRADE_NOT_OWNED', itemId: r.item,
        message: `${byId.get(r.item)?.name ?? r.item}은 ${byId.get(r.from)?.name ?? r.from}을 산 고객만 받아요. 지난 계약에서 찾지 못했어요`,
      })
    }
  }

  // 기본 포함: 고른 품목이 포함하는 품목은 0원으로 선다
  const includedBy = new Map<string, string>()
  for (const r of rulesOf(product, 'INCLUDES')) {
    if (!selected.has(r.item) || !r.items) continue
    for (const i of r.items) includedBy.set(i, r.item)
  }

  const discount = discountFor(product, c, autoFilled)
  const lines: EngineLine[] = []

  for (const it of product.items) {
    const q = includedBy.has(it.id) ? { qty: 1, note: null } : quantityOf(product, it, selected, vars)
    if (!q) continue
    const includer = includedBy.get(it.id)
    const free = includer !== undefined
    const isRatio = it.basis === 'RATIO'
    if (it.basis === 'SURVEY' || (!isRatio && !free && it.listPriceMinor === null)) {
      violations.push({ level: 'block', code: 'SURVEY', itemId: it.id, message: `${it.name}이 「실사 후 견적」입니다. 금액을 정하거나 항목을 빼야 보낼 수 있어요` })
    }
    if (it.needsReview) {
      violations.push({ level: 'warn', code: 'UNVERIFIED', itemId: it.id, message: `${it.name} 가격이 아직 확인 전이에요` })
    }
    const unitPrice = free ? BigInt(0) : (it.listPriceMinor ?? BigInt(0))
    const pct = it.discountable && !free && !isRatio ? discount.pct : 0
    const remark = free ? `${byId.get(includer)?.name ?? ''} 기본 포함`.trim() : (it.remark ?? null)
    const formula = isRatio
      ? `${it.ratioOfSection ?? ''} × ${it.ratioPct ?? 0}%`
      : free
        ? remark ?? ''
        : it.basis === 'PER_UNIT'
          ? `${won(unitPrice)} × ${q.qty}${it.unit ?? ''}`
          : `${won(unitPrice)}`
    lines.push({
      key: it.id,
      itemId: it.id,
      name: it.name,
      sectionKey: it.section,
      billing: it.billing,
      quantity: q.qty,
      unit: it.unit,
      unitPriceMinor: unitPrice,
      listPriceMinor: free ? null : it.listPriceMinor,
      discountPercent: pct,
      taxRate: it.taxRate,
      ratioPct: isRatio ? (it.ratioPct ?? 0) : null,
      ratioOfSectionKey: isRatio ? (it.ratioOfSection ?? null) : null,
      remark,
      formula,
      discountable: it.discountable && !free && !isRatio,
      provenance: {
        unitPrice: free ? { source: 'RULE', note: remark } : priceProvenance(it),
        quantity: q.note ? { source: 'RULE', note: q.note } : selected.has(it.id) && c.picked.includes(it.id) ? { source: 'SAID' } : { source: 'RULE' },
        discount: pct > 0 ? discount.provenance : { source: 'DEFAULT', note: '할인 없음' },
      },
    })
  }

  applyScaleCaps(product, lines, vars, autoFilled)
  // 전환으로 들어간 줄은 출처가 「품목 규칙」이다 — 사람이 고른 것처럼 「말한 값」으로 서면 안 된다
  for (const r of rulesOf(product, 'UPGRADE')) {
    const l = lines.find((x) => x.itemId === r.item)
    if (l && !input.picked.includes(r.item)) l.provenance = { ...l.provenance, quantity: { source: 'RULE', note: upgradeNote(product, r, c.ownedNote) } }
  }

  const composed = composeQuote(
    lines,
    product.sections.map((s) => ({ key: s.name, roundingUnit: s.roundingUnit })),
    { supplyUnit: product.supplyRoundingUnit ?? 0 },
  )
  const once = supplyOf(composed.once)
  const annual = composed.annual.supplyMinor
  return {
    lines,
    composed,
    onceSupplyMinor: once,
    annualSupplyMinor: annual,
    tcoMinor: totalCostOverYears(once, annual, product.tcoYears, product.freeYears),
    autoFilled,
    violations,
    resolved: c,
  }
}

function upgradeNote(p: PriceProduct, r: Extract<PriceRule, { kind: 'UPGRADE' }>, ownedNote: string | null | undefined): string {
  const from = p.items.find((i) => i.id === r.from)?.name ?? r.from
  return `지난 계약에서 ${from}을 샀음${ownedNote ? ` (${ownedNote})` : ''}`
}

/** 지정 시간 라이선스 품목 — gpu.timed 를 따라가는 품목 */
function timedItemId(p: PriceProduct): string | null {
  return rulesOf(p, 'QTY_FROM').find((r) => r.varKey === 'gpu.timed')?.item ?? null
}

const STACK_NOTE: Record<DiscountStackMode, string> = { MAX: '큰 것 하나로', MULTIPLY: '곱해서', ADD: '더해서' }

/**
 * 두 할인율을 겹친다 (순수 함수). 결과는 소수 둘째 자리, 100 을 넘지 않는다.
 * 10% 와 20% → MAX 20 · MULTIPLY 28 · ADD 30
 */
export function stackDiscounts(mode: DiscountStackMode, a: number, b: number): number {
  if (!(a > 0)) return b
  if (!(b > 0)) return a
  const raw = mode === 'ADD' ? a + b : mode === 'MULTIPLY' ? 100 - ((100 - a) * (100 - b)) / 100 : Math.max(a, b)
  return Math.min(100, Math.round(raw * 100) / 100)
}

/**
 * 규모 조정 — 그 묶음의 할인 대상 정가 소계가 「수 × 단위 금액」을 넘으면 넘는 만큼 할인한다.
 *
 * 할인율은 소수 둘째 자리로 **올려** 잡는다. 내려 잡으면 상한을 몇 원 넘고, 그 몇 원은 묶음 절사가 버린다.
 * 기관 종류 할인과 겹치면 제품의 겹침 방식(stackDiscounts)을 따른다. 기본은 큰 쪽 하나다(마이그 233 의 원칙).
 * 수가 0 이면 걸지 않는다. 0 × 단위 금액은 「전부 할인」이 아니라 「셀 것이 없다」다.
 */
function applyScaleCaps(p: PriceProduct, lines: EngineLine[], vars: Record<VarKey, number>, autoFilled: AutoFilled[]): void {
  const byId = new Map(p.items.map((i) => [i.id, i]))
  for (const r of rulesOf(p, 'SCALE_CAP')) {
    const count = vars[r.varKey]
    if (!(count > 0) || !(r.perUnitMinor > 0)) continue
    const target = lines.filter((l) => l.sectionKey === r.section && byId.get(l.itemId)?.discountable && !l.ratioPct && Number(l.unitPriceMinor) > 0)
    const list = target.reduce((sum, l) => sum + Number(l.unitPriceMinor) * Number(l.quantity), 0)
    const cap = count * r.perUnitMinor
    if (list <= cap) continue
    const pct = Math.ceil(((list - cap) / list) * 10_000) / 100
    const mode = p.discountStackMode ?? 'MAX'
    for (const l of target) {
      const before = Number(l.discountPercent ?? 0)
      const next = stackDiscounts(mode, before, pct)
      if (next <= before) continue
      l.discountPercent = next
      const note = next === pct ? `규모 조정 할인 ${pct}%` : `기관 할인 ${before}% 와 규모 조정 할인 ${pct}% 를 ${STACK_NOTE[mode]} ${next}%`
      l.provenance = { ...l.provenance, discount: { source: 'RULE', note } }
    }
    autoFilled.push({
      field: '규모 조정 할인',
      value: `${pct}%`,
      provenance: { source: 'RULE', note: `${r.section} 정가 소계 ${won(list)}원이 ${won(cap)}원(${count} × ${won(r.perUnitMinor)})을 넘음` },
    })
  }
}
