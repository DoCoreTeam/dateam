/**
 * 판매가 얹기의 가드
 *
 * **왜 여기가 위험한가**: 이 계산이 틀리면 **틀린 값이 고객에게 나간다.**
 * 원가는 우리만 보지만 판매가는 견적서에 인쇄된다 — 되돌리는 방법이 「죄송합니다」뿐이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseMarginPercent, sellFromCost, applyPrice, describeMargin,
} from './quote-margin.ts'
import { scaleLinesToTarget } from './quote-target.ts'
import { computeTotals } from './quote-math.ts'

const MODAL = readFileSync(
  new URL('../../../components/ui/crm/QuoteFromFileModal.tsx', import.meta.url), 'utf-8')

/** 화면이 쓰는 줄 모양 그대로 — 이름·규격이 살아 남는지도 함께 본다 */
const line = (over: Record<string, unknown> = {}) => ({
  name: 'H100 SXM 8way',
  descriptionMd: '640GB HBM3',
  kind: 'QUANTITY',
  quantity: '2',
  unit: '대',
  unitPriceMinor: '100000000',
  discountPercent: '0',
  taxRate: '10',
  ...over,
})

const won = (v: bigint) => `${Number(v).toLocaleString('ko-KR')}원`

/* ── ① 안 넣으면 아무 일도 없다 ──────────────────── */

test('★ 마진율에 기본값이 없다 — 비워 두면 읽은 금액 그대로', () => {
  assert.equal(parseMarginPercent(''), null)
  assert.equal(parseMarginPercent('   '), null)
  assert.equal(parseMarginPercent(undefined), null)

  const lines = [line()]
  const r = applyPrice(lines, { kind: 'margin', percent: '' }, won)
  assert.equal(r.lines[0].unitPriceMinor, '100000000')
  assert.equal(r.note, null, '아무것도 안 바꿨는데 바꿨다고 말한다')
})

test('빈 칸과 0 은 다르다 — 0 은 「0% 마진」이라고 적은 것이다', () => {
  assert.equal(parseMarginPercent('0'), 0)
  assert.equal(sellFromCost(BigInt(100), 0), BigInt(100))
})

test('쓸 수 없는 값은 안 넣은 것으로 본다 — 음수 마진과 100% 는 계산이 성립하지 않는다', () => {
  for (const bad of ['-5', '100', '120', 'abc', '1e9']) {
    assert.equal(parseMarginPercent(bad), null, `${bad} 를 받아들였다`)
  }
  assert.equal(parseMarginPercent('20'), 20)
  assert.equal(parseMarginPercent(' 12.5 '), 12.5)
})

/* ── ② 마진율의 뜻은 한 가지다 ───────────────────── */

test('★ 마진 20% 는 100 을 125 로 만든다 — 판매가 대비 남는 비율이다', () => {
  assert.equal(sellFromCost(BigInt(100), 20), BigInt(125))
  assert.notEqual(sellFromCost(BigInt(100), 20), BigInt(120),
    '원가에 곱하면 실제 마진이 16.7% 가 되어 원가 화면과 다른 말을 한다')
  assert.equal(sellFromCost(BigInt(3), 50), BigInt(6))
})

test('나누어떨어지지 않으면 올린다 — 내리면 목표 마진에 못 미친다', () => {
  // 1 / 0.67 = 1.4925… → 2
  assert.equal(sellFromCost(BigInt(1), 33), BigInt(2))
  // 소수점 마진도 받는다: 1000 / 0.875 = 1142.85… → 1143
  assert.equal(sellFromCost(BigInt(1000), 12.5), BigInt(1143))
})

/* ── ③ 단가만 바뀐다 ─────────────────────────────── */

test('★ 수량·할인·세율·이름은 그대로다 — 판매가를 얹는 일이 다른 칸을 건드리지 않는다', () => {
  const before = line({ discountPercent: '10', taxRate: '10', quantity: '2' })
  const r = applyPrice([before], { kind: 'margin', percent: '20' }, won)
  const after = r.lines[0]
  assert.equal(after.unitPriceMinor, '125000000')
  for (const k of ['name', 'descriptionMd', 'kind', 'quantity', 'unit', 'discountPercent', 'taxRate'] as const) {
    assert.equal(after[k], before[k], `${k} 가 바뀌었다`)
  }
})

