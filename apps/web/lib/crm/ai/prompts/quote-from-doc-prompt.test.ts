/**
 * 견적서 읽기 지시 가드
 *
 * **왜 지어낸 글이 아니라 «지은 결과»를 보나**: 이 파일의 머리말은 v1.2.0 에서
 * 무엇을 뒤집었는지 설명하느라 **옛 문장을 그대로 인용한다**. 파일 글자를 훑으면
 * 그 인용이 걸려 가드가 거짓으로 통과하거나 거짓으로 실패한다.
 * 모델이 실제로 받는 것은 `build()` 가 지은 글이므로 그것만 본다.
 *
 * (같은 함정으로 CSP 가드가 지시문을 주석에 남겨 둔 판에서도 초록이었다 — 2026-09 기록)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { QUOTE_FROM_DOC_V1 } from './quote-from-doc.v1.ts'
import { QuoteFromDocLineSchema, QuoteFromDocQuoteSchema } from '../schemas/quote-from-doc.ts'
import { pageMarkLine } from '../../services/quote-source-text.ts'

/** 모델이 실제로 받는 글 */
const BUILT = QUOTE_FROM_DOC_V1.build('원문자리')

test('판이 v1.2.0 으로 올랐다 — 지시를 바꿨는데 판이 그대로면 무엇이 도는지 알 수 없다', () => {
  assert.equal(QUOTE_FROM_DOC_V1.version, 'quote_from_doc@v1.2.0')
})

test('원문이 지시 안에 실린다 — 안 실리면 모델은 빈 문서를 읽는다', () => {
  assert.ok(BUILT.includes('원문자리'), '원문이 안 들어갔다')
})

/* ── 뒤집은 규칙 넷 ──────────────────────────────── */

test('★ 이어지는 설명 행을 «위 항목의 구성»으로 받으라고 말한다 — 이 한 줄이 없어 13줄이 사라졌다', () => {
  assert.match(BUILT, /품목 칸이 비고 설명만 이어지는 행/)
  assert.match(BUILT, /버리지 마라/)
  assert.match(BUILT, /components/)
})

test('★ 금액이 없는 행도 항목이라고 말한다 — 워런티 행이 그래서 빠졌다', () => {
  assert.match(BUILT, /금액이 없는 행도 항목이다/)
  assert.match(BUILT, /워런티/)
})

test('★ 쪽 표시를 옮겨 적으라고 말하고, 그 표시가 실제 표시와 같은 모양이다', () => {
  assert.match(BUILT, /쪽 표시/)
  // 지시에 적힌 보기가 실제로 심는 모양과 달라지면 모델은 못 찾는다
  assert.ok(BUILT.includes(pageMarkLine(2)),
    `지시의 보기가 실제 표시(${pageMarkLine(2)})와 다르다`)
  assert.match(BUILT, /지어내지 말고 null/)
})

test('★ 묶음 이름을 그대로 받으라고 말한다', () => {
  assert.match(BUILT, /groupLabel/)
})

test('★ 「품목이 적힌 행만 항목이다」가 지시에서 사라졌다 — 남으면 두 지시가 싸운다', () => {
  assert.ok(!/품목이 적힌 행\*\*만 항목이다/.test(BUILT),
    '옛 규칙이 아직 지시에 있다. 구성 줄을 받으라는 규칙과 정면으로 부딪힌다')
})

/* ── 지시와 스키마가 같은 칸을 말한다 ──────────────── */

/*
  **왜 대조하나**: 지시가 `components` 를 달라고 했는데 스키마 칸 이름이 다르면
  모델은 시키는 대로 주고 우리는 그것을 통째로 버린다. 그런 어긋남은 오류도 안 낸다.
*/
test('★ 지시가 말하는 칸 이름이 스키마에 실제로 있다', () => {
  const lineKeys = Object.keys(QuoteFromDocLineSchema.shape)
  const quoteKeys = Object.keys(QuoteFromDocQuoteSchema.shape)
  for (const key of ['components', 'sourcePage', 'groupLabel', 'sourceText', 'amountMinor']) {
    assert.ok(lineKeys.includes(key), `줄 스키마에 ${key} 가 없다`)
    assert.ok(BUILT.includes(key), `지시가 ${key} 를 말하지 않는다`)
  }
  for (const key of ['pageStart', 'pageEnd', 'sourceTotalMinor']) {
    assert.ok(quoteKeys.includes(key), `건 스키마에 ${key} 가 없다`)
    assert.ok(BUILT.includes(key), `지시가 ${key} 를 말하지 않는다`)
  }
})

test('★ 보기 JSON 이 실제로 읽히는 모양이다 — 보기가 틀리면 모델이 그 틀린 모양을 따라 한다', () => {
  const start = BUILT.indexOf('{\n  "quotes"')
  const end = BUILT.indexOf('--- 원문 ---')
  assert.ok(start >= 0 && end > start, '보기 JSON 을 못 찾았다')
  const sample = BUILT.slice(start, end).trim()
  const json = JSON.parse(sample) as { quotes: unknown[] }
  const parsed = QuoteFromDocQuoteSchema.parse(json.quotes[0])
  assert.equal(parsed.lines.length, 2)
  assert.equal(parsed.lines[0].components.length, 3, '보기가 구성 줄을 안 보여 준다')
  assert.equal(parsed.lines[1].amountMinor, null, '보기가 금액 없는 항목을 안 보여 준다')
  assert.equal(parsed.pageStart, 2)
})

/* ── 안 바뀐 규칙 ───────────────────────────────── */

test('합계 행을 항목으로 넣지 말라는 규칙은 그대로다 — 넣으면 금액이 두 배가 된다', () => {
  assert.match(BUILT, /「소계」·「공급가액」·「부가세」·「합계」/)
  assert.match(BUILT, /항목이 아니다/)
})

test('값을 지어내지 말라는 규칙은 그대로다', () => {
  assert.match(BUILT, /지어내지 마라/)
  assert.match(BUILT, /0 을 넣지 마라/)
})
