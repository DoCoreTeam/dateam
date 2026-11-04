import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBoard,
  supplierSlotCount,
  strategicItemsFor,
  BOARD_FIXED_WIDTH_PX,
  BOARD_SLOT_MIN_PX,
  type BoardInput,
  type BoardMarketIn,
  type BoardQuoteIn,
} from './board.ts'

const FX = 1400

function product(id: string, gpu_count = 1, memory = '80GB', strategic: number | null = null) {
  return { id, model_name: 'H100', memory, gpu_count, strategic_price_krw: strategic }
}

function market(id: string, name: string, usd: number, observed = '2026-11-01', extra: Partial<BoardMarketIn> = {}): BoardMarketIn {
  return {
    id, product_id: 'p1', competitor_name: name, price_usd: usd,
    obs_currency: 'USD', obs_amount: usd, obs_gpu_count: 1, obs_pricing_unit: 'hour',
    observed_at: observed, recorded_at: observed, source_url: null, ...extra,
  }
}

function quote(id: string, name: string, usd: number, extra: Partial<BoardQuoteIn> = {}): BoardQuoteIn {
  return {
    id, product_id: 'p1', supplier_name: name, unit_price_usd: usd, per_gpu_usd: usd, gpu_count: 1,
    original_currency: 'USD', original_price: usd, original_unit: 'USD/GPU·hr', term: '1년 약정',
    received_at: '2026-07-01', created_at: '2026-07-01', price_type: 'cost', source_format: 'mail', ...extra,
  }
}

function input(over: Partial<BoardInput> = {}): BoardInput {
  return { products: [product('p1')], quotes: [], market: [], margin_pct: 20, usd_krw: FX, fx_date: '2026-11-03', ...over }
}

test('칸 수는 폭으로만 정해지고 공급사 20곳이어도 열 정의는 같다', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => market(`m${i}`, `vendor${i}`, 1 + i / 10))
  const board = buildBoard(input({ market: twenty }))
  assert.equal(board.rows[0].vendors.length, 20)
  assert.equal(board.rows[0].offers.length, 20)
  const width = BOARD_FIXED_WIDTH_PX + BOARD_SLOT_MIN_PX * 3
  assert.equal(supplierSlotCount(width), 3)
  assert.equal(supplierSlotCount(width), supplierSlotCount(width)) // 공급사 수를 받지 않는다
  assert.equal(supplierSlotCount(320), 1) // 좁아도 1칸은 남는다
  assert.equal(supplierSlotCount(BOARD_FIXED_WIDTH_PX + BOARD_SLOT_MIN_PX * 9), 9) // 상한 없음
})

test('싼 순, 같으면 최근 것 먼저', () => {
  const board = buildBoard(input({
    market: [market('a', 'A', 2, '2026-10-01'), market('b', 'B', 1, '2026-09-01'), market('c', 'C', 1, '2026-10-20')],
  }))
  assert.deepEqual(board.rows[0].vendors.map((v) => v.vendor), ['C', 'B', 'A'])
  assert.equal(board.rows[0].cheapest_krw, 1400)
  assert.equal(board.rows[0].latest_date, '2026-10-20')
})

test('같은 공급사에 견적과 시세가 있으면 견적이 남는다 (이름 띄어쓰기 무시)', () => {
  const board = buildBoard(input({
    quotes: [quote('q', 'Konsttech', 3)],
    market: [market('m', 'konst tech', 1)],
  }))
  assert.equal(board.rows[0].offers.length, 1)
  assert.equal(board.rows[0].offers[0].kind, 'quote')
  assert.equal(board.rows[0].offers[0].term_label, '약정 1년')
})

test('원화 시간당은 원래 원화를 장수로 나누고 그 밖은 1장 USD × 최신 환율', () => {
  const board = buildBoard(input({
    market: [
      market('k', 'KR', 1.77, '2026-11-01', { obs_currency: 'KRW', obs_amount: 5000, obs_gpu_count: 2 }),
      market('u', 'US', 3),
    ],
  }))
  const byVendor = Object.fromEntries(board.rows[0].offers.map((o) => [o.vendor, o.krw]))
  assert.equal(byVendor.KR, 2500)
  assert.equal(byVendor.US, 4200)
})

test('단위 모름은 순위 밖이고 상세 맨 아래', () => {
  const board = buildBoard(input({
    market: [market('x', 'X', 0.1, '2026-11-02', { obs_pricing_unit: null }), market('y', 'Y', 2)],
  }))
  const row = board.rows[0]
  assert.deepEqual(row.vendors.map((v) => v.vendor), ['Y'])
  assert.equal(row.offers.at(-1)?.vendor, 'X')
  assert.equal(row.offers.at(-1)?.krw, null)
})

