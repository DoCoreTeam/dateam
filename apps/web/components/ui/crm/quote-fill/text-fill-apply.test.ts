import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GCUBE_EDGE } from '../../../../lib/crm/domain/pricebook/gcube-edge.ts'
import { readText } from '../../../../lib/crm/domain/quote-text/read-rules.ts'
import { runTextFill, type ClientLine } from '../../../../lib/crm/domain/quote-text/text-fill.ts'
import { SOOKMYUNG_LINES, TEST_CATALOG } from '../../../../lib/crm/domain/quote-text/fixtures.ts'
import { applyTextFill, toClientLines, type TextFillJson } from './text-fill-apply.ts'
import type { QuoteDraft } from '../quote-draft-shape'

const CTX = {
  products: [GCUBE_EDGE],
  items: [{ id: 'credit', name: 'gcube 크레딧', unit: '식', listPriceMinor: null, section: '크레딧 충전', taxRate: 10 }],
  laborGrades: [], gpuPrice: () => null, companyKind: null,
}

const EMPTY: QuoteDraft = {
  title: '견적', currency: 'KRW', validUntil: '', notesMd: '', recipientPersonId: null, termIds: [], sections: [],
  roundingUnit: 0, roundingMode: 'DOWN', rateAxisKeys: [], lineNoteKeys: [], totalConvKeys: [], rateHoursPerMonth: '',
  lines: [{ productId: null, name: '', descriptionMd: '', remark: '', kind: 'QUANTITY', quantity: '1', unit: '개', unitPriceMinor: '', discountPercent: '0', taxRate: '10' }],
}

/** 서버 한 바퀴를 흉내 — 같은 순수 함수에 JSON 왕복(BigInt 는 문자열)까지 */
function serve(draft: QuoteDraft, text: string): TextFillJson {
  const r = readText(text, TEST_CATALOG)
  const res = runTextFill(r, r, CTX, toClientLines(draft) as unknown as ClientLine[], [GCUBE_EDGE])
  const body = { ...res, aiStatus: 'NOT_NEEDED', byAi: [], aliases: [], aiCache: null, runId: null }
  return JSON.parse(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as TextFillJson
}

test('빈 견적에 숙명여대 글을 쓰면 묶음과 줄이 선다', () => {
  const { draft, changed } = applyTextFill(EMPTY, serve(EMPTY, SOOKMYUNG_LINES), SOOKMYUNG_LINES)
  assert.ok(changed > 0)
  assert.equal(draft.fillText, SOOKMYUNG_LINES)
  assert.ok(draft.lines.every((l) => l.name.trim() !== ''), '빈 줄이 남음')
  const credit = draft.lines.find((l) => /크레딧/.test(l.name))!
  assert.equal(credit.unitPriceMinor, '280000000')
  assert.equal(draft.sections[credit.sectionIndex as number].name, '크레딧 충전')
  const lic = draft.sections.find((s) => s.name === '라이선스')
  assert.equal(lic?.roundingUnit, 10_000)
  assert.ok((draft.autoFilled ?? []).some((a) => /노드 30대/.test(a.provenance.note ?? '')))
})

test('같은 글을 다시 정리하면 변화 0', () => {
  const first = applyTextFill(EMPTY, serve(EMPTY, SOOKMYUNG_LINES), SOOKMYUNG_LINES).draft
  const again = applyTextFill(first, serve(first, SOOKMYUNG_LINES), SOOKMYUNG_LINES)
  assert.equal(again.changed, 0)
  assert.deepEqual(again.draft.lines, first.lines)
})

test('사람이 고친 단가는 글을 바꿔도 남는다', () => {
  const first = applyTextFill(EMPTY, serve(EMPTY, SOOKMYUNG_LINES), SOOKMYUNG_LINES).draft
  const i = first.lines.findIndex((l) => /데이터센터/.test(l.name))
  const edited: QuoteDraft = { ...first, lines: first.lines.map((l, k) => (k === i ? { ...l, unitPriceMinor: '7000000', lockedFields: ['unitPrice'] } : l)) }
  const text = SOOKMYUNG_LINES.replace('H100 4장', 'H100 6장')
  const next = applyTextFill(edited, serve(edited, text), text).draft
  const dc = next.lines.find((l) => /데이터센터/.test(l.name))!
  assert.equal(dc.unitPriceMinor, '7000000')
  assert.equal(dc.quantity, '6')
})

test('글 줄을 지우면 그 줄의 항목만, 표에 직접 쓴 줄은 남는다', () => {
  const first = applyTextFill(EMPTY, serve(EMPTY, SOOKMYUNG_LINES), SOOKMYUNG_LINES).draft
  const withHand: QuoteDraft = { ...first, lines: [...first.lines, { ...EMPTY.lines[0], name: '사람이 쓴 줄', unitPriceMinor: '1000' }] }
  const text = SOOKMYUNG_LINES.replace('크레딧 2.8억\n', '')
  const next = applyTextFill(withHand, serve(withHand, text), text).draft
  assert.ok(!next.lines.some((l) => /크레딧/.test(l.name)))
  assert.ok(next.lines.some((l) => l.name === '사람이 쓴 줄'))
})

test('창구는 MEMBER 인증을 지나고 GPU 가격표 읽기는 그 뒤에만', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../../../app/api/crm/quotes/text-fill/route.ts', import.meta.url), 'utf8')
  assert.match(src, /withCrmApi\('MEMBER', async/)
  assert.ok(src.indexOf("withCrmApi('MEMBER'") < src.indexOf('loadGpuPriceLookup()'))
})

test('편집기는 멈춘 뒤에만 부른다 — 3초', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('./QuoteTextEditor.tsx', import.meta.url), 'utf8')
  assert.match(src, /export const PAUSE_MS = 3_000/)
  assert.match(src, /if \(!force && now === lastSent\.current\) return/)
})
