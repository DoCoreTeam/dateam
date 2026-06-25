import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
// core import — next/cache 결합 없는 순수 계약/라우팅. recordAvailability는 fake 주입(모듈모킹 불필요).
import { INTAKE_FIELD_MAP, unmappedFields, routeAvailability, type RecordAvailabilityFn } from './intake-routing-core.ts'

// 축4 계약게이트: 통합입력 추출 필드는 전부 저장 대상이 선언돼야 한다(없으면 = 증발 위험).
// 이 테스트가 "추출하는데 저장 안 되는" 사고(재고 증발 같은)를 코드리뷰 전에 차단한다.
const EXTRACT_FIELDS = [
  'model_name', 'memory', 'unit_price_usd', 'original_price', 'original_currency',
  'original_unit', 'term', 'term_months', 'min_qty', 'valid_until', 'gpu_count',
  'supplier', 'tier_suggestion', 'tier_reason', 'quantity', 'has_quantity_info',
]

describe('축4 계약게이트 — 추출 필드 ↔ 저장 대상', () => {
  test('모든 추출 필드가 INTAKE_FIELD_MAP에 저장대상을 가진다(증발 0)', () => {
    assert.deepEqual(unmappedFields(EXTRACT_FIELDS), [])
  })
  test('재고(quantity)는 availability_responses로 라우팅된다(증발 버그 회귀 가드)', () => {
    assert.equal(INTAKE_FIELD_MAP.quantity, 'availability_responses')
  })
  test('매핑 없는 신규 필드는 게이트가 잡아낸다(차단 증명)', () => {
    const drift = unmappedFields([...EXTRACT_FIELDS, 'new_unmapped_field'])
    assert.ok(drift.includes('new_unmapped_field'))
    assert.equal(drift.length, 1)
  })
})

describe('축2/3 재고 자동반영 라우팅 (recordAvailability fake 주입)', () => {
  const ctx = { db: {}, adminDb: {}, productId: 'p1', supplierId: 's1', actor: 'tester', isTest: true }
  // 호출 캡처용 fake
  function makeFake() {
    const calls: Array<Parameters<RecordAvailabilityFn>> = []
    const fn: RecordAvailabilityFn = async (...args) => { calls.push(args); return { ok: true } }
    return { fn, calls }
  }

  test('quantity.resp_qty 있으면 recordAvailability(재고 SSOT)로 반영', async () => {
    const { fn, calls } = makeFake()
    const r = await routeAvailability(ctx, { resp_qty: 8, is_total_capacity: false }, fn)
    assert.equal(r.status, 'written')
    assert.equal(calls.length, 1)
    assert.equal(calls[0][2].productId, 'p1')
    assert.equal(calls[0][2].respQty, 8)
    assert.equal(calls[0][2].status, 'available_partial')
  })

  test('is_total_capacity=true면 available_full', async () => {
    const { fn, calls } = makeFake()
    await routeAvailability(ctx, { resp_qty: 100, is_total_capacity: true }, fn)
    assert.equal(calls[0][2].status, 'available_full')
  })

  test('out_of_stock_explicit는 status=out_of_stock로 반영', async () => {
    const { fn, calls } = makeFake()
    const r = await routeAvailability(ctx, { out_of_stock_explicit: true }, fn)
    assert.equal(r.status, 'written')
    assert.equal(calls[0][2].status, 'out_of_stock')
  })

  test('재고 신호 없으면 skip(부분커밋 — 가격은 살림)', async () => {
    const { fn, calls } = makeFake()
    const r = await routeAvailability(ctx, {}, fn)
    assert.equal(r.status, 'skipped')
    assert.equal(calls.length, 0)
  })

  test('quantity 자체가 없으면 skip', async () => {
    const { fn } = makeFake()
    const r = await routeAvailability(ctx, undefined, fn)
    assert.equal(r.status, 'skipped')
  })
})
