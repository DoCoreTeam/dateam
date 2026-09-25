import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toFillRows, openOrderNosOf, seoulStampToIso, SINGLE_FILL_SEQ } from './fills-core.ts'
import type { Fill } from '../broker/account-request.ts'

function fill(over: Partial<Fill> = {}): Fill {
  return {
    orderNo: '0000117057', originalOrderNo: '', orderDate: '20260926', orderTime: '093015',
    contractCode: '101W12', direction: 'long', orderQty: 1, filledQty: 1,
    avgPrice: 340.25, rejectedQty: 0, feeKrw: 120, accountMasked: '5012****',
    ...over,
  }
}

test('체결 시각을 지어내지 않는다 — filledAt 은 언제나 null', () => {
  const [row] = toFillRows([fill()])
  assert.equal(row.filledAt, null)
  // 하한은 주문 시각이다. 이것이 체결 시각 자리에 들어가면 지연이 늘 0 이 된다
  assert.equal(row.orderAt, '2026-09-26T00:30:15.000Z')
})

test('채워진 수량이 0 이면 체결이 아니다', () => {
  assert.deepEqual(toFillRows([fill({ filledQty: 0 })]), [])
  assert.equal(toFillRows([fill({ filledQty: 1 })]).length, 1)
})

test('방향을 못 읽은 줄은 버린다 — 한쪽으로 찍으면 기록이 거짓이 된다', () => {
  assert.deepEqual(toFillRows([fill({ direction: null })]), [])
})

test('값이 없는 줄은 버린다 — 가격 없음·종목 없음', () => {
  assert.deepEqual(toFillRows([fill({ avgPrice: null })]), [])
  assert.deepEqual(toFillRows([fill({ contractCode: '' })]), [])
})

test('산 것은 buy, 판 것은 sell', () => {
  assert.equal(toFillRows([fill({ direction: 'long' })])[0].side, 'buy')
  assert.equal(toFillRows([fill({ direction: 'short' })])[0].side, 'sell')
})

test('순번은 한 값이다 — 1계약이라 부분 체결이 없다', () => {
  assert.equal(SINGLE_FILL_SEQ, '0')
  assert.equal(toFillRows([fill()])[0].fillSeq, SINGLE_FILL_SEQ)
})

test('수수료를 싣는다 — 체결 재현이 비용을 본다', () => {
  assert.equal(toFillRows([fill({ feeKrw: 120 })])[0].feeKrw, 120)
  assert.equal(toFillRows([fill({ feeKrw: null })])[0].feeKrw, null)
})

test('시각 꼴이 아니면 null — 없는 시각을 만들지 않는다', () => {
  assert.equal(seoulStampToIso('2026092', '093015'), null)
  assert.equal(seoulStampToIso('20260926', '9a3015'), null)
  assert.equal(seoulStampToIso('20260926', '253015'), null)
  assert.equal(seoulStampToIso('20260926', '096015'), null)
  assert.equal(toFillRows([fill({ orderDate: '' })])[0].orderAt, null)
})

test('초가 없는 주문시각도 읽는다', () => {
  assert.equal(seoulStampToIso('20260926', '0930'), '2026-09-26T00:30:00.000Z')
})

test('미체결 주문번호만 뽑는다 — 다 채워진 것은 미체결이 아니다', () => {
  const rows = [
    fill({ orderNo: 'A', orderQty: 1, filledQty: 1 }),
    fill({ orderNo: 'B', orderQty: 1, filledQty: 0 }),
    fill({ orderNo: 'C', orderQty: 1, filledQty: 0, rejectedQty: 1 }),
  ]
  assert.deepEqual(openOrderNosOf(rows), ['B'])
})