test('공시가(list)와 시세를 베낀 견적(market_link)은 공급사 값이 아니다', () => {
  const board = buildBoard(input({
    quotes: [quote('l', 'gcube', 0.1, { price_type: 'list' }), quote('ml', 'Z', 0.2, { source_format: 'market_link' })],
  }))
  assert.equal(board.rows[0].offers.length, 0)
  assert.equal(board.rows[0].fair_krw, null)
})

test('gcube 견적은 cost 로 들어와도 원가가 아니다 (우리 판매가)', () => {
  const board = buildBoard(input({
    quotes: [
      quote('g', 'gcube', 17.1, { original_currency: 'KRW', original_price: 23940, original_unit: 'KRW/hr', price_type: 'cost', source_format: 'own' }),
      quote('g2', 'GCube ', 0.3, { price_type: 'cost' }),
      quote('s', 'S', 1),
    ],
  }))
  assert.deepEqual(board.rows[0].offers.map((o) => o.id), ['s'])
  assert.equal(board.rows[0].cheapest_krw, 1400)
})

test('원화 시간당 시세 10,500 은 다시 환산하지 않는다', () => {
  const board = buildBoard(input({
    market: [market('e', 'Elice Cloud', 7.421, '2026-11-01', { obs_currency: 'KRW', obs_amount: 10500, obs_pricing_unit: 'hour' })],
  }))
  assert.equal(board.rows[0].offers[0].krw, 10500)
})

test('적정판매가는 언제나 최저 원가 × (1+마진), 목표 판매가는 구성 총액 ÷ 장수로 따로 선다', () => {
  const plain = buildBoard(input({ market: [market('a', 'A', 1)] }))
  assert.equal(plain.rows[0].fair_krw, 1680)
  assert.equal(plain.rows[0].target_krw, null)

  const withStrategic = buildBoard(input({
    products: [product('p1', 1, '80GB'), product('p4', 4, '320GB', 8000)],
    market: [market('a', 'A', 1)],
  }))
  assert.equal(withStrategic.rows.length, 1) // 장당 80GB 로 한 줄
  assert.equal(withStrategic.rows[0].target_krw, 2000)
  assert.equal(withStrategic.rows[0].fair_krw, 1680) // 목표가 있어도 적정판매가는 그대로
})

test('장당 메모리가 다르면 다른 줄', () => {
  const board = buildBoard(input({ products: [product('p1', 1, '80GB'), product('p2', 1, '94GB')] }))
  assert.equal(board.rows.length, 2)
})

test('목표 판매가 1장 값을 상품마다 장수만큼 편다', () => {
  const items = strategicItemsFor({ products: [{ id: 'a', gpu_count: 1, strategic_price_krw: null, gcube: null }, { id: 'b', gpu_count: 8, strategic_price_krw: null, gcube: null }] }, 1500)
  assert.deepEqual(items, [{ product_id: 'a', strategic_price_krw: 1500 }, { product_id: 'b', strategic_price_krw: 12000 }])
})

test('판매가는 이어진 gcube 최대 금액 ÷ 장수, 장수가 적은 상품 것', () => {
  const board = buildBoard(input({
    products: [product('p1', 1, '80GB'), product('p8', 8, '640GB')],
    market: [market('a', 'A', 5)],
    gcube: [{ ser: 2, product_id: 'p8', max_krw: '73600.00', price_changed_at: '2026-11-04' }, { ser: 1, product_id: 'p1', max_krw: 9200, price_changed_at: '2026-11-04' }],
  }))
  const r = board.rows[0]
  assert.deepEqual([r.sale_krw, r.sale_ser], [9200, 1])
  assert.equal(r.fair_krw, 8400) // 5 × 1400 × 1.2
  assert.equal(r.gap_krw, 800)
  assert.equal(r.reflected, null) // 목표가 없으면 반영 표시 없음
})

test('gcube 미연결이면 판매가와 차이가 없다', () => {
  const r = buildBoard(input({ market: [market('a', 'A', 1)] })).rows[0]
  assert.deepEqual([r.sale_krw, r.gap_krw, r.reflected], [null, null, null])
})

test('반영은 같은 상품의 목표 판매가 총액과 gcube 최대 금액이 같을 때', () => {
  const gcube = [{ ser: 1, product_id: 'p1', max_krw: 9200, price_changed_at: null }]
  const same = buildBoard(input({ products: [product('p1', 1, '80GB', 9200)], gcube })).rows[0]
  assert.equal(same.reflected, true)
  const diff = buildBoard(input({ products: [product('p1', 1, '80GB', 9000)], gcube })).rows[0]
  assert.equal(diff.reflected, false)
  assert.equal(diff.target_krw, 9000)
  // 목표는 있는데 그 상품이 gcube 에 안 이어졌으면 비교할 것이 없다
  const other = buildBoard(input({ products: [product('p1', 1, '80GB'), product('p8', 8, '640GB', 70000)], gcube })).rows[0]
  assert.equal(other.reflected, null)
})
