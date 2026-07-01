import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchProductId, strategicKrwFromUsd, STRATEGIC_PRICE_MAX, saveOwnTargetAsStrategicPrice } from './own-target-import.ts'

const cands = [
  { id: 'a', model_name: 'A100 80GB' },
  { id: 'b', model_name: 'H100 80GB' },
  { id: 'c', model_name: 'RTX A6000' },
  { id: 'd', model_name: 'RTX 6000 Ada' },
]

test('matchProductId: 정규화 완전일치', () => {
  assert.equal(matchProductId(cands, 'a100 80gb'), 'a')
  assert.equal(matchProductId(cands, 'H100  80GB'), 'b')
})

test('matchProductId: generic 토큰 단독 오매칭 금지(RTX 6000 Ada ≠ RTX A6000)', () => {
  assert.equal(matchProductId(cands, 'RTX 6000 Ada'), 'd')
  assert.equal(matchProductId(cands, 'RTX A6000'), 'c')
})

test('matchProductId: 매칭 없으면 null', () => {
  assert.equal(matchProductId(cands, 'B200 192GB'), null)
})

test('strategicKrwFromUsd: USD/GPU/hr → KRW 반올림', () => {
  assert.equal(strategicKrwFromUsd(0.8102, 1523.4), Math.round(0.8102 * 1523.4))
  assert.equal(strategicKrwFromUsd(1.0416, 1523.4), 1587) // A100 ≈ 1587 KRW/hr
})

test('strategicKrwFromUsd: 비정상 입력/상한초과 → null(차단)', () => {
  assert.equal(strategicKrwFromUsd(0, 1500), null)
  assert.equal(strategicKrwFromUsd(-1, 1500), null)
  assert.equal(strategicKrwFromUsd(1, 0), null)
  assert.equal(strategicKrwFromUsd(STRATEGIC_PRICE_MAX, 1000), null) // 초과
})

// saveOwnTargetAsStrategicPrice — 약정별 저장 + on_demand 미러 (fake db)
function makeDb(prodCands: Array<{ id: string; model_name: string }>, before: Record<string, unknown> | null) {
  const captured = { termUpserts: [] as Array<{ payload: Record<string, unknown>; opts: unknown }>, productUpdates: [] as Record<string, unknown>[] }
  const db = {
    from(table: string) {
      if (table === 'gpu_products') {
        return {
          select(cols: string) {
            if (cols.includes('model_name')) {
              const chain: Record<string, unknown> = { is: () => chain, eq: () => chain, limit: () => Promise.resolve({ data: prodCands }) }
              return chain
            }
            const chain: Record<string, unknown> = { eq: () => chain, single: () => Promise.resolve({ data: before }) }
            return chain
          },
          update(payload: Record<string, unknown>) {
            captured.productUpdates.push(payload)
            const chain: Record<string, unknown> = { eq: () => chain, is: () => Promise.resolve({ error: null }) }
            return chain
          },
        }
      }
      if (table === 'gpu_product_term_prices') {
        return { upsert: (payload: Record<string, unknown>, opts: unknown) => { captured.termUpserts.push({ payload, opts }); return Promise.resolve({ error: null }) } }
      }
      throw new Error('unexpected table ' + table)
    },
  }
  return { db, captured }
}

const noAudit = async () => {}
const noReval = () => {}

test('saveOwnTargetAsStrategicPrice: reserved → term_prices 저장, strategic_price_krw 미변경', async () => {
  const { db, captured } = makeDb([{ id: 'p1', model_name: 'A100' }], null)
  const r = await saveOwnTargetAsStrategicPrice(
    db as never, { model_name: 'A100', term: 'reserved_6m', unit_price_usd: 2 }, 'tester', 1500, noAudit, noReval,
  )
  assert.equal(r.ok, true)
  assert.equal(r.product_id, 'p1')
  assert.equal(r.term, 'reserved_6m')
  assert.equal(r.price_krw, 3000)
  assert.equal(r.strategic_price_krw, undefined)     // 미러 안 함
  assert.equal(captured.termUpserts.length, 1)
  assert.equal(captured.termUpserts[0].payload.term, 'reserved_6m')
  assert.equal(captured.termUpserts[0].payload.price_krw, 3000)
  assert.equal(captured.productUpdates.length, 0)    // gpu_products 미변경
})

test('saveOwnTargetAsStrategicPrice: on_demand → term_prices 저장 + strategic_price_krw 미러', async () => {
  const { db, captured } = makeDb([{ id: 'p1', model_name: 'A100' }], { strategic_price_krw: null, strategic_override_reason: null })
  const r = await saveOwnTargetAsStrategicPrice(
    db as never, { model_name: 'A100', term: 'on_demand', unit_price_usd: 2 }, 'tester', 1500, noAudit, noReval,
  )
  assert.equal(r.ok, true)
  assert.equal(r.term, 'on_demand')
  assert.equal(r.strategic_price_krw, 3000)          // 미러됨
  assert.equal(captured.termUpserts.length, 1)
  assert.equal(captured.termUpserts[0].payload.term, 'on_demand')
  assert.equal(captured.productUpdates.length, 1)
  assert.equal(captured.productUpdates[0].strategic_price_krw, 3000)
})

test('saveOwnTargetAsStrategicPrice: 매칭 제품 없으면 미반영(보류)', async () => {
  const { db, captured } = makeDb([{ id: 'p1', model_name: 'H100' }], null)
  const r = await saveOwnTargetAsStrategicPrice(
    db as never, { model_name: 'A100', term: 'reserved_6m', unit_price_usd: 2 }, 'tester', 1500, noAudit, noReval,
  )
  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /매칭 제품 없음/)
  assert.equal(captured.termUpserts.length, 0)
})
