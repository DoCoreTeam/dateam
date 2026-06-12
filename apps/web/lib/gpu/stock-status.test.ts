import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stockCode } from './stock-status.ts'

test('수량 0 이하 → out', () => {
  assert.equal(stockCode(0, 0), 'out')
  assert.equal(stockCode(-5, 0), 'out')
})

test('수량 있고 결품 공급사 있으면 partial', () => {
  assert.equal(stockCode(10, 2), 'partial')
})

test('수량 있고 결품 없으면 full', () => {
  assert.equal(stockCode(10, 0), 'full')
})
