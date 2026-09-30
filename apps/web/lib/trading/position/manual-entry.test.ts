import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEntry, manualPnl, entryLine } from './manual-entry.ts'

/** 실측 MINI_KOSPI200 승수 */
const M = 50_000

test('밖에서 온 값을 서버가 다시 본다 — 화면이 막아도 창구는 열려 있다', () => {
  assert.equal(checkEntry({ direction: 'up', price: 1084, quantity: 1 }).ok, false)
  for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = checkEntry({ direction: 'long', price, quantity: 1 })
    assert.equal(r.ok, false, `가격 ${price}`)
  }
  for (const q of [0, -1, 1.5, Number.NaN]) {
    assert.equal(checkEntry({ direction: 'long', price: 1084, quantity: q }).ok, false, `수량 ${q}`)
  }
})

test('통과한 값은 화면이 그리는 자릿수로 맞춘다', () => {
  const r = checkEntry({ direction: 'short', price: 1084.2249, quantity: 2 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.value, { direction: 'short', price: 1084.22, quantity: 2 })
})

test('롱은 오르면 벌고 숏은 내리면 번다 — 부호를 안 뒤집으면 손실을 이익으로 그린다', () => {
  const long = manualPnl({ direction: 'long', entryPrice: 1084, nowPrice: 1085.5, quantity: 1, multiplier: M })
  assert.equal(long?.points, 1.5)
  assert.equal(long?.won, 75_000)
  assert.equal(long?.text, '+75,000원')

  const short = manualPnl({ direction: 'short', entryPrice: 1084, nowPrice: 1085.5, quantity: 1, multiplier: M })
  assert.equal(short?.points, -1.5)
  assert.equal(short?.won, -75_000)
  assert.equal(short?.text, '-75,000원')

  const shortWin = manualPnl({ direction: 'short', entryPrice: 1084, nowPrice: 1082.5, quantity: 1, multiplier: M })
  assert.equal(shortWin?.won, 75_000)
})

test('계약 수만큼 곱한다', () => {
  const two = manualPnl({ direction: 'long', entryPrice: 1084, nowPrice: 1085, quantity: 2, multiplier: M })
  assert.equal(two?.won, 100_000)
})

test('승수를 모르면 돈을 지어내지 않고 점으로 말한다', () => {
  for (const m of [null, 0, Number.NaN]) {
    const p = manualPnl({ direction: 'long', entryPrice: 1084, nowPrice: 1085, quantity: 1, multiplier: m })
    assert.equal(p?.won, null, `승수 ${String(m)}`)
    assert.equal(p?.text, '+1.00점')
  }
})

test('지금 가격을 모르면 손익을 안 만든다 — 0원으로 때우지 않는다', () => {
  assert.equal(manualPnl({ direction: 'long', entryPrice: 1084, nowPrice: null, quantity: 1, multiplier: M }), null)
})

test('들어간 줄은 사고 팔았다는 말로 쓴다', () => {
  assert.equal(entryLine('long', 1084.22, 1), '1,084.22 에 샀습니다')
  assert.equal(entryLine('short', 1084.22, 1), '1,084.22 에 팔았습니다')
  assert.equal(entryLine('short', 1084.22, 3), '1,084.22 에 3계약 팔았습니다')
})
