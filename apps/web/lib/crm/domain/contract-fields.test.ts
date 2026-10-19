import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONTRACT_FIELDS, scanTokens, fillHtml, autoValuesFrom, mergeFieldValues, changedAutoFields,
  fieldToken, UnknownFieldError, EMPTY_FIELD,
} from './contract-fields.ts'
import type { QuoteDocument } from './quote-document.ts'
import { CONTRACT_FIELD_LABEL } from '../../terms/contract-doc.ts'

const label = (key: string): string => CONTRACT_FIELD_LABEL[key]

// 합성 견본 — 고객 값은 지어낸 것이다
const DOC = {
  documentTitle: '견적서',
  sections: [],
  supplier: { name: '주식회사 에이엑스', bizNo: '123-45-67890', ceo: '홍길동', address: '서울', bizType: '', bizItem: '', terms: '' },
  owner: { name: '김영업', title: '', email: '', phone: '' },
  customer: { companyName: '주식회사 <한빛>', personName: '박담당님' },
  meta: {
    quoteNo: 'DA-20261016-01', title: 'GPU 증설', issuedOn: '2026-10-16', validUntil: null, currency: 'KRW',
    expired: false, revision: '', variantLabel: '', printComponents: 'expand',
    rateAxisKeys: [], lineNoteKeys: [], totalConvKeys: [], hoursPerMonth: 730,
  },
  lines: [{
    no: 1, sectionId: null, name: 'H100 서버', spec: null, components: [], unit: '대', quantity: '2',
    duration: { value: '6', unit: 'MONTH', factor: 6 }, unitPriceMinor: '1458333', discountPercent: '0',
    isSpecialDiscount: false, baseDiscountPercent: '0', specialDiscountPercent: '0',
    baseAmountMinor: '17500000', amountMinor: '17500000', remark: null,
    rate: { start: '2026-11-01', end: '2027-04-30', months: 6, days: null, totalHours: null, monthlyMinor: null, hourlyMinor: null, hourlyExact: false, hoursPerMonth: 730 },
  }],
  totals: {
    conv: null, subtotalMinor: '17500000', discountMinor: '0', netTotalMinor: '17500000', roundingMinor: '0',
    totalKrwMinor: '19250000', fxRate: '', fxDate: '', taxMinor: '1750000', totalMinor: '19250000',
    totalInWords: '금 일천구백이십오만원정',
  },
  terms: ['검수 후 30일 이내 지급'],
  customerNote: null,
} as unknown as QuoteDocument

test('견적 값이 견적서와 같은 표기로 채워진다 — 금액 쉼표, 한글 금액, 공급 기간', () => {
  const v = autoValuesFrom(DOC, 'CT-1')
  assert.equal(v['quote.total'], '19,250,000원')
  assert.equal(v['quote.totalInWords'], '금 일천구백이십오만원정')
  assert.equal(v['quote.start'], '2026-11-01')
  assert.equal(v['quote.end'], '2027-04-30')
  assert.equal(v['contract.no'], 'CT-1')
})

test('★ 모르는 칸은 이름을 대며 멈춘다 — 오타가 빈칸으로 인쇄되지 않는다', () => {
  const html = `<p>${fieldToken('고객.상효')} 와 ${fieldToken(label('customer.name'))}</p>`
  assert.deepEqual(scanTokens(html).unknown, ['고객.상효'])
  assert.throws(() => fillHtml(html, {}, DOC), (e: unknown) => e instanceof UnknownFieldError && e.unknown[0] === '고객.상효')
})

test('★ 칸 값은 escape 되어 태그가 되지 않는다 (보안 S4)', () => {
  const values = mergeFieldValues(autoValuesFrom(DOC, 'CT-1'), {})
  const out = fillHtml(`<p>${fieldToken(label('customer.name'))}</p>`, values, DOC)
  assert.equal(out, '<p>주식회사 &lt;한빛&gt;</p>')
  const evil = mergeFieldValues({}, { 'customer.ceo': '<script>alert(1)</script>' })
  assert.doesNotMatch(fillHtml(`<p>${fieldToken(label('customer.ceo'))}</p>`, evil, DOC), /<script>/)
})

test('빈 값은 「(미입력)」으로 드러난다', () => {
  const values = mergeFieldValues(autoValuesFrom(DOC, 'CT-1'), {})
  const out = fillHtml(`<p>${fieldToken(label('customer.ceo'))}</p>`, values, DOC)
  assert.match(out, new RegExp(EMPTY_FIELD.replace(/[()]/g, '\\$&')))
})

