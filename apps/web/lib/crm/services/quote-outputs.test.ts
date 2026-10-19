/**
 * 출력물 셋이 같은 금액을 찍는다 — 견적서(문서), 엑셀, 계약서 품목표 (P0135 I19)
 *
 * 견적 항목을 읽는 출력물이 셋이다. 1회와 매년의 구분, 묶음 절사, 「실사 후 견적(별도)」가
 * 셋에서 같게 나와야 한다. 한 곳만 고치면 계약서에 다른 금액이 찍힌다 — 그래서 한 시험에서 함께 본다.
 * 견적은 저장과 같은 셈(priceQuote)으로 만든다. 화면(QuoteSheet)은 이 문서를 그대로 그린다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildQuoteDocument, verifyDocument } from '../domain/quote-document.ts'
import { quoteDocumentToXlsx } from './quote-xlsx.ts'
import { renderBlock } from '../domain/contract-fields.ts'
import { priceQuote } from './quote-pricing.ts'
import { buildSolutionQuote } from '../domain/pricebook/solution-engine.ts'
import { GCUBE_EDGE } from '../domain/pricebook/gcube-edge.ts'
import { QUOTE } from '../../terms/quote.ts'

function edgeDoc(withSurvey = false) {
  const conds = GCUBE_EDGE.examples![0].conditions
  const r = buildSolutionQuote(GCUBE_EDGE, withSurvey ? { ...conds, picked: [...conds.picked, 'edge-infra'] } : { ...conds, companyKind: 'school', discount: 'auto' })
  const names = GCUBE_EDGE.sections.map((s) => s.name)
  const lines = r.lines.map((l) => ({
    name: l.name, quantity: String(l.quantity), unit: l.unit, unitPriceMinor: l.unitPriceMinor,
    discountPercent: String(l.discountPercent ?? 0), taxRate: l.taxRate, sectionIndex: names.indexOf(String(l.sectionKey)),
    listPriceMinor: l.listPriceMinor, priceSource: 'LIST', billing: l.billing, ratioPct: l.ratioPct, ratioOfSectionName: l.ratioOfSectionKey,
    kind: l.ratioPct ? 'RATIO' : 'QUANTITY',
  }))
  const p = priceQuote(lines as never, GCUBE_EDGE.sections, {}, 15, null)
  const sections = GCUBE_EDGE.sections.map((s, i) => ({ id: `s${i}`, name: s.name }))
  return buildQuoteDocument({
    quote: {
      quoteNo: 'Q-2026-0100', title: 'gcube edge', currency: 'KRW', validUntil: '2026-12-31', createdAt: '2026-10-20T00:00:00.000Z',
      subtotalMinor: p.subtotalMinor, discountMinor: p.discountMinor, taxMinor: p.taxMinor, totalMinor: p.totalMinor,
      roundingMinor: p.roundingMinor, notesMd: null, annualMinor: p.annualMinor, sectionRoundingMinor: p.sectionRoundingMinor,
    },
    lines: lines.map((l, i) => ({ ...l, sectionId: `s${l.sectionIndex}`, lineTotalMinor: p.lineTotals![i] })),
    sections,
    customer: { companyName: '숙명여대', fallbackName: '딜' },
    supplier: { name: '주식회사 데이터얼라이언스' },
    todayKey: '2026-10-20',
  })
}

async function cells(buffer: Buffer): Promise<{ label: string; value: unknown; all: unknown[] }[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  const out: { label: string; value: unknown; all: unknown[] }[] = []
  wb.worksheets[0].eachRow((row) => {
    const vals = (row.values as unknown[]).slice(1)
    const label = vals.find((v) => typeof v === 'string') as string | undefined
    out.push({ label: label ?? '', value: vals[vals.length - 1], all: vals })
  })
  return out
}

test('★ 교육기관 10% gcube edge: 문서 합계는 1회분(76,600,000 + 부가세), 매년 9,990,000 은 따로, 검사 위반 0', () => {
  const doc = edgeDoc()
  assert.equal(doc.totals.totalMinor, String(76_600_000 + 7_660_000))
  assert.equal(doc.totals.annualMinor, '9990000')
  assert.equal(BigInt(doc.totals.subtotalMinor) - BigInt(doc.totals.discountMinor), BigInt(76_600_000), '할인 줄에 묶음 절사가 합쳐져 계가 따라진다')
  assert.deepEqual(verifyDocument(doc), [], '매년 줄과 묶음 절사가 있어도 내보내기가 막히지 않는다')
  assert.ok(doc.lines.some((l) => l.billing === 'ANNUAL'))
})

test('★ 엑셀: 합계 76,600,000+부가세, 연 유지보수 줄 9,990,000, 매년 줄 이름에 (매년) — 값으로 박힌다', async () => {
  const doc = edgeDoc()
  const { buffer } = await quoteDocumentToXlsx({ document: doc } as never)
  const rows = await cells(buffer)
  const total = rows.find((r) => r.label === QUOTE.total)
  assert.equal(Number(total?.value), 84_260_000)
  const annual = rows.find((r) => r.label === QUOTE.annualTotal)
  assert.equal(Number(annual?.value), 9_990_000)
  assert.ok(rows.some((r) => r.label.startsWith('유지보수 표준 (매년)')))
})

test('★ 계약서 품목표: 같은 합계와 연 유지보수 줄', () => {
  const html = renderBlock('quote.lines', edgeDoc())
  assert.match(html, /84,260,000/)
  assert.match(html, new RegExp(`${QUOTE.annualTotal.replace(/[()]/g, '\\$&')}</td><td>9,990,000`))
  assert.match(html, /유지보수 표준 \(매년\)/)
})

test('★ 실사 후 견적 줄은 셋 모두 「실사 후 견적(별도)」 — 0원으로 안 찍힌다', async () => {
  const doc = edgeDoc(true)
  const line = doc.lines.find((l) => l.name.startsWith('저장소'))!
  assert.equal(line.amountLabel, QUOTE.surveySeparate)
  const { buffer } = await quoteDocumentToXlsx({ document: doc } as never)
  const rows = await cells(buffer)
  // 품목 줄은 금액 뒤에 비고 열이 있다 — 줄의 어느 칸이든 그 말이 있으면 된다
  assert.ok(rows.some((r) => r.all.includes(QUOTE.surveySeparate)), '엑셀')
  assert.match(renderBlock('quote.lines', doc), new RegExp(QUOTE.surveySeparate.replace(/[()]/g, '\\$&')), '계약서')
})
