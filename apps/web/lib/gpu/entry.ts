// GPU 정해진 칸 입력 SSOT — 견적과 시세를 줄마다 같은 칸으로 받는다
//
// 왜 정해진 칸인가: 이전 입력은 글을 AI 가 읽어 칸을 채웠다
//   그 결과 단위 없는 시세 240건, 약정 표기 넷(즉시, on_demand, 1년 약정, 12-month term)이 섞였다
//   그래서 통화 기준 기간 약정 모델을 목록에서 고르게 하고, 금액은 숫자만 받는다
// 저장 꼴: 원래 금액은 이전 데이터와 같이 구성 전체 1시간(단위 「KRW/hr」), 달러 단가는 1장 1시간, 넣은 그대로의 값은 entry 에 함께 남긴다
// 화면(입력 창), 창구(POST /api/pricing/gpu/entries), CLI(teamda gpu entry create)가 이 파일 하나를 지난다

import { HOURS_PER_PERIOD } from './hours.ts'
import { normalizeTerm } from './term.ts'
import { gpuNameKey } from './gcube-link.ts'
import { kstDateOnlyToIso } from '../datetime/kst.ts'

export const ENTRY_KINDS = ['quote', 'market'] as const
export const ENTRY_CURRENCIES = ['KRW', 'USD'] as const
export const ENTRY_BASES = ['per_gpu', 'total'] as const
export const ENTRY_PERIODS = ['hour', 'month', 'minute'] as const
export const ENTRY_TERMS = ['on_demand', 'spot', 'reserved_1m', 'reserved_3m', 'reserved_6m', 'reserved_12m', 'reserved_24m', 'reserved_36m'] as const
export const MAX_ENTRY_ROWS = 200
const MAX_VENDOR_LEN = 100
const MAX_SOURCE_LEN = 500
/** 1장 1시간 1억 원(또는 그만한 달러)을 넘는 값은 칸을 잘못 넣은 것으로 본다 */
const MAX_KRW_PER_GPU_HOUR = 100_000_000
const MAX_USD_PER_GPU_HOUR = 100_000

export type EntryKind = (typeof ENTRY_KINDS)[number]
export type EntryCurrency = (typeof ENTRY_CURRENCIES)[number]
export type EntryBasis = (typeof ENTRY_BASES)[number]
export type EntryPeriod = (typeof ENTRY_PERIODS)[number]
export type EntryTerm = (typeof ENTRY_TERMS)[number]
export type EntryField = 'kind' | 'vendor' | 'product_id' | 'amount' | 'currency' | 'basis' | 'period' | 'term' | 'received_on' | 'source'

/** 칸의 순서, 엑셀 붙여넣기도 이 순서로 읽는다 */
export const ENTRY_FIELDS: readonly EntryField[] = ['kind', 'vendor', 'product_id', 'amount', 'currency', 'basis', 'period', 'term', 'received_on', 'source']

export interface EntryInput {
  kind: EntryKind
  vendor: string
  product_id: string
  amount: number
  currency: EntryCurrency
  basis: EntryBasis
  period: EntryPeriod
  term: EntryTerm
  /** YYYY-MM-DD */
  received_on: string
  source: string | null
}

export interface EntryProduct {
  id: string
  model_name: string
  memory: string | null
  gpu_count: number | null
}

export interface EntryError {
  /** 1 부터 */
  line: number
  field: EntryField
  code: 'required' | 'invalid' | 'too_long' | 'out_of_range'
}

export interface EntryNormalized extends EntryInput {
  gpu_count: number
  /** 1장 1시간, 원래 통화 */
  per_gpu_hour: number
}

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** 1장 1시간 값 — 구성 전체 금액이면 장수로 나누고, 월과 분은 시간으로 바꾼다 (월 = 720시간, hours.ts) */
export function perGpuHour(amount: number, basis: EntryBasis, period: EntryPeriod, gpuCount: number): number {
  const perGpu = basis === 'total' ? amount / Math.max(1, gpuCount) : amount
  return Math.round((perGpu / HOURS_PER_PERIOD[period]) * 10000) / 10000
}

