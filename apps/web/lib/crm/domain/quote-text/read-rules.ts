/**
 * 규칙 해석기 — 견적 글 한 줄을 조건으로 읽는다
 *
 * AI 를 부르기 전에 늘 먼저 돈다. 같은 글이면 늘 같은 답을 내고 돈이 들지 않는다.
 * 금액, 수량과 단위, 공수와 등급, 기간, GPU 모델과 장수, 품목 이름과 별칭,
 * 부가세 포함, 예산, 할인율, 기관 종류를 읽는다. 금액을 계산하지는 않는다 — 계산은 엔진이 한다.
 *
 * 못 읽은 줄(`unread`)만 AI 에게 간다. 이 파일은 DB 도 AI 도 모른다.
 */

import { canonicalizeModel } from '../../../gpu/canonical-model.ts'
import type { CompanyKind } from '../company-kind.ts'
import { LABOR_GRADE_NAMES, type LaborGradeName } from '../pricebook/basis-lines.ts'

/** 글 전체 상한 — 견적 글이 이보다 길 일은 없다. 정규식이 큰 글에 오래 붙잡히지 않게 */
export const MAX_TEXT_LENGTH = 8_000
/** 한 견적에서 읽을 줄 상한 */
export const MAX_CLAUSES = 120

/** 규칙이 읽을 수 있는 품목 — 이름과 별칭만. 가격은 싣지 않는다 */
export interface CatalogEntry {
  id: string
  name: string
  aliases: readonly string[]
}

export interface CatalogProduct {
  id: string
  name: string
  items: readonly CatalogEntry[]
}

export interface Catalog {
  products: readonly CatalogProduct[]
  /** 제품에 안 묶인 품목 — 크레딧, 하드웨어 등 */
  items: readonly CatalogEntry[]
}

export type CountUnit = '장' | '대' | '개' | '식' | '회' | '명'

export interface GpuMention {
  /** 정규화한 이름 — 「H100」, 「RTX 6000 Ada」 */
  model: string
  count: number | null
}

export interface Clause {
  /** 글에서 몇째 줄인가(0부터). 쉼표로 나눈 조각도 같은 줄 번호를 가진다 */
  line: number
  /** 그 줄 안의 몇째 조각인가 */
  part: number
  text: string
}

export interface Reading extends Clause {
  amountMinor: bigint | null
  counts: { value: number; unit: CountUnit }[]
  manMonths: number | null
  grade: LaborGradeName | null
  months: number | null
  hours: number | null
  gpus: GpuMention[]
  nodes: number | null
  training: number | null
  /** 맞춘 제품 id */
  productId: string | null
  /** 맞춘 품목 id — 제품 품목이든 따로 있는 품목이든 */
  itemIds: string[]
  edition: 'STD' | 'ENT' | null
  maintenance: 'STD' | 'EXT' | null
  discountPct: number | null
  vat: 'INCLUDED' | 'EXCLUDED' | null
  budgetMinor: bigint | null
  companyKind: CompanyKind | null
  /** 「설치」「세팅」 — 기본 구축에 들어 있다 */
  install: boolean
  /** 읽은 것을 뺀 나머지 글 — 줄 이름이 된다 */
  rest: string
  /** 아무것도 못 읽었다 → AI 에게 보낸다 */
  unread: boolean
}

const EOK = BigInt(100_000_000)
const MAN = BigInt(10_000)

