import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCancelFallback, type CancelFallbackQuote } from './cancel-fallback.ts'

const q = (o: Partial<CancelFallbackQuote> & { id: string }): CancelFallbackQuote => ({
  price_type: 'cost', status: 'confirmed', unit_price_usd: 1, suppliers: { name: 'S' }, ...o,
})

test('확정 다견적 → auto + 최저 확정 공급사', () => {
  const quotes = [
    q({ id: 'sel', unit_price_usd: 3.5, suppliers: { name: 'NHN' } }),
    q({ id: 'a', unit_price_usd: 2.97, suppliers: { name: 'Equinix' } }),
    q({ id: 'b', unit_price_usd: 3.58, suppliers: { name: 'Voltage' } }),
  ]
  const r = resolveCancelFallback(quotes, 'sel', true)
  assert.equal(r.post, 'auto')
  assert.equal(r.autoSupplier, 'Equinix') // 최저 확정
})

test('API 정렬과 무관하게 단가 최저를 고른다(자체 정렬)', () => {
  const quotes = [
    q({ id: 'sel', unit_price_usd: 3.5 }),
    q({ id: 'hi', unit_price_usd: 9, suppliers: { name: 'Hi' } }),
    q({ id: 'lo', unit_price_usd: 1.2, suppliers: { name: 'Lo' } }),
  ]
  assert.equal(resolveCancelFallback(quotes, 'sel', false).autoSupplier, 'Lo')
})

test('확정 본인만·나머지 만료/반려 → auto 아님(거짓표시 방지). gcube 있으면 list', () => {
  const quotes = [
    q({ id: 'sel', status: 'confirmed', unit_price_usd: 3.5 }),
    q({ id: 'exp', status: 'expired', unit_price_usd: 1, suppliers: { name: '만료' } }),
    q({ id: 'rej', status: 'rejected', unit_price_usd: 1, suppliers: { name: '반려' } }),
  ]
  const r = resolveCancelFallback(quotes, 'sel', true)
  assert.equal(r.post, 'list')
  assert.equal(r.autoSupplier, null)
})

test('확정 본인만 + gcube 없음 → none(경고)', () => {
  const quotes = [q({ id: 'sel', unit_price_usd: 3.5 }), q({ id: 'exp', status: 'expired' })]
  assert.deepEqual(resolveCancelFallback(quotes, 'sel', false), { post: 'none', autoSupplier: null })
})

test('list(gcube) 견적은 자동 후보 아님', () => {
  const quotes = [
    q({ id: 'sel', unit_price_usd: 3.5 }),
    q({ id: 'gc', price_type: 'list', unit_price_usd: 0.5, suppliers: { name: 'gcube' } }),
  ]
  const r = resolveCancelFallback(quotes, 'sel', true)
  assert.equal(r.post, 'list') // list는 후보 제외 → 다른 확정 없음 → gcube 복귀
  assert.equal(r.autoSupplier, null)
})
