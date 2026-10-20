/**
 * 계약서 칸 — 템플릿의 「{{고객.상호}}」 자리를 무엇으로 채우나 (P0132 I04)
 *
 * **칸 목록은 여기 한 벌이다.** 템플릿 편집기의 「칸 넣기」, 파일로 만들기의 칸 제안,
 * 계약서 만들기의 채우기가 전부 이 목록을 읽는다. 두 벌이 되면 편집기에서 넣은 칸이
 * 만들 때 빈칸이 된다.
 *
 * **모르는 칸은 거절한다.** 「{{고객.상효}}」 같은 오타가 조용히 빈칸으로 인쇄되면
 * 고객 손에 간 뒤에야 안다. 그래서 채우기 전에 이름을 대며 멈춘다.
 *
 * **빈 칸은 드러낸다.** 값이 없으면 「(미입력)」이 찍힌다 — 빈 자리가 보이지 않으면
 * 고객 대표자 이름이 빠진 계약서가 그대로 나간다.
 *
 * 견적에서 오는 값은 견적서 출력과 **같은 재료**(`QuoteDocument`)와 같은 표기 함수
 * (`formatAmount`, `hangulAmount`)로 만든다. 계약서 금액이 견적서 금액과 다르게 찍히지 않는다.
 */

import type { QuoteDocument } from './quote-document.ts'
import { formatAmount } from '../../../app/(crm)/crm/deals/amount.ts'
import { QUOTE } from '../../terms/quote.ts'
import { CONTRACT_FIELD_LABEL, EMPTY_FIELD } from '../../terms/contract-doc.ts'

export type ContractFieldSource = 'supplier' | 'customer' | 'quote' | 'contract'
/** longtext — 사람이 계약마다 여러 줄로 채우는 내용(수행범위). 줄마다 문단이 된다 */
export type ContractFieldKind = 'text' | 'money' | 'date' | 'block' | 'longtext'

export interface ContractFieldDef {
  key: string
  /** 템플릿에 적히는 이름 — {{이 이름}} */
  label: string
  source: ContractFieldSource
  kind: ContractFieldKind
  /** 견적에서 자동으로 오나. 아니면 계약서를 만들 때 사람이 넣는다 */
  auto: boolean
}

