import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandLadderWith, expandStandardLadder, memGb } from './config-ladder-expand.ts'
import type { UnifiedRow } from './unified-row.ts'

function row(over: Partial<UnifiedRow>): UnifiedRow {
  return {
    id: 'p1', model_name: 'H100', memory: '80GB', tier: 1,
    gpu_count: 1, series: null, vcpu: 12, ram_gb: 16, storage_gb: 512,
    supply_cost_krw: 1000, auto_price_krw: 1200, sell_price_krw: 1200, margin_pct: 20,
    strategic_price_krw: 1300, is_strategic_set: true,
    reflected_at: null, reflected_by: null, reflected_price_krw: null,
    cost_source: 'quote', basis: 'auto', is_propagated: false,
    cost_supplier_name: null, cost_supplier_logo_url: null, cost_supplier_color: null,
    propagation_source_quote_id: null, propagation_source_term: null, cost_unit_usd: null,
    list_price_krw: null, market_min_krw: 900, market_median_krw: 950, market_max_krw: 1100,
    market_dev_pct: 5, sample_count: 3, market_mapping_id: null, competitors: [], market_mapping_ids: [],
    supplier_name: 'X', available_qty: null, stock_status: null, valid_until: null,
    partner_tier: null, discount_rate: null, customer_price_krw: null, status: '확정',
    is_active: true, needs_review: false,
    ...over,
  }
}

test('1장만 있으면 2/4/8 합성(가격·메모리·스펙 ×count 선형)', () => {
  const out = expandStandardLadder([row({ id: 'p1', gpu_count: 1, memory: '80GB' })])
  const counts = out.map((r) => r.gpu_count)
  assert.deepEqual(counts, [1, 2, 4, 8])
  const x4 = out.find((r) => r.gpu_count === 4)!
  assert.equal(x4.supply_cost_krw, 4000)
  assert.equal(x4.sell_price_krw, 4800)
  assert.equal(x4.memory, '320GB') // 총메모리 = 카드당 80 × 4
  assert.equal(x4.vcpu, 48)      // 12 × 4
  assert.equal(x4.storage_gb, 2048)
  assert.equal(x4.margin_pct, 20) // 마진율 불변
  assert.equal(x4.synthetic, true)
  assert.equal(x4.id, 'p1::x4')
})

test('총메모리 인코딩 사다리(A100 40@1·80@2·160@4·320@8)는 폭발하지 않고 1그룹 유지', () => {
  const a100 = [
    row({ id: 'a1', model_name: 'A100', memory: '40GB', gpu_count: 1 }),
    row({ id: 'a2', model_name: 'A100', memory: '80GB', gpu_count: 2 }),
    row({ id: 'a4', model_name: 'A100', memory: '160GB', gpu_count: 4 }),
    row({ id: 'a8', model_name: 'A100', memory: '320GB', gpu_count: 8 }),
  ]
  const out = expandStandardLadder(a100)
  assert.equal(out.length, 4) // 4개 그대로 — 합성 0
  assert.equal(out.filter((r) => r.synthetic).length, 0)
  assert.deepEqual(out.map((r) => r.gpu_count).sort((x, y) => x - y), [1, 2, 4, 8])
  // 원본 유지(계산 안 함)
  assert.equal(out.find((r) => r.gpu_count === 8)!.id, 'a8')
})

test('합성 rung은 구성별 고유값(전략가·시장가) 비움', () => {
  const out = expandStandardLadder([row({ gpu_count: 1 })])
  const x2 = out.find((r) => r.gpu_count === 2)!
  assert.equal(x2.strategic_price_krw, null)
  assert.equal(x2.is_strategic_set, false)
  assert.equal(x2.market_min_krw, null)
  assert.deepEqual(x2.competitors, [])
})

test('실제 존재하는 장수 구성은 원본 그대로(계산 안 함)', () => {
  // 총메모리 규약: p1 = 80GB/카드 1장, 같은 카드의 4장 구성이려면 총메모리 320GB(80×4)여야 한 그룹으로 묶인다.
  const real4 = row({ id: 'real4', gpu_count: 4, memory: '320GB', sell_price_krw: 5000, strategic_price_krw: 5500, is_strategic_set: true })
  const out = expandStandardLadder([row({ id: 'p1', gpu_count: 1, memory: '80GB' }), real4])
  const x4 = out.find((r) => r.gpu_count === 4)!
  assert.equal(x4.id, 'real4')             // 합성 아님
  assert.equal(x4.sell_price_krw, 5000)    // 원본 유지(1200×4=4800 아님)
  assert.equal(x4.strategic_price_krw, 5500)
  assert.equal(x4.synthetic, undefined)
})

test('메모리 다른 구성은 각각 독립 사다리', () => {
  // 카드당 40GB(a)와 80GB(b)는 서로 다른 카드 → 각각 1/2/4/8 독립 사다리(총 8행).
  // 총메모리 규약이라 rung 메모리는 카드당×장수(a: 40·80·160·320, b: 80·160·320·640).
  const out = expandStandardLadder([
    row({ id: 'a', model_name: 'A100', memory: '40GB', gpu_count: 1 }),
    row({ id: 'b', model_name: 'A100', memory: '80GB', gpu_count: 1 }),
  ])
  assert.equal(out.length, 8)
  const groupA = out.filter((r) => r.id === 'a' || r.id.startsWith('a::'))
  const groupB = out.filter((r) => r.id === 'b' || r.id.startsWith('b::'))
  assert.deepEqual(groupA.map((r) => r.gpu_count).sort((x, y) => x - y), [1, 2, 4, 8])
  assert.deepEqual(groupB.map((r) => r.gpu_count).sort((x, y) => x - y), [1, 2, 4, 8])
  // 카드당 메모리(총량÷장수)는 그룹 내내 불변 — a=40, b=80
  assert.ok(groupA.every((r) => Math.round(memGb(r.memory) / (r.gpu_count ?? 1)) === 40))
  assert.ok(groupB.every((r) => Math.round(memGb(r.memory) / (r.gpu_count ?? 1)) === 80))
})

test('기준행이 2장뿐이어도 per-card로 1/4/8 산출', () => {
  const out = expandStandardLadder([row({ id: 'p2', gpu_count: 2, supply_cost_krw: 2000, sell_price_krw: 2400 })])
  const x1 = out.find((r) => r.gpu_count === 1)!
  assert.equal(x1.supply_cost_krw, 1000)   // 2000 ÷ 2
  assert.equal(x1.sell_price_krw, 1200)
  const x8 = out.find((r) => r.gpu_count === 8)!
  assert.equal(x8.supply_cost_krw, 8000)
})

test('다른 화면도 동일한 1·2·4·8 구성 순서를 재사용한다', () => {
  const rows = [{ id: 'catalog-2', model_name: 'H100', memory: '160GB', gpu_count: 2, price: 200 }]
  const out = expandLadderWith(rows, (base, count, baseCount, cardGb) => ({
    ...base,
    id: `${base.id}::x${count}`,
    gpu_count: count,
    memory: `${cardGb * count}GB`,
    price: (base.price / baseCount) * count,
  }))

  assert.deepEqual(out.map((item) => item.gpu_count), [1, 2, 4, 8])
  assert.deepEqual(out.map((item) => item.price), [100, 200, 400, 800])
  assert.equal(out[1], rows[0])
})