test('★ 무엇을 얼마로 올렸는지 말한다 — 말하지 않으면 조용히 바꾼 것이다', () => {
  const r = applyPrice([line()], { kind: 'margin', percent: '20' }, won)
  assert.ok(r.note, '바꿔 놓고 아무 말도 안 한다')
  assert.match(r.note ?? '', /200,000,000원/, '올리기 전 금액이 없다')
  assert.match(r.note ?? '', /250,000,000원/, '올린 뒤 금액이 없다')
  assert.match(r.note ?? '', /20%/, '얼마를 얹었는지 없다')
  assert.equal(
    describeMargin(20, BigInt(100), BigInt(125), won),
    '공급가 100원에 마진 20%를 얹어 125원으로 올렸어요. 단가는 확인하고 고치시면 됩니다.',
  )
})

test('통화 말은 부르는 쪽이 만든다 — 달러 견적서에 「원」이라고 적지 않게', () => {
  const usd = (v: bigint) => `$${v}`
  const r = applyPrice([line()], { kind: 'margin', percent: '20' }, usd)
  assert.match(r.note ?? '', /\$250000000/)
  assert.ok(!/원/.test((r.note ?? '').replace('공급가', '')), '통화 말을 안에서 정한다')
})

/* ── ④ 목표 총액은 있는 계산을 부른다 ────────────── */

test('★ 목표 총액을 두 곳에서 계산하지 않는다 — quote-target 이 낸 단가 그대로다', () => {
  const lines = [line(), line({ name: 'EDGE', unitPriceMinor: '50000000', quantity: '1' })]
  const plan = { kind: 'target' as const, total: 300000000, includesTax: false }
  const mine = applyPrice(lines, { kind: 'target', total: '300000000', includesTax: false }, won)
  const theirs = scaleLinesToTarget(lines, { totalMinor: plan.total, includesTax: false }, {})
  assert.deepEqual(
    mine.lines.map((l) => l.unitPriceMinor),
    theirs.lines.map((l) => String(l.unitPriceMinor)),
    '단가가 다르다 — 계산이 두 벌이라는 뜻이다',
  )
  const t = computeTotals(mine.lines, {})
  assert.equal((t.totalMinor - t.taxMinor).toString(), '300000000')
  assert.ok(mine.note, '맞춰 놓고 말하지 않는다')
})

test('★ 이름과 규격이 살아남는다 — 맞추기 함수는 줄의 이름을 모른다', () => {
  const r = applyPrice([line()], { kind: 'target', total: '300000000', includesTax: false }, won)
  assert.equal(r.lines[0].name, 'H100 SXM 8way')
  assert.equal(r.lines[0].descriptionMd, '640GB HBM3')
})

test('목표를 안 넣으면 그대로 간다 — 0원짜리 견적을 조용히 만들지 않는다', () => {
  const r = applyPrice([line()], { kind: 'target', total: '', includesTax: false }, won)
  assert.equal(r.lines[0].unitPriceMinor, '100000000')
  assert.equal(r.note, null)
})

test('고르지 않았으면 아무것도 안 한다', () => {
  const r = applyPrice([line()], { kind: 'keep' }, won)
  assert.equal(r.lines[0].unitPriceMinor, '100000000')
  assert.equal(r.note, null)
})

/* ── ⑤ 화면도 기본값을 두지 않는다 ───────────────── */

test('★ 가져오기 창의 마진 칸은 빈 채로 시작한다', () => {
  assert.match(MODAL, /marginPercent: ''/, '마진율에 기본값이 박혀 있다')
  assert.match(MODAL, /price: 'keep'/, '기본이 「원문 금액 그대로」가 아니다')
  assert.match(MODAL, /applyPrice\(/, '화면이 계산을 따로 한다')
  assert.ok(!/sellFromCost\(/.test(MODAL), '화면이 판매가를 직접 계산한다')
})
