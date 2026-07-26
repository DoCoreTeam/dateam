import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countModelImpact } from './impact.ts'

// 체이너블 Supabase 목 — from(table).select().in()/.is()/.not() 후 count를 resolve.
//  테이블별 고정 count를 주입해 countModelImpact가 자식 참조를 정확히 합산하는지 검증.
function mockDb(counts: Record<string, number>) {
  const make = (table: string) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.select = chain
    builder.in = chain
    builder.is = chain
    builder.not = chain
    // await builder → { count }
    builder.then = (resolve: (v: { count: number }) => unknown) => resolve({ count: counts[table] ?? 0 })
    return builder
  }
  return { from: (table: string) => make(table) }
}

test('countModelImpact: product_id·gpu_product_id 참조를 테이블별로 합산한다', async () => {
  const db = mockDb({
    supply_quotes: 3,
    direct_prices: 1,
    availability_responses: 0,
    direct_pool_stock: 2,
    gcube_price_checks: 4,
    gpu_product_term_prices: 1,
    competitor_product_mapping: 5,
  })
  const r = await countModelImpact(db, ['11111111-1111-1111-1111-111111111111'])
  assert.equal(r.detail['supply_quotes'], 3)
  assert.equal(r.detail['pool_stock'], 2)
  assert.equal(r.detail['gcube_price_checks'], 4)
  assert.equal(r.detail['term_prices'], 1)
  assert.equal(r.detail['competitor_mapping'], 5)
  assert.equal(r.total, 3 + 1 + 0 + 2 + 4 + 1 + 5)
})

test('countModelImpact: 빈 id 배열은 total 0', async () => {
  const db = mockDb({ supply_quotes: 9 })
  const r = await countModelImpact(db, [])
  assert.equal(r.total, 0)
})
