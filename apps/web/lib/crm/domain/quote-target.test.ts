// lib/crm/domain/quote-target.test.ts — 「총액 3억에 맞춰 줘」 가드
//
// 사용자 지적(2026-09-08): *"부가세포함으로 해서 총액 3억 수준에 맞춰서 만들어줘"* 를
// 화면이 못 알아봤다. *"우리 AI 탑재 시스템이고 정량적인 항목을 채우는건데 이해를 못한다?"*
//
// 이 계산은 **고객에게 나가는 숫자**를 만든다. 틀리면 되돌릴 방법이 「죄송합니다」뿐이라
// AI 에게 맡기지 않고 여기서 낸다 — 그러니 여기가 맞아야 한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleLinesToTarget, describeScale } from './quote-target.ts'
import { computeTotals, type QuoteLineInput } from './quote-math.ts'

const NO_ROUND = { unit: 0 as const, mode: 'DOWN' as const }

/** 실측 앵커: 숙명여대 견적의 실제 두 줄(2026-09-08 · 운영 DB) */
const REAL: QuoteLineInput[] = [
  { kind: 'QUANTITY', quantity: '1', unitPriceMinor: '280000000', discountPercent: '0', taxRate: '10' },
  { kind: 'QUANTITY', quantity: '1', unitPriceMinor: '100000000', discountPercent: '30', taxRate: '10' },
]

const total = (ls: QuoteLineInput[]) => computeTotals(ls, NO_ROUND).totalMinor
const supply = (ls: QuoteLineInput[]) => {
  const t = computeTotals(ls, NO_ROUND)
  return t.totalMinor - t.taxMinor
}

/* ── 맞추기 ──────────────────────────────────────────── */

test('★ 부가세 포함 3억에 맞춘다 — 사용자가 실제로 적은 그 지시', () => {
  const r = scaleLinesToTarget(REAL, { totalMinor: 300_000_000, includesTax: true }, NO_ROUND)
  assert.equal(r.reason, null)
  assert.equal(total(r.lines), BigInt(300_000_000), '부가세 포함 총액이 목표와 달라졌다')
  assert.equal(r.gapMinor, BigInt(0))
})

test('★ 「부가세 포함」과 「공급가」는 다른 목표다 — 이 한 칸이 3천만 원을 가른다', () => {
  const inc = scaleLinesToTarget(REAL, { totalMinor: 300_000_000, includesTax: true }, NO_ROUND)
  const exc = scaleLinesToTarget(REAL, { totalMinor: 300_000_000, includesTax: false }, NO_ROUND)
  assert.equal(total(inc.lines), BigInt(300_000_000))
  assert.equal(supply(exc.lines), BigInt(300_000_000))
  // 공급가 3억이면 부가세까지 3.3억이라 «포함 3억»보다 총액이 크다
  assert.ok(total(exc.lines) > total(inc.lines), '두 해석이 같은 결과를 내면 물어본 의미가 없다')
})

test('★ 줄 사이 비율을 유지한다 — 한 줄만 깎으면 그건 다른 견적이다', () => {
  const before = REAL.map((l) => Number(l.unitPriceMinor))
  const r = scaleLinesToTarget(REAL, { totalMinor: 300_000_000, includesTax: true }, NO_ROUND)
  const after = r.lines.map((l) => Number(l.unitPriceMinor))
  const r0 = after[0] / before[0]
  const r1 = after[1] / before[1]
  // 잔차 흡수로 마지막 줄이 미세하게 다를 수 있다 — 1% 안이면 비율 유지로 본다
  assert.ok(Math.abs(r0 - r1) / r0 < 0.01, `비율이 갈렸다: ${r0} vs ${r1}`)
})

test('할인·세율은 건드리지 않는다 — 사람이 정한 것이다', () => {
  const r = scaleLinesToTarget(REAL, { totalMinor: 300_000_000, includesTax: true }, NO_ROUND)
  assert.equal(r.lines[1].discountPercent, '30')
  assert.equal(r.lines[0].taxRate, '10')
  assert.equal(r.lines[0].quantity, '1')
})

test('올리는 것도 된다 — 「맞춰 달라」가 늘 깎으라는 뜻은 아니다', () => {
  const r = scaleLinesToTarget(REAL, { totalMinor: 500_000_000, includesTax: true }, NO_ROUND)
  assert.equal(total(r.lines), BigInt(500_000_000))
})

/* ── 못 맞추는 경우 — 조용히 0원짜리를 만들지 않는다 ── */