export const CONTRACT_FIELDS: readonly ContractFieldDef[] = [
  { key: 'supplier.name', label: CONTRACT_FIELD_LABEL['supplier.name'], source: 'supplier', kind: 'text', auto: true },
  { key: 'supplier.ceo', label: CONTRACT_FIELD_LABEL['supplier.ceo'], source: 'supplier', kind: 'text', auto: true },
  { key: 'supplier.bizNo', label: CONTRACT_FIELD_LABEL['supplier.bizNo'], source: 'supplier', kind: 'text', auto: true },
  { key: 'supplier.address', label: CONTRACT_FIELD_LABEL['supplier.address'], source: 'supplier', kind: 'text', auto: true },
  { key: 'supplier.phone', label: CONTRACT_FIELD_LABEL['supplier.phone'], source: 'supplier', kind: 'text', auto: true },
  { key: 'customer.name', label: CONTRACT_FIELD_LABEL['customer.name'], source: 'customer', kind: 'text', auto: true },
  { key: 'customer.contact', label: CONTRACT_FIELD_LABEL['customer.contact'], source: 'customer', kind: 'text', auto: true },
  { key: 'customer.ceo', label: CONTRACT_FIELD_LABEL['customer.ceo'], source: 'customer', kind: 'text', auto: false },
  { key: 'customer.bizNo', label: CONTRACT_FIELD_LABEL['customer.bizNo'], source: 'customer', kind: 'text', auto: false },
  { key: 'customer.address', label: CONTRACT_FIELD_LABEL['customer.address'], source: 'customer', kind: 'text', auto: false },
  // 견적의 수신 담당자 번호가 기본값이다 — 개인과의 계약이면 그 사람 번호, 아니면 고쳐 넣는다
  { key: 'customer.phone', label: CONTRACT_FIELD_LABEL['customer.phone'], source: 'customer', kind: 'text', auto: true },
  // 개인과의 계약 당사자 표시. 주민등록번호는 저장하지 않고 이 칸을 쓴다(개인정보보호법 처리 제한)
  { key: 'customer.birth', label: CONTRACT_FIELD_LABEL['customer.birth'], source: 'customer', kind: 'text', auto: false },
  { key: 'quote.no', label: CONTRACT_FIELD_LABEL['quote.no'], source: 'quote', kind: 'text', auto: true },
  { key: 'quote.title', label: CONTRACT_FIELD_LABEL['quote.title'], source: 'quote', kind: 'text', auto: true },
  { key: 'quote.issuedOn', label: CONTRACT_FIELD_LABEL['quote.issuedOn'], source: 'quote', kind: 'date', auto: true },
  { key: 'quote.supply', label: CONTRACT_FIELD_LABEL['quote.supply'], source: 'quote', kind: 'money', auto: true },
  { key: 'quote.tax', label: CONTRACT_FIELD_LABEL['quote.tax'], source: 'quote', kind: 'money', auto: true },
  { key: 'quote.total', label: CONTRACT_FIELD_LABEL['quote.total'], source: 'quote', kind: 'money', auto: true },
  // 매년 금액(가격 기준) — 합계와 따로 선다. 유지보수 계약 조항이 이 값을 부른다
  { key: 'quote.annual', label: CONTRACT_FIELD_LABEL['quote.annual'], source: 'quote', kind: 'money', auto: true },
  { key: 'quote.totalInWords', label: CONTRACT_FIELD_LABEL['quote.totalInWords'], source: 'quote', kind: 'text', auto: true },
  { key: 'quote.start', label: CONTRACT_FIELD_LABEL['quote.start'], source: 'quote', kind: 'date', auto: true },
  { key: 'quote.end', label: CONTRACT_FIELD_LABEL['quote.end'], source: 'quote', kind: 'date', auto: true },
  { key: 'quote.lines', label: CONTRACT_FIELD_LABEL['quote.lines'], source: 'quote', kind: 'block', auto: true },
  { key: 'quote.terms', label: CONTRACT_FIELD_LABEL['quote.terms'], source: 'quote', kind: 'block', auto: true },
  { key: 'owner.name', label: CONTRACT_FIELD_LABEL['owner.name'], source: 'quote', kind: 'text', auto: true },
  { key: 'owner.phone', label: CONTRACT_FIELD_LABEL['owner.phone'], source: 'quote', kind: 'text', auto: true },
  { key: 'contract.no', label: CONTRACT_FIELD_LABEL['contract.no'], source: 'contract', kind: 'text', auto: true },
  { key: 'contract.date', label: CONTRACT_FIELD_LABEL['contract.date'], source: 'contract', kind: 'date', auto: false },
  { key: 'contract.start', label: CONTRACT_FIELD_LABEL['contract.start'], source: 'contract', kind: 'date', auto: false },
  { key: 'contract.end', label: CONTRACT_FIELD_LABEL['contract.end'], source: 'contract', kind: 'date', auto: false },
  // 계약마다 내용이 다른 조항 자리 — 템플릿은 칸만 두고 계약서 고치기에서 여러 줄로 채운다
  { key: 'contract.scope', label: CONTRACT_FIELD_LABEL['contract.scope'], source: 'contract', kind: 'longtext', auto: false },
]

const BY_LABEL = new Map(CONTRACT_FIELDS.map((f) => [f.label, f]))
const BY_KEY = new Map(CONTRACT_FIELDS.map((f) => [f.key, f]))

export function fieldByKey(key: string): ContractFieldDef | undefined {
  return BY_KEY.get(key)
}

/** 템플릿에 적는 꼴 */
export const fieldToken = (label: string): string => `{{${label}}}`

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g

export { EMPTY_FIELD }