/** 쉼표 숫자를 없앤 소수 문자열 → 만 단위 곱 (소수 넷째 자리까지) */
function scaled(raw: string, unit: bigint): bigint {
  const t = raw.replace(/,/g, '')
  const [i, f = ''] = t.split('.')
  const frac = (f + '0000').slice(0, 4)
  return (BigInt(i || '0') * BigInt(10_000) + BigInt(frac)) * unit / BigInt(10_000)
}

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`
const SUB_UNIT: Record<string, bigint> = { 천만: BigInt(10_000_000), 백만: BigInt(1_000_000), 만: MAN, 천: BigInt(1_000) }

/**
 * 금액 표현 — 「2.8억」 「2억 8천」 「2억8천만」 「5천만」 「300만원」 「280,000,000원」 「1,300원」.
 * 억 뒤의 단위 없는 숫자와 「천」은 만 단위다(「2억 8천」 = 2억 8천만).
 */
const AMOUNT_RE = new RegExp(
  String.raw`(${NUM})\s*억(?:\s*(${NUM})\s*(천만|백만|만|천)?)?\s*원?` +
  String.raw`|(${NUM})\s*(천만|백만|만)\s*원?` +
  String.raw`|(\d{1,3}(?:,\d{3})+)\s*원?` +
  String.raw`|(\d+)\s*원`,
)

export function parseAmount(text: string): { minor: bigint; match: string } | null {
  const m = AMOUNT_RE.exec(text)
  if (!m) return null
  let minor: bigint
  if (m[1] !== undefined) {
    minor = scaled(m[1], EOK)
    if (m[2] !== undefined) {
      // 억 뒤는 만 단위다: 「8천」 → 8천만, 「5000」 → 5000만
      const sub = m[3] === undefined ? MAN : m[3] === '천' ? SUB_UNIT['천만'] : SUB_UNIT[m[3]]
      minor += scaled(m[2], sub)
    }
  } else if (m[4] !== undefined) {
    minor = scaled(m[4], SUB_UNIT[m[5]])
  } else {
    minor = BigInt((m[6] ?? m[7]).replace(/,/g, ''))
  }
  return minor > BigInt(0) ? { minor, match: m[0] } : null
}

/** 글을 줄과 조각으로 나눈다. 숫자 안의 쉼표(280,000,000)는 나누지 않는다 */
export function splitClauses(text: string): Clause[] {
  const out: Clause[] = []
  const lines = text.slice(0, MAX_TEXT_LENGTH).split(/\r?\n/)
  lines.forEach((raw, line) => {
    const parts = raw.split(/(?<!\d),|,(?!\d{3})|[.。](?!\d)|;|·/)
    let part = 0
    for (const p of parts) {
      const t = p.replace(/^[\s\-*•>]+/, '').trim()
      if (t === '' || out.length >= MAX_CLAUSES) continue
      out.push({ line, part, text: t })
      part += 1
    }
  })
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/()·.,]/g, '')

/** GPU 모델 — 「H100」 「H100 SXM5」 「A6000」 「RTX 5090」 「6000 Ada」 「L40S」 「B200」 */
const GPU_RE = /((?:rtx\s*(?:pro\s*)?)?(?:[ahblvt]\d{2,4}[a-z]?(?:\s*(?:sxm\d?|pcie|nvl))?|\d{4}\s*(?:ada|ti)|rtx\s*\d{4}(?:\s*ti)?))(?:\s*(?:gpu|그래픽\s*카드))?(?:\s*(?:x|×|\*)?\s*(\d+)\s*(?:장|개|ea|대|카드))?/gi

function readGpus(text: string): { gpus: GpuMention[]; spans: string[] } {
  const gpus: GpuMention[] = []
  const spans: string[] = []
  for (let m = GPU_RE.exec(text); m !== null; m = GPU_RE.exec(text)) {
    const raw = m[1].trim()
    // 「2025년」 같은 해, 「1300」 같은 단가는 모델이 아니다 — 숫자로만 된 것은 ada/ti 가 붙어야 모델이다
    if (/^\d+$/.test(raw)) continue
    const name = /^\d{4}\s*ada$/i.test(raw) ? `RTX ${raw.replace(/\s*ada/i, ' Ada')}` : raw
    gpus.push({ model: canonicalizeModel(name).canonical, count: m[2] ? Number(m[2]) : null })
    spans.push(m[0])
  }
  GPU_RE.lastIndex = 0
  return { gpus, spans }
}

const GRADE_RE = new RegExp(`(${LABOR_GRADE_NAMES.join('|')})`)
const MM_RE = /(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*m|mm|엠엠|맨먼스)(?![a-z])/i
const MONTH_RE = /(\d+(?:\.\d+)?)\s*(?:개월|달)/
const YEAR_RE = /(\d+)\s*년(?!도|차)/
const HOUR_RE = /(\d[\d,]*)\s*(?:시간|hours?|hrs?)\b|(\d[\d,]*)\s*시간/i
const NODE_RE = /노드\D{0,6}?(\d+)\s*대|(\d+)\s*대\s*(?:의\s*)?노드/
const TRAINING_RE = /교육\D{0,4}?(\d+)\s*회|(\d+)\s*회\s*교육/
const COUNT_RE = /(\d+)\s*(장|대|개|식|회|명|ea)(?![a-z가-힣])/gi
const DISCOUNT_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:할인|dc)|할인\D{0,4}?(\d+(?:\.\d+)?)\s*%/i
const BUDGET_RE = /예산\s*(?:은|이|은요)?\s*/
const VAT_IN_RE = /부가세\s*(?:포함|넣어|포함해)|vat\s*포함/i
const VAT_EX_RE = /부가세\s*(?:별도|빼고|제외)|vat\s*별도/i
const INSTALL_RE = /설치|세팅|셋업|구축\s*(?:은|도)?\s*(?:우리가|저희가)/
const SCHOOL_RE = /대학|여대|대학교|교수|학교|연구실|캠퍼스|교육청/
const PUBLIC_RE = /공공|공단|공사(?!비)|진흥원|재단/
const GOV_RE = /정부|부처|시청|구청|도청|군청|청(?=\s|$)/
const EDITION_WORDS: Record<'STD' | 'ENT', RegExp> = {
  STD: /\bstd\b|표준형|스탠다드|standard/i,
  ENT: /\bent\b|엔터프라이즈|enterprise/i,
}
const MAINT_WORDS: Record<'STD' | 'EXT', RegExp> = {
  STD: /유지보수\s*(?:는|은)?\s*(?:표준|기본)|표준\s*유지보수/,
  EXT: /유지보수\s*(?:는|은)?\s*(?:확장|프리미엄)|확장\s*유지보수/,
}
/**
 * 품목 이름 맞추기에서 뺄 넓은 말 — 「옵션 GPU 분할」은 「GPU 분할」로, 「gcube 크레딧」은 「크레딧」으로.
 * 「추가」는 빼지 않는다 — 「추가 크레딧」과 「gcube 크레딧」이 둘 다 「크레딧」이 되면 엉뚱한 품목을 고른다(실측 2026-10-20).
 */
// 상표어는 소문자 낱말만(gcube). 「H100 서버」의 모델명, 「STD 기본 구축」의 에디션은 뜻이 있어 안 뺀다
const GENERIC_PREFIX = /^(옵션|기본|[a-z]+)\s+/

function num(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function firstNum(m: RegExpExecArray | RegExpMatchArray | null): number | null {
  if (!m) return null
  for (let i = 1; i < m.length; i += 1) if (m[i] !== undefined) return num(m[i])
  return null
}

function namesOf(e: CatalogEntry): string[] {
  return [e.name, e.name.replace(GENERIC_PREFIX, ''), ...e.aliases].map(norm).filter((s) => s.length >= 2)
}

/** 품목 맞추기 — 이름(넓은 말을 뺀 것 포함)이나 별칭이 글에 들어 있으면 */
function matchItems(text: string, entries: readonly CatalogEntry[]): string[] {
  const t = norm(text)
  // 더 길게 맞은 품목이 먼저 — 「추가 크레딧 1억」은 「크레딧」보다 「추가 크레딧」이다
  return entries
    .map((e) => ({ id: e.id, len: Math.max(0, ...namesOf(e).filter((n) => t.includes(n)).map((n) => n.length)) }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len)
    .map((x) => x.id)
}

/** 제품 맞추기 — 전체 이름이나 마지막 낱말(「gcube edge」의 edge). 첫 낱말은 회사 이름이라 크레딧과 겹친다 */
function matchProduct(text: string, products: readonly CatalogProduct[]): string | null {
  const t = norm(text)
  for (const p of products) {
    const words = p.name.split(/\s+/).filter(Boolean)
    const last = words.length > 1 ? norm(words[words.length - 1]) : norm(p.name)
    if (t.includes(norm(p.name)) || (last.length >= 3 && t.includes(last))) return p.id
  }
  return null
}

function companyKindOf(text: string): CompanyKind | null {
  if (SCHOOL_RE.test(text)) return 'school'
  if (GOV_RE.test(text)) return 'government'
  if (PUBLIC_RE.test(text)) return 'public'
  return null
}

function editionOf(text: string): Reading['edition'] {
  if (EDITION_WORDS.ENT.test(text)) return 'ENT'
  if (EDITION_WORDS.STD.test(text)) return 'STD'
  return null
}

function maintenanceOf(text: string): Reading['maintenance'] {
  if (MAINT_WORDS.EXT.test(text)) return 'EXT'
  if (MAINT_WORDS.STD.test(text)) return 'STD'
  return null
}

function countsOf(text: string): Reading['counts'] {
  const out: Reading['counts'] = []
  for (let m = COUNT_RE.exec(text); m !== null; m = COUNT_RE.exec(text)) {
    const unit = (m[2].toLowerCase() === 'ea' ? '개' : m[2]) as CountUnit
    out.push({ value: Number(m[1]), unit })
  }
  COUNT_RE.lastIndex = 0
  return out
}

/** 읽은 조각을 지운 나머지 — 「SSO 정산 연동 고급 2MM」 → 「SSO 정산 연동」 */
function restOf(text: string, spans: readonly string[]): string {
  let rest = text
  for (const s of spans) if (s) rest = rest.replace(s, ' ')
  return rest
    .replace(/(으로|로|이야|이에요|입니다|이요|해줌|해줘|정도|쯤|에|랑|이랑|하고|및)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function readClause(c: Clause, catalog: Catalog): Reading {
  const text = c.text
  const spans: string[] = []
  const take = <T>(m: RegExpExecArray | RegExpMatchArray | null, v: T): T => { if (m) spans.push(m[0]); return v }

  const budgetAt = text.search(BUDGET_RE)
  const amount = parseAmount(budgetAt >= 0 ? text.slice(0, budgetAt) + text.slice(budgetAt).replace(AMOUNT_RE, '') : text)
  const budget = budgetAt >= 0 ? parseAmount(text.slice(budgetAt)) : null
  if (amount) spans.push(amount.match)
  if (budget) spans.push(budget.match, '예산')

  const mmM = text.match(MM_RE)
  const gradeM = text.match(GRADE_RE)
  const nodeM = text.match(NODE_RE)
  const trainM = text.match(TRAINING_RE)
  const monthM = text.match(MONTH_RE)
  const yearM = text.match(YEAR_RE)
  const hourM = text.match(HOUR_RE)
  const discM = text.match(DISCOUNT_RE)
  const { gpus, spans: gpuSpans } = readGpus(text)
  spans.push(...gpuSpans)

  const months = monthM ? take(monthM, num(monthM[1])) : yearM && !amount ? take(yearM, (num(yearM[1]) ?? 0) * 12) : null
  const productId = matchProduct(text, catalog.products)
  const product = catalog.products.find((p) => p.id === productId)
  const itemIds = [
    ...matchItems(text, catalog.items),
    ...(product ? [] : catalog.products.flatMap((p) => matchItems(text, p.items))),
  ]

  const r: Reading = {
    ...c,
    amountMinor: amount?.minor ?? null,
    counts: gpus.length > 0 || nodeM || trainM ? [] : countsOf(text),
    manMonths: take(mmM, mmM ? num(mmM[1]) : null),
    grade: take(gradeM, gradeM ? (gradeM[1] as LaborGradeName) : null),
    months,
    hours: take(hourM, firstNum(hourM)),
    gpus,
    nodes: take(nodeM, firstNum(nodeM)),
    training: take(trainM, firstNum(trainM)),
    productId,
    itemIds: [...new Set(itemIds)],
    edition: editionOf(text),
    maintenance: maintenanceOf(text),
    discountPct: take(discM, firstNum(discM)),
    vat: VAT_IN_RE.test(text) ? 'INCLUDED' : VAT_EX_RE.test(text) ? 'EXCLUDED' : null,
    budgetMinor: budget?.minor ?? null,
    companyKind: companyKindOf(text),
    install: INSTALL_RE.test(text),
    rest: '',
    unread: false,
  }
  if (r.counts.length > 0) spans.push(...r.counts.map((x) => `${x.value}${x.unit}`))
  r.rest = restOf(text, spans)
  r.unread = !isRead(r)
  return r
}

/** 하나라도 읽었으면 읽은 줄이다 */
function isRead(r: Reading): boolean {
  return r.amountMinor !== null || r.counts.length > 0 || r.manMonths !== null || r.grade !== null
    || r.months !== null || r.hours !== null || r.gpus.length > 0 || r.nodes !== null || r.training !== null
    || r.productId !== null || r.itemIds.length > 0 || r.edition !== null || r.maintenance !== null
    || r.discountPct !== null || r.vat !== null || r.budgetMinor !== null || r.companyKind !== null || r.install
}

export function readText(text: string, catalog: Catalog): Reading[] {
  return splitClauses(text).map((c) => readClause(c, catalog))
}

/** 규칙으로 끝난 줄의 비율 — 지표로 남긴다. 줄이 없으면 1 */
export function ruleReadRatio(readings: readonly Reading[]): number {
  if (readings.length === 0) return 1
  return readings.filter((r) => !r.unread).length / readings.length
}