test('★ 목표가 없으면 원래 줄 그대로 — 없는 지시로 단가를 바꾸지 않는다', () => {
  const r = scaleLinesToTarget(REAL, { totalMinor: null, includesTax: true }, NO_ROUND)
  assert.equal(r.reason, 'NO_TARGET')
  assert.deepEqual(r.lines, REAL)
})

test('★ 지금 총액이 0이면 맞출 수 없다 — 0에 아무 배율을 곱해도 0이다', () => {
  const zero: QuoteLineInput[] = [
    { kind: 'QUANTITY', quantity: '1', unitPriceMinor: '0', discountPercent: '0', taxRate: '10' },
  ]
  const r = scaleLinesToTarget(zero, { totalMinor: 300_000_000, includesTax: true }, NO_ROUND)
  assert.equal(r.reason, 'ZERO_BASE', '0원 줄에 배율을 걸어 «맞췄다»고 말하면 거짓이다')
  assert.deepEqual(r.lines, zero)
})

test('항목이 하나도 없으면 맞출 것이 없다', () => {
  const r = scaleLinesToTarget([], { totalMinor: 300_000_000, includesTax: true }, NO_ROUND)
  assert.equal(r.reason, 'EMPTY')
})

test('음수·0 목표는 목표가 아니다 — 마이너스 단가를 만들지 않는다', () => {
  for (const t of [0, -1, -300_000_000]) {
    const r = scaleLinesToTarget(REAL, { totalMinor: t, includesTax: true }, NO_ROUND)
    assert.equal(r.reason, 'NO_TARGET', `${t} 을 목표로 받았다`)
  }
})

test('단가가 음수로 내려가지 않는다 — 잔차를 얹다 뒤집히면 안 된다', () => {
  const r = scaleLinesToTarget(REAL, { totalMinor: 1, includesTax: true }, NO_ROUND)
  for (const l of r.lines) {
    assert.ok(Number(l.unitPriceMinor) >= 0, `단가가 음수다: ${l.unitPriceMinor}`)
  }
})

/* ── 사람에게 말한다 — 조용히 바꾸지 않는다 ─────────── */

test('★ 무엇을 얼마로 맞췄는지 말한다 — 숫자가 말없이 바뀌면 사람이 못 믿는다', () => {
  const r = scaleLinesToTarget(REAL, { totalMinor: 300_000_000, includesTax: true }, NO_ROUND)
  const msg = describeScale({ totalMinor: 300_000_000, includesTax: true }, r)
  assert.ok(msg && msg.includes('부가세 포함'), '어느 기준으로 맞췄는지 안 밝힌다')
  assert.ok(msg.includes('300,000,000'), '맞춘 금액을 안 밝힌다')
})

test('★ 딱 안 맞으면 이유까지 말한다 — 절사 때문인 걸 모르면 고장으로 읽힌다', () => {
  // 실측(v0.7.695): 십만원 절사가 걸린 견적에서 3억을 목표로 하니 3만원이 남았다.
  // 총액이 십만원의 계단으로만 움직이므로 정상인데, 이유를 안 밝히면 사용자는 오작동으로 본다.
  const ROUND = { unit: 100000 as const, mode: 'DOWN' as const }
  const intent = { totalMinor: 300_000_000, includesTax: true }
  const r = scaleLinesToTarget(REAL, intent, ROUND)
  const msg = describeScale(intent, r, 100000)
  assert.ok(msg, '맞춘 뒤에는 무엇을 했는지 말해야 한다')
  if (r.gapMinor !== BigInt(0)) {
    assert.ok(msg.includes('절사'), `차이가 났는데 이유를 안 밝힌다: ${msg}`)
    assert.ok(msg.includes('십만원'), '어느 단위 때문인지 안 밝힌다')
  }
})

test('절사가 없으면 이유를 덧붙이지 않는다 — 없는 원인을 말하지 않는다', () => {
  const intent = { totalMinor: 300_000_000, includesTax: true }
  const r = scaleLinesToTarget(REAL, intent, NO_ROUND)
  const msg = describeScale(intent, r, 0)
  assert.ok(msg && !msg.includes('절사'), '절사가 없는데 절사 탓을 한다')
})

test('못 맞췄으면 아무 말도 하지 않는다 — 안 한 일을 했다고 하지 않는다', () => {
  const r = scaleLinesToTarget(REAL, { totalMinor: null, includesTax: true }, NO_ROUND)
  assert.equal(describeScale({ totalMinor: null, includesTax: true }, r), null)
})