test('블록 칸은 문단을 통째로 품목표와 거래 조건으로 바꾼다', () => {
  const values = mergeFieldValues(autoValuesFrom(DOC, 'CT-1'), {})
  const out = fillHtml(`<p>${fieldToken(label('quote.lines'))}</p><p>${fieldToken(label('quote.terms'))}</p>`, values, DOC)
  assert.match(out, /^<table>/)
  assert.match(out, /H100 서버/)
  assert.match(out, /<ol><li>검수 후 30일 이내 지급<\/li><\/ol>$/)
})

test('★ 사람이 넣은 값이 이기고 「사람이 고침」으로 남는다, 다시 채우기는 자동 칸만 짚는다', () => {
  const auto = autoValuesFrom(DOC, 'CT-1')
  const v = mergeFieldValues(auto, { 'contract.end': '2027-05-31' })
  assert.deepEqual(v['contract.end'], { value: '2027-05-31', source: 'manual' })
  assert.deepEqual(v['contract.start'], { value: '2026-11-01', source: 'auto' })
  const next = { ...auto, 'quote.total': '18,480,000', 'quote.end': '2027-03-31' }
  const changed = changedAutoFields(v, next)
  assert.ok(changed.includes('quote.total'))
  assert.ok(changed.includes('quote.end'))
  assert.ok(!changed.includes('contract.end'), '사람이 고친 칸을 다시 채우기 대상으로 잡았다')
})

test('칸 이름은 겹치지 않고 전부 용어 파일에 있다', () => {
  const labels = CONTRACT_FIELDS.map((f) => f.label)
  assert.equal(new Set(labels).size, labels.length)
  for (const f of CONTRACT_FIELDS) assert.equal(f.label, CONTRACT_FIELD_LABEL[f.key], f.key)
  assert.equal(Object.keys(CONTRACT_FIELD_LABEL).length, CONTRACT_FIELDS.length)
})

/*
  ── 견적 문서의 값 칸을 센다 ───────────────────────────────────────────────
  견적 문서에 칸이 늘면 계약서가 그 값을 못 쓰는 채로 지나간다(복제 경로가 새 칼럼을
  잊은 사고와 같은 모양, 견적 복제에서 세 번). 그래서 칸 목록이 아니라 **인터페이스 글자를** 센다.
  칸 하나하나가 계약서 칸으로 쓰이거나, 안 쓰는 이유가 적혀 있어야 한다.
*/
const COVERED: Record<string, string> = {
  'supplier.name': 'supplier.name', 'supplier.ceo': 'supplier.ceo', 'supplier.bizNo': 'supplier.bizNo',
  'supplier.address': 'supplier.address', 'customer.companyName': 'customer.name',
  'customer.personName': 'customer.contact', 'owner.name': 'owner.name',
  'meta.quoteNo': 'quote.no', 'meta.title': 'quote.title', 'meta.issuedOn': 'quote.issuedOn',
  'totals.netTotalMinor': 'quote.supply', 'totals.taxMinor': 'quote.tax', 'totals.totalMinor': 'quote.total',
  'totals.totalInWords': 'quote.totalInWords', 'lines': 'quote.lines', 'terms': 'quote.terms',
  'totals.annualMinor': 'quote.annual',
}
const EXEMPT: Record<string, string> = {
  'totals.sectionRoundingMinor': '묶음 절사 합은 할인 줄에 합쳐 인쇄되고 계약서는 합계와 공급가액을 쓴다',
  'supplier.bizType': '업태는 사업자등록 서식의 칸이고 계약서 당사자 표시에 안 쓴다',
  'supplier.bizItem': '종목은 사업자등록 서식의 칸이고 계약서 당사자 표시에 안 쓴다',
  'supplier.terms': '설정의 옛 기본 조건 한 덩어리다. 계약서는 견적이 고른 조건(terms)을 쓴다',
  'owner.title': '우리 담당 직함은 견적서 담당란 표시용이다. 계약서 서명란은 대표자가 선다',
  'owner.email': '담당 연락처는 견적서 머리말용이다. 계약서 당사자는 회사다',
  'owner.phone': '담당 연락처는 견적서 머리말용이다. 계약서 당사자는 회사다',
  'meta.validUntil': '견적 유효기간은 견적에만 뜻이 있다. 계약서에는 계약 기간이 따로 선다',
  'meta.currency': '통화는 금액 칸 표기에 이미 들어간다(formatAmount)',
  'meta.expired': '화면 판정용 표시다. 문서 글이 아니다',
  'meta.revision': '견적 차수는 계약서 버전 기록의 출처(sourceQuoteId)에 남는다',
  'meta.variantLabel': '다른 안 이름은 버전 기록의 출처에 남는다',
  'meta.printComponents': '견적서 인쇄 방식 선택이다',
  'meta.rateAxisKeys': '견적서 인쇄 방식 선택이다',
  'meta.lineNoteKeys': '견적서 인쇄 방식 선택이다',
  'meta.totalConvKeys': '견적서 인쇄 방식 선택이다',
  'meta.hoursPerMonth': '시간당 환산 기준이다. 품목표 금액에 이미 반영됐다',
  'totals.conv': '월·시간 환산은 견적서 인쇄 선택이다',
  'totals.subtotalMinor': '할인 전 금액이다. 계약 금액은 공급가액(netTotal)과 합계로 선다',
  'totals.discountMinor': '할인은 품목표와 공급가액에 반영된다',
  'totals.roundingMinor': '절사는 합계에 반영된다',
  'totals.totalKrwMinor': '외화 견적의 원화 환산이다. 계약 금액은 견적 통화로 선다',
  'totals.fxRate': '환율은 견적 스냅샷에 남는다',
  'totals.fxDate': '환율 날짜는 견적 스냅샷에 남는다',
  'documentTitle': '「견적서」라는 문서 이름이다',
  'sections': '묶음은 견적서 인쇄 구성이다',
  'customerNote': '견적 특기사항은 견적서에만 인쇄된다. 계약 특약은 템플릿 조항이 맡는다',
}