/** 한 줄 검증, 틀린 칸은 전부 돌려준다 (첫 칸에서 멈추지 않음) */
export function validateEntry(raw: unknown, line: number, products: Map<string, EntryProduct>, today: string): { entry: EntryNormalized | null; errors: EntryError[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const errors: EntryError[] = []
  const fail = (field: EntryField, code: EntryError['code']) => errors.push({ line, field, code })

  if (!has(ENTRY_KINDS, r.kind)) fail('kind', r.kind == null || r.kind === '' ? 'required' : 'invalid')
  const vendor = typeof r.vendor === 'string' ? r.vendor.trim() : ''
  if (!vendor) fail('vendor', 'required')
  else if (vendor.length > MAX_VENDOR_LEN) fail('vendor', 'too_long')
  const product = typeof r.product_id === 'string' ? products.get(r.product_id) : undefined
  if (!product) fail('product_id', r.product_id ? 'invalid' : 'required')
  const amount = typeof r.amount === 'number' ? r.amount : NaN
  if (!Number.isFinite(amount)) fail('amount', r.amount == null || r.amount === '' ? 'required' : 'invalid')
  else if (amount <= 0) fail('amount', 'out_of_range')
  if (!has(ENTRY_CURRENCIES, r.currency)) fail('currency', 'invalid')
  if (!has(ENTRY_BASES, r.basis)) fail('basis', 'invalid')
  if (!has(ENTRY_PERIODS, r.period)) fail('period', 'invalid')
  const term = r.term == null || r.term === '' ? 'on_demand' : r.term
  if (!has(ENTRY_TERMS, term)) fail('term', 'invalid')
  const receivedOn = typeof r.received_on === 'string' && r.received_on ? r.received_on : today
  if (!validDate(receivedOn)) fail('received_on', 'invalid')
  else if (receivedOn > today) fail('received_on', 'out_of_range')
  const source = typeof r.source === 'string' && r.source.trim() ? r.source.trim() : null
  if (source && source.length > MAX_SOURCE_LEN) fail('source', 'too_long')

  if (errors.length > 0 || !product) return { entry: null, errors }
  const gpuCount = Math.max(1, Number(product.gpu_count) || 1)
  const perHour = perGpuHour(amount, r.basis as EntryBasis, r.period as EntryPeriod, gpuCount)
  const cap = r.currency === 'KRW' ? MAX_KRW_PER_GPU_HOUR : MAX_USD_PER_GPU_HOUR
  if (perHour > cap) return { entry: null, errors: [{ line, field: 'amount', code: 'out_of_range' }] }
  return {
    entry: {
      kind: r.kind as EntryKind, vendor, product_id: product.id, amount, currency: r.currency as EntryCurrency,
      basis: r.basis as EntryBasis, period: r.period as EntryPeriod, term: term as EntryTerm,
      received_on: receivedOn, source, gpu_count: gpuCount, per_gpu_hour: perHour,
    },
    errors: [],
  }
}

export function validateEntries(rows: unknown[], products: EntryProduct[], today: string): { entries: EntryNormalized[]; errors: EntryError[] } {
  const byId = new Map(products.map((p) => [p.id, p]))
  const entries: EntryNormalized[] = []
  const errors: EntryError[] = []
  rows.forEach((raw, i) => {
    const r = validateEntry(raw, i + 1, byId, today)
    if (r.entry) entries.push(r.entry)
    errors.push(...r.errors)
  })
  return { entries, errors }
}

// ── 엑셀 붙여넣기 ─────────────────────────────────────────────────────────────

const KIND_WORDS: Record<string, EntryKind> = { 견적: 'quote', 원가: 'quote', quote: 'quote', 시세: 'market', 경쟁사: 'market', market: 'market' }
const CURRENCY_WORDS: Record<string, EntryCurrency> = { krw: 'KRW', 원: 'KRW', '₩': 'KRW', usd: 'USD', '$': 'USD', 달러: 'USD' }
const BASIS_WORDS: Record<string, EntryBasis> = { '1장': 'per_gpu', 장당: 'per_gpu', pergpu: 'per_gpu', gpu: 'per_gpu', 전체: 'total', 구성: 'total', 구성전체: 'total', 총액: 'total', total: 'total' }
const PERIOD_WORDS: Record<string, EntryPeriod> = { 시간: 'hour', hr: 'hour', hour: 'hour', h: 'hour', 월: 'month', month: 'month', mo: 'month', 분: 'minute', min: 'minute', minute: 'minute' }
const HEADER_WORDS: Record<string, EntryField> = {
  종류: 'kind', 공급사: 'vendor', 경쟁사: 'vendor', 공급사경쟁사: 'vendor', 모델: 'product_id', 금액: 'amount', 통화: 'currency',
  기준: 'basis', 기간: 'period', 약정: 'term', 받은날: 'received_on', 일자: 'received_on', 출처: 'source',
}

const wordKey = (s: string) => s.toLowerCase().replace(/[\s·_\-/]/g, '')

function pick<T>(words: Record<string, T>, cell: string): T | undefined {
  return words[wordKey(cell)]
}

/** 붙여 넣은 모델 글을 상품 하나로 — 「H100 80GB × 8」, 「H100 x8」, 「RTX 4090」 꼴, 하나로 안 좁혀지면 null */
export function resolveProductText(text: string, products: EntryProduct[]): string | null {
  const t = text.trim()
  if (!t) return null
  // 장수 표기는 「× 8」「*8」「 x8」만, 「RTX4090」의 X 를 장수로 읽지 않게 x 앞에는 빈칸을 요구한다
  const COUNT_RE = /(?:\s[xX]|[×*])\s*(\d{1,2})\s*$/
  const count = Number(t.match(COUNT_RE)?.[1] ?? 1)
  const mem = Number(t.match(/(\d+(?:\.\d+)?)\s*GB/i)?.[1] ?? NaN)
  const name = gpuNameKey(t.replace(COUNT_RE, '').replace(/\d+(?:\.\d+)?\s*GB/i, ''))
  const hits = products.filter((p) => {
    if (gpuNameKey(p.model_name) !== name) return false
    const pc = Math.max(1, Number(p.gpu_count) || 1)
    if (pc !== count) return false
    if (!Number.isFinite(mem)) return true
    const total = parseFloat((p.memory ?? '').replace(/[^0-9.]/g, ''))
    return Number.isFinite(total) && Math.round(total / pc) === Math.round(mem)
  })
  return hits.length === 1 ? hits[0].id : null
}

function toAmount(cell: string): number | string {
  const cleaned = cell.replace(/[,\s₩$원]|krw|usd/gi, '')
  if (!cleaned) return ''
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : cell
}

function toDate(cell: string): string {
  const m = cell.trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : cell.trim()
}

/** 붙여 넣은 한 줄을 칸으로, 못 읽은 칸은 원문을 남겨 검증에서 틀린 칸으로 잡힌다 */
function cellsToRaw(cells: string[], order: readonly (EntryField | null)[], products: EntryProduct[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  order.forEach((field, i) => {
    const cell = (cells[i] ?? '').trim()
    if (!field || !cell) return
    if (field === 'kind') out.kind = pick(KIND_WORDS, cell) ?? cell
    else if (field === 'currency') out.currency = pick(CURRENCY_WORDS, cell) ?? cell.toUpperCase()
    else if (field === 'basis') out.basis = pick(BASIS_WORDS, cell) ?? cell
    else if (field === 'period') out.period = pick(PERIOD_WORDS, cell) ?? cell
    else if (field === 'term') out.term = normalizeTerm(cell)
    else if (field === 'amount') out.amount = toAmount(cell)
    else if (field === 'received_on') out.received_on = toDate(cell)
    else if (field === 'product_id') out.product_id = resolveProductText(cell, products) ?? ''
    else out[field] = cell
  })
  return out
}

/**
 * 엑셀에서 복사한 탭 구분 글을 줄로 — 첫 줄이 머리줄(종류, 공급사, 모델…)이면 그 순서를 쓰고, 아니면 ENTRY_FIELDS 순서
 * 빈 줄은 건너뛴다, 칸이 하나뿐인 줄(탭 없음)도 그 순서로 읽는다
 */
export function parsePastedEntries(text: string, products: EntryProduct[]): Array<Record<string, unknown>> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
  if (lines.length === 0) return []
  const first = lines[0].split('\t').map((c) => HEADER_WORDS[wordKey(c)] ?? null)
  const isHeader = first.filter(Boolean).length >= 2
  const order = isHeader ? first : ENTRY_FIELDS
  return (isHeader ? lines.slice(1) : lines).slice(0, MAX_ENTRY_ROWS).map((l) => cellsToRaw(l.split('\t'), order, products))
}

// ── 저장 꼴 ───────────────────────────────────────────────────────────────────

const TERM_MONTHS: Record<EntryTerm, number | null> = {
  on_demand: null, spot: null, reserved_1m: 1, reserved_3m: 3, reserved_6m: 6, reserved_12m: 12, reserved_24m: 24, reserved_36m: 36,
}

/** 구성 전체 1시간 단위 — 확정 함수(resolveConfirmUnitPrice)가 장수로 나눠 1장 값을 낸다 */
export function hourUnit(currency: EntryCurrency): string {
  return `${currency}/hr`
}

/** 1장 1시간 달러 — 원화는 최신 환율로 나눈다 */
export function toUsd(perGpuHourValue: number, currency: EntryCurrency, krwPerUsd: number): number {
  const usd = currency === 'USD' ? perGpuHourValue : perGpuHourValue / krwPerUsd
  return Math.round(usd * 10000) / 10000
}

/** 검토 항목 current_extracted — 이전 입력과 같은 칸 이름을 쓴다 (confirm-review-item.ts 가 읽는 칸) */
export function toExtracted(e: EntryNormalized, product: EntryProduct, krwPerUsd: number): Record<string, unknown> {
  const usd = toUsd(e.per_gpu_hour, e.currency, krwPerUsd)
  const common = {
    model_name: product.model_name,
    memory: product.memory,
    gpu_count: e.gpu_count,
    original_currency: e.currency,
    received_at: kstDateOnlyToIso(e.received_on),
    entry: { amount: e.amount, currency: e.currency, basis: e.basis, period: e.period, term: e.term, received_on: e.received_on, source: e.source },
  }
  if (e.kind === 'market') {
    return {
      ...common,
      competitor_name: e.vendor,
      original_price: e.per_gpu_hour, // 시세 원래 금액은 1장 1시간 (competitor-import 규약)
      price_usd: usd,
      pricing_model: e.term === 'spot' ? 'spot' : e.term === 'on_demand' ? 'on_demand' : 'reserved',
      obs: {
        amount: e.amount, currency: e.currency, pricing_unit: e.period,
        gpu_count: e.basis === 'total' ? e.gpu_count : 1, observed_at: common.received_at,
      },
    }
  }
  return {
    ...common,
    supplier: e.vendor,
    unit_price_usd: usd,
    original_price: Math.round(e.per_gpu_hour * e.gpu_count * 100) / 100,
    original_unit: hourUnit(e.currency),
    term: e.term,
    term_months: TERM_MONTHS[e.term],
  }
}
