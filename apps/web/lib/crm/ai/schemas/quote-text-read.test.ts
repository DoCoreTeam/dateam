import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LINE_KIND_ORDER } from '../../../terms/cost.ts'
import { readText } from '../../domain/quote-text/read-rules.ts'
import { TEST_CATALOG } from '../../domain/quote-text/fixtures.ts'
import { QUOTE_TEXT_READ_V1 } from '../prompts/quote-text-read.v1.ts'
import { applyAiReadings, buildTextReadInput, parseTextRead, TextReadItemSchema } from './quote-text-read.ts'

const CAT = { ...TEST_CATALOG, items: [...TEST_CATALOG.items, { id: 'h100-server', name: 'H100 서버', aliases: [] }] }

test('AI 입력에는 못 읽은 조각과 이름만 — 가격 칸이 없다', () => {
  const r = readText('크레딧 1억\n에이치백 서버 두 대 넣어줘', CAT)
  const input = buildTextReadInput(r, CAT)
  assert.deepEqual(input.clauses.map((c) => c.text), ['에이치백 서버 두 대 넣어줘'])
  const json = JSON.stringify(input)
  assert.doesNotMatch(json, /price|cost|원가|정상가|Minor/i)
})

test('AI 출력에 금액 칸이 없다 — 금액을 주면 거절한다', () => {
  assert.throws(() => TextReadItemSchema.parse({ ref: '0.0', role: 'ITEM', unitPriceMinor: 1000 }))
  assert.doesNotMatch(QUOTE_TEXT_READ_V1.build('{}'), /unitPrice|단가를 넣/)
})

test('종류 목록이 DB 종류 한 벌과 같다', () => {
  const src = readFileSync(new URL('./quote-text-read.ts', import.meta.url), 'utf8')
  assert.match(src, /LINE_KIND_ORDER/)
  for (const k of LINE_KIND_ORDER) assert.equal(TextReadItemSchema.parse({ ref: '0.0', role: 'ITEM', kind: k }).kind, k)
  assert.throws(() => TextReadItemSchema.parse({ ref: '0.0', role: 'ITEM', kind: 'FIXED' }))
  assert.throws(() => TextReadItemSchema.parse({ ref: '0.0', role: 'ITEM', kind: 'DISCOUNT' }))
})

test('목록 밖 id 와 모르는 등급은 버린다', () => {
  const r = readText('에이치백 서버 두 대 넣어줘\n뭔가 개발 좀', CAT)
  const out = parseTextRead(JSON.stringify({ readings: [
    { ref: '0.0', role: 'ITEM', itemId: 'made-up', count: 2, alias: '에이치백' },
    { ref: '1.0', role: 'LABOR', grade: '왕급', manMonths: 2, name: '개발' },
  ] }))
  const a = applyAiReadings(r, out, CAT)
  assert.deepEqual(a.readings[0].itemIds, [])
  assert.deepEqual(a.aliases, [])
  assert.equal(a.readings[1].grade, null)
  assert.equal(a.readings[1].manMonths, 2)
})

test('맞는 품목이면 얹고 별칭 후보를 낸다', () => {
  const r = readText('에이치백 서버 두 대 넣어줘', CAT)
  const out = parseTextRead('```json\n{"readings":[{"ref":"0.0","role":"ITEM","itemId":"h100-server","count":2,"alias":"에이치백"}]}\n```')
  const a = applyAiReadings(r, out, CAT)
  assert.deepEqual(a.readings[0].itemIds, ['h100-server'])
  assert.deepEqual(a.readings[0].counts, [{ value: 2, unit: '개' }])
  assert.equal(a.readings[0].unread, false)
  assert.deepEqual(a.aliases, [{ itemId: 'h100-server', word: '에이치백' }])
  assert.deepEqual(a.byAi, ['0.0'])
})

test('규칙이 읽은 조각은 AI 가 덮지 않는다', () => {
  const r = readText('크레딧 1억', CAT)
  const out = parseTextRead(JSON.stringify({ readings: [{ ref: '0.0', role: 'ITEM', itemId: 'h100-server' }] }))
  assert.deepEqual(applyAiReadings(r, out, CAT).readings[0].itemIds, ['credit'])
})