const SRC = readFileSync(join(import.meta.dirname, 'quote-document.ts'), 'utf8')

function interfaceFields(name: string): string[] {
  const start = SRC.indexOf(`export interface ${name} {`)
  assert.ok(start >= 0, `${name} 인터페이스를 못 찾았다`)
  let depth = 0
  let i = SRC.indexOf('{', start)
  const bodyStart = i + 1
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    if (SRC[i] === '}' && --depth === 0) break
  }
  const body = SRC.slice(bodyStart, i).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  // 한 단계 안쪽 이름만 센다 — 안쪽 객체 타입(meta 의 { … })은 따로 센다
  const out: string[] = []
  let d = 0
  for (const line of body.split('\n')) {
    const m = d === 0 ? line.match(/^\s*(\w+)\??:/) : null
    if (m) out.push(m[1])
    d += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
  }
  return out
}

function metaFields(): string[] {
  const start = SRC.indexOf('export interface QuoteDocument {')
  const metaAt = SRC.indexOf('meta: {', start)
  const end = SRC.indexOf('\n  }', metaAt)
  return [...SRC.slice(metaAt + 7, end).matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1])
}

test('★ 견적 문서의 값 칸은 모두 계약서 칸이거나 사유와 함께 면제다', () => {
  const paths = [
    ...interfaceFields('DocumentSupplier').map((f) => `supplier.${f}`),
    ...interfaceFields('DocumentOwner').map((f) => `owner.${f}`),
    ...interfaceFields('DocumentCustomer').map((f) => `customer.${f}`),
    ...interfaceFields('DocumentTotals').map((f) => `totals.${f}`),
    ...metaFields().map((f) => `meta.${f}`),
    ...interfaceFields('QuoteDocument').filter((f) => !['supplier', 'owner', 'customer', 'totals', 'meta'].includes(f)),
  ]
  assert.ok(paths.length > 30, `센 칸이 너무 적다 (${paths.length}) — 읽는 법이 깨졌다`)
  const loose = paths.filter((p) => !(p in COVERED) && !(p in EXEMPT))
  assert.deepEqual(loose, [], `계약서가 모르는 견적 칸: ${loose.join(', ')}`)
  for (const [p, why] of Object.entries(EXEMPT)) assert.ok(why.length >= 10, `${p} 면제 사유가 비었다`)
  for (const key of Object.values(COVERED)) assert.ok(CONTRACT_FIELDS.some((f) => f.key === key), key)
  const stale = [...Object.keys(COVERED), ...Object.keys(EXEMPT)].filter((p) => !paths.includes(p))
  assert.deepEqual(stale, [], `견적 문서에 없는 칸을 적어 두었다: ${stale.join(', ')}`)
})
