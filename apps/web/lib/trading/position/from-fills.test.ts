import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldFills, expectedFrom, type FillLike } from './from-fills.ts'
import { dayPnl, pnlForLimits } from './pnl.ts'

/** KOSPI200 선물: 1포인트 25만원 */
const K200 = { multiplier: 250_000, tickSize: 0.05 }

function f(over: Partial<FillLike> & Pick<FillLike, 'side' | 'price' | 'at'>): FillLike {
  return { quantity: 1, feeKrw: 100, signalId: null, ...over }
}

test('산 것만 있으면 들고 있는 것이 되고 닫힌 것은 없다', () => {
  const r = foldFills([f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z' })], K200)
  assert.equal(r.open?.direction, 'long')
  assert.equal(r.open?.quantity, 1)
  assert.equal(r.open?.avgPrice, 340)
  assert.deepEqual(r.closed, [])
})

test('사고 판 것이 같으면 flat 이고 왕복이 하나 남는다', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z' }),
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z' }),
  ], K200)
  assert.equal(r.open, null)
  assert.equal(r.closed.length, 1)
  assert.equal(r.closed[0].direction, 'long')
  assert.equal(r.closed[0].entryPrice, 340)
  assert.equal(r.closed[0].exitPrice, 342)
})

test('수수료는 왕복이다 — 한쪽만 세면 손익이 그만큼 좋게 나온다', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z', feeKrw: 100 }),
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z', feeKrw: 130 }),
  ], K200)
  assert.equal(r.closed[0].feeKrw, 230)
})

test('실현 손익이 실제 숫자로 나온다 — 이것이 언제나 0원이던 값이다', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z', feeKrw: 100 }),
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z', feeKrw: 130 }),
  ], K200)
  // 2포인트 × 25만원 − 수수료 230원
  assert.equal(pnlForLimits(dayPnl(r.closed, null)), 2 * 250_000 - 230)
})

test('판 것부터면 short 다', () => {
  const r = foldFills([
    f({ side: 'sell', price: 342, at: '2026-09-26T00:30:00Z' }),
    f({ side: 'buy', price: 340, at: '2026-09-26T00:45:00Z' }),
  ], K200)
  assert.equal(r.closed[0].direction, 'short')
  // 내려서 번 것이다
  assert.ok(pnlForLimits(dayPnl(r.closed, null)) > 0)
})

test('역순으로 와도 시각으로 다시 세운다 — 조회가 DS(역순)로 온다', () => {
  const asc = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z' }),
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z' }),
  ], K200)
  const desc = foldFills([
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z' }),
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z' }),
  ], K200)
  assert.deepEqual(desc, asc)
})

test('먼저 연 것부터 닫는다 — 선입선출', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z' }),
    f({ side: 'buy', price: 344, at: '2026-09-26T00:35:00Z' }),
    f({ side: 'sell', price: 346, at: '2026-09-26T00:45:00Z' }),
  ], K200)
  assert.equal(r.closed.length, 1)
  assert.equal(r.closed[0].entryPrice, 340)
  assert.equal(r.open?.quantity, 1)
  assert.equal(r.open?.avgPrice, 344)
})

test('뒤집기는 닫고 새로 연다 — 수량을 안 세면 2계약 때 조용히 틀린다', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z' }),
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z', quantity: 2 }),
  ], K200)
  assert.equal(r.closed.length, 1)
  assert.equal(r.closed[0].direction, 'long')
  assert.equal(r.open?.direction, 'short')
  assert.equal(r.open?.quantity, 1)
})

test('여러 장은 한 장씩 짝짓는다 — 평균으로 뭉개지 않는다', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z', quantity: 2, feeKrw: 200 }),
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z', quantity: 2, feeKrw: 200 }),
  ], K200)
  assert.equal(r.closed.length, 2)
  // 한 장당 수수료는 100 + 100
  assert.deepEqual(r.closed.map((t) => t.feeKrw), [200, 200])
  assert.equal(dayPnl(r.closed, null).tradeCount, 2)
})

test('수수료를 안 주면 0 으로 본다 — 없는 비용을 지어내지 않는다', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z', feeKrw: null }),
    f({ side: 'sell', price: 342, at: '2026-09-26T00:45:00Z', feeKrw: null }),
  ], K200)
  assert.equal(r.closed[0].feeKrw, 0)
})

test('값이 이상한 줄은 건너뛴다', () => {
  const r = foldFills([
    f({ side: 'buy', price: Number.NaN, at: '2026-09-26T00:30:00Z' }),
    f({ side: 'buy', price: 340, at: '2026-09-26T00:31:00Z', quantity: 0 }),
  ], K200)
  assert.equal(r.open, null)
  assert.deepEqual(r.closed, [])
})

test('포지션의 신호는 먼저 연 것의 것이다', () => {
  const r = foldFills([
    f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z', signalId: 'sig-1' }),
    f({ side: 'buy', price: 344, at: '2026-09-26T00:35:00Z', signalId: 'sig-2' }),
  ], K200)
  assert.equal(r.open?.signalId, 'sig-1')
  assert.equal(r.open?.openedAt, '2026-09-26T00:35:00Z')
})

test('대조에 넘길 꼴 — 비어 있으면 계좌에만 있다고 늘 어긋난다', () => {
  assert.deepEqual(expectedFrom('101W12', null), [])
  const r = foldFills([f({ side: 'buy', price: 340, at: '2026-09-26T00:30:00Z' })], K200)
  assert.deepEqual(expectedFrom('101W12', r.open), [
    { contractCode: '101W12', direction: 'long', quantity: 1 },
  ])
})
