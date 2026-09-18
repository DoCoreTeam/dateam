/**
 * 견적서 문서 읽기 스키마·프롬프트 가드
 *
 * **여기가 마지막 문이다.** 이 스키마를 지난 값은 화면에 항목으로 뜨고,
 * 사람이 체크하면 그대로 고객에게 나가는 견적이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  QuoteFromDocOutputSchema, parseQuoteFromDoc, MAX_DOC_LINES,
} from './quote-from-doc.ts'
import { QUOTE_FROM_DOC_V1 } from '../prompts/quote-from-doc.v1.ts'

const base = {
  title: 'KTL 하드웨어 납품 견적',
  currency: 'KRW',
  customerName: '한국산업기술시험원',
  issuedOn: '2026-03-14',
  lines: [] as unknown[],
  sourceTotalMinor: 110000000,
  sourceTotalIncludesTax: true,
  taxPercent: 10,
  unclear: [],
}

const line = {
  name: 'H100 80GB SXM',
  spec: 'SXM5',
  kind: 'QUANTITY',
  quantity: 2,
  unit: '대',
  unitPriceMinor: 50000000,
  discountPercent: null,
  specialDiscountPercent: null,
  amountMinor: 100000000,
  sourceText: 'H100 80GB SXM | 2 | 50,000,000 | 100,000,000',
}

/* ── 검산 거리 ───────────────────────────────────── */

test('★ 줄마다 원문 조각을 담는다 — 대조할 수 없는 값은 검수가 안 된다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [line] })
  assert.equal(r.lines[0].sourceText, 'H100 80GB SXM | 2 | 50,000,000 | 100,000,000')
})

test('★ 원문 조각이 없으면 빈 문자열이다 — null 이면 그 줄이 대조 없이 통과한다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, sourceText: undefined }] })
  assert.equal(r.lines[0].sourceText, '', '칸 자체가 사라지면 화면이 「근거 없음」을 못 띄운다')
})

test('★ 문서에 적힌 줄 금액을 따로 받는다 — 수량×단가와 대조할 자리다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [line] })
  assert.equal(r.lines[0].amountMinor, 100000000)
})

test('★ 문서에 적힌 합계를 따로 받는다 — 우리 합계와 대조할 유일한 근거다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [line] })
  assert.equal(r.sourceTotalMinor, 110000000)
  assert.equal(r.sourceTotalIncludesTax, true)
})

test('합계를 못 찾으면 null 이다 — 화면이 「대조할 합계가 없다」고 말할 수 있어야 한다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, sourceTotalMinor: null, lines: [line] })
  assert.equal(r.sourceTotalMinor, null)
})

/* ── 0 으로 눕히지 않는다 ────────────────────────── */

test('★ 단가를 못 읽으면 null 이고 스키마가 통과한다 — 0 으로 눕히면 0원 줄이 조용히 들어간다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, unitPriceMinor: null }] })
  assert.equal(r.lines[0].unitPriceMinor, null)
})

test('할인율이 안 적혀 있으면 null 이다 — 0 은 「0% 할인」이라 뜻이 다르다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, discountPercent: null }] })
  assert.equal(r.lines[0].discountPercent, null)
})

/* ── 한국식 표기 ─────────────────────────────────── */

test('★ 「1,200,000원」류 표기를 정수로 푼다 — 붙여넣기 경로와 같은 규칙이어야 금액이 안 갈린다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base,
    sourceTotalMinor: '110,000,000원',
    lines: [{ ...line, unitPriceMinor: '50,000,000', amountMinor: ' 100000000 ' }],
  })
  assert.equal(r.sourceTotalMinor, 110000000)
  assert.equal(r.lines[0].unitPriceMinor, 50000000)
  assert.equal(r.lines[0].amountMinor, 100000000)
})

test('수량은 소수를 허용한다 — 「0.5 M/M」이 실제로 있다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, quantity: 0.5 }] })
  assert.equal(r.lines[0].quantity, 0.5)
})

test('음수 금액은 거절한다 — 견적서에 마이너스 단가는 없다(할인은 DISCOUNT 줄이다)', () => {
  assert.throws(() => QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, unitPriceMinor: -1 }],
  }))
})

/* ── 종류 ───────────────────────────────────────── */

test('★ 모르는 kind 는 거절한다 — QUANTITY 로 눕히면 라벨이 실제와 달라진다', () => {
  assert.throws(() => QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, kind: 'SOMETHING' }],
  }))
})

test('kind 가 null 이면 통과한다 — 모르겠다는 말을 할 수 있어야 한다', () => {
  const r = QuoteFromDocOutputSchema.parse({ ...base, lines: [{ ...line, kind: null }] })
  assert.equal(r.lines[0].kind, null)
})

/* ── 상한 ───────────────────────────────────────── */

test('항목 수 상한이 있다 — 넘으면 거절한다', () => {
  const many = Array.from({ length: MAX_DOC_LINES + 1 }, () => line)
  assert.throws(() => QuoteFromDocOutputSchema.parse({ ...base, lines: many }))
})

test('원문 조각이 길면 잘린다 — 프롬프트 응답이 통째로 죽는 것보다 낫다', () => {
  const r = QuoteFromDocOutputSchema.parse({
    ...base, lines: [{ ...line, sourceText: '가'.repeat(1000) }],
  })
  assert.ok(r.lines[0].sourceText.length <= 300)
})

/* ── 파서 ───────────────────────────────────────── */

test('★ 코드펜스를 벗긴다 — 모델이 ```json 으로 감싸는 일이 흔하다', () => {
  const r = parseQuoteFromDoc('```json\n' + JSON.stringify({ ...base, lines: [line] }) + '\n```')
  assert.equal(r.lines.length, 1)
})

/* ── 프롬프트 ────────────────────────────────────── */

test('★ 합계 행을 항목으로 넣지 말라고 적혀 있다 — 넣으면 금액이 두 배가 된다', () => {
  const p = QUOTE_FROM_DOC_V1.build('원문')
  for (const word of ['소계', '부가세', '합계']) {
    assert.ok(p.includes(word), `「${word}」 행 처리 지시가 없다`)
  }
  assert.match(p, /항목이 아니다/)
})

test('★ 역산 금지가 적혀 있다 — 역산한 할인율은 문서에 없던 숫자고 그것이 인쇄된다', () => {
  const p = QUOTE_FROM_DOC_V1.build('원문')
  assert.match(p, /역산하지 마라|나누지 마라/)
})

test('★ 0 으로 눕히지 말라고 적혀 있다', () => {
  assert.match(QUOTE_FROM_DOC_V1.build('원문'), /0 을 넣지 마라/)
})

test('★ 원문이 프롬프트에 실린다 — 안 실으면 모델이 빈 문서를 읽는다', () => {
  assert.ok(QUOTE_FROM_DOC_V1.build('##표\n가 | 나').includes('##표\n가 | 나'))
})

test('프롬프트 판번호가 있다 — 어느 판에서 나온 답인지 기록에 남아야 한다', () => {
  assert.match(QUOTE_FROM_DOC_V1.version, /^quote_from_doc@v\d+\.\d+\.\d+$/)
})