/** 본문에서 쓰인 칸 이름과 모르는 이름을 갈라 낸다 */
export function scanTokens(html: string): { known: string[]; unknown: string[] } {
  const known = new Set<string>()
  const unknown = new Set<string>()
  for (const m of html.matchAll(TOKEN)) {
    const def = BY_LABEL.get(m[1])
    if (def) known.add(def.key)
    else unknown.add(m[1])
  }
  return { known: [...known], unknown: [...unknown] }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ------------------------------------------------------------
// 값 — 견적 문서와 계약서 입력에서 칸 값을 만든다
// ------------------------------------------------------------

export interface ContractInputValues {
  contractNo: string
  /** 사람이 넣는 칸 (고객 대표자, 계약일 등). 키는 CONTRACT_FIELDS 의 key */
  manual: Record<string, string>
}

export type FieldValueSource = 'auto' | 'manual'
export interface FieldValue { value: string; source: FieldValueSource }
export type FieldValues = Record<string, FieldValue>

/** 견적 공급 기간 — 줄마다 기간이 있으면 가장 이른 시작과 가장 늦은 끝 */
function supplyRange(doc: QuoteDocument): { start: string; end: string } {
  const starts = doc.lines.map((l) => l.rate?.start).filter((v): v is string => !!v).sort()
  const ends = doc.lines.map((l) => l.rate?.end).filter((v): v is string => !!v).sort()
  return { start: starts[0] ?? '', end: ends[ends.length - 1] ?? '' }
}

const money = (minor: string, currency: string): string => formatAmount(minor, currency) ?? ''

/** 견적 문서에서 자동으로 오는 칸 값. 블록 칸은 여기서 글자로 안 만든다 (renderBlock) */
export function autoValuesFrom(doc: QuoteDocument, contractNo: string): Record<string, string> {
  const cur = doc.meta.currency
  const range = supplyRange(doc)
  return {
    'supplier.name': doc.supplier.name,
    'supplier.ceo': doc.supplier.ceo,
    'supplier.bizNo': doc.supplier.bizNo,
    'supplier.address': doc.supplier.address,
    'supplier.phone': doc.supplier.phone ?? '',
    'customer.name': doc.customer.companyName,
    'customer.contact': doc.customer.personName ?? '',
    'customer.phone': doc.customer.phone ?? '',
    'quote.no': doc.meta.quoteNo,
    'quote.title': doc.meta.title,
    'quote.issuedOn': doc.meta.issuedOn ?? '',
    'quote.supply': money(doc.totals.netTotalMinor, cur),
    'quote.tax': money(doc.totals.taxMinor, cur),
    'quote.total': money(doc.totals.totalMinor, cur),
    'quote.annual': doc.totals.annualMinor === '0' ? '' : money(doc.totals.annualMinor, cur),
    'quote.totalInWords': doc.totals.totalInWords,
    'quote.start': range.start,
    'quote.end': range.end,
    'owner.name': doc.owner.name,
    // 이 칸이 생기기 전에 굳힌 견적 스냅숏에는 없다 — 없으면 빈 값이다(「바뀐 칸」으로 잡히지 않게)
    'owner.phone': doc.owner.phone ?? '',
    'contract.no': contractNo,
  }
}

/**
 * 자동 값과 사람이 넣은 값을 합친다.
 *
 * **사람이 넣은 값이 이긴다.** 그리고 그 칸은 「사람이 고침」으로 남는다 —
 * 견적이 바뀌어 다시 채울 때 이 칸은 안 건드린다(I11).
 * 계약 시작일 끝일이 비어 있으면 견적 공급 기간을 자동 값으로 쓴다.
 */
export function mergeFieldValues(auto: Record<string, string>, manual: Record<string, string>): FieldValues {
  const out: FieldValues = {}
  for (const f of CONTRACT_FIELDS) {
    if (f.kind === 'block') continue
    const m = manual[f.key]
    if (m !== undefined && m.trim() !== '') {
      out[f.key] = { value: m.trim(), source: 'manual' }
      continue
    }
    const fallback = f.key === 'contract.start' ? auto['quote.start']
      : f.key === 'contract.end' ? auto['quote.end'] : undefined
    out[f.key] = { value: auto[f.key] ?? fallback ?? '', source: 'auto' }
  }
  return out
}

/** 블록 칸 — 품목표와 거래 조건. 값은 견적 문서에서 그때 만든다 */
export function renderBlock(key: string, doc: QuoteDocument): string {
  if (key === 'quote.terms') {
    if (doc.terms.length === 0) return `<p>${EMPTY_FIELD}</p>`
    return `<ol>${doc.terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`
  }
  if (key === 'quote.lines') return renderLinesTable(doc)
  return ''
}

function renderLinesTable(doc: QuoteDocument): string {
  const cur = doc.meta.currency
  const rows = doc.lines.map((l) => {
    const qty = l.duration ? `${l.quantity} × ${l.duration.value}` : l.quantity
    // 매년 줄과 「실사 후 견적(별도)」는 견적서 화면 엑셀과 같은 표시를 단다
    const name = l.billing === 'ANNUAL' ? `${l.name} (${QUOTE.annualMark})` : l.name
    const amount = l.amountLabel ?? money(l.amountMinor, cur)
    return `<tr><td>${l.no}</td><td>${escapeHtml(name)}</td><td>${escapeHtml(qty)}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}</td>`
      + `<td>${escapeHtml(money(l.unitPriceMinor, cur))}</td><td>${escapeHtml(amount)}</td></tr>`
  }).join('')
  const annual = doc.totals.annualMinor !== '0'
    ? `<tr><td colspan="4">${QUOTE.annualTotal}</td><td>${escapeHtml(money(doc.totals.annualMinor, cur))}</td></tr>`
    : ''
  const total = `<tr><td colspan="4">${QUOTE.total}</td><td>${escapeHtml(money(doc.totals.totalMinor, cur))}</td></tr>${annual}`
  const head = [QUOTE.lineNo, QUOTE.lineName, QUOTE.lineQuantity, QUOTE.lineUnitPrice, QUOTE.lineAmount]
    .map((h) => `<th>${h}</th>`).join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}${total}</tbody></table>`
}

export class UnknownFieldError extends Error {
  readonly unknown: string[]
  constructor(unknown: string[]) {
    super(`모르는 칸이 있습니다: ${unknown.map(fieldToken).join(', ')}`)
    this.unknown = unknown
  }
}

/**
 * 본문 HTML 의 칸 자리를 값으로 바꾼다.
 *
 * 값은 **escape 해서** 넣는다 — 고객 상호에 `<` 가 있어도 태그가 되지 않는다(보안 S4).
 * 블록 칸은 문단 하나를 통째로 차지하므로 `<p>{{견적.품목표}}</p>` 를 블록으로 바꾼다.
 */
export function fillHtml(html: string, values: FieldValues, doc: QuoteDocument | null): string {
  const { unknown } = scanTokens(html)
  if (unknown.length > 0) throw new UnknownFieldError(unknown)
  const blockFilled = html.replace(/<p>\s*\{\{\s*([^{}]+?)\s*\}\}\s*<\/p>/g, (whole, label: string) => {
    const def = BY_LABEL.get(label)
    if (def?.kind === 'longtext') return longParagraphs(values[def.key]?.value ?? '')
    if (!def || def.kind !== 'block') return whole
    return doc ? renderBlock(def.key, doc) : `<p>${EMPTY_FIELD}</p>`
  })
  return blockFilled.replace(TOKEN, (_w, label: string) => {
    const def = BY_LABEL.get(label)!
    if (def.kind === 'block') return doc ? renderBlock(def.key, doc) : EMPTY_FIELD
    const v = values[def.key]?.value ?? ''
    if (v === '') return EMPTY_SPAN
    // 글 속에 든 여러 줄 칸은 문단을 못 쪼개니 줄바꿈으로 잇는다
    return def.kind === 'longtext' ? splitLines(v).map(escapeHtml).join('<br>') : escapeHtml(v)
  })
}

const EMPTY_SPAN = `<span class="field-empty">${EMPTY_FIELD}</span>`

const splitLines = (v: string): string[] => v.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')

/** 문단 하나를 차지한 여러 줄 칸 — 줄마다 문단, 비면 「(미입력)」 문단 */
function longParagraphs(v: string): string {
  const lines = splitLines(v)
  if (lines.length === 0) return `<p>${EMPTY_SPAN}</p>`
  return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')
}

/** 지금 견적으로 다시 만든 자동 값과 버전에 든 값을 견줘 바뀐 칸을 낸다 (I11) */
export function changedAutoFields(prev: FieldValues, nextAuto: Record<string, string>): string[] {
  return Object.entries(prev)
    .filter(([key, fv]) => fv.source === 'auto' && key in nextAuto && nextAuto[key] !== fv.value)
    .map(([key]) => key)
}

/** 블록 칸(품목표 거래 조건)은 칸 값에 없어 그린 글로 견준다 */
export function changedBlockFields(prevDoc: QuoteDocument | null, nextDoc: QuoteDocument): string[] {
  return CONTRACT_FIELDS
    .filter((f) => f.kind === 'block')
    .filter((f) => (prevDoc ? renderBlock(f.key, prevDoc) : '') !== renderBlock(f.key, nextDoc))
    .map((f) => f.key)
}
