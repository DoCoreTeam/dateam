import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCatalog, perGpuOf, modelKeyOf, type CatalogRawData } from './pricing.ts'

// 실데이터 기반 B200 시나리오 (psql 실측)
//  ×1 180GB:  High Reso 3.24, gcube 7.0084
//  ×2 360GB:  gcube 13.8299  (per_gpu 6.915)
//  ×4 720GB:  gcube 27.1926  (per_gpu 6.798)
//  ×8 1440GB: gcube 53.591   (per_gpu 6.699)
// 최저 1장당 = High Reso 3.24 → 모든 구성에 전파
function b200Raw(): CatalogRawData {
  return {
    products: [
      { id: 'p1', model_name: 'B200', memory: '180GB', tier: 1, pricing_mode: 'quote', gpu_count: 1, vcpu: 28, ram_gb: 220, storage_gb: 2048, series: 'B200' },
      { id: 'p2', model_name: 'B200', memory: '360GB', tier: 1, pricing_mode: 'quote', gpu_count: 2, vcpu: 56, ram_gb: 440, storage_gb: 4096, series: 'B200' },
      { id: 'p4', model_name: 'B200', memory: '720GB', tier: 1, pricing_mode: 'quote', gpu_count: 4, vcpu: 112, ram_gb: 880, storage_gb: 8192, series: 'B200' },
      { id: 'p8', model_name: 'B200', memory: '1440GB', tier: 1, pricing_mode: 'quote', gpu_count: 8, vcpu: 224, ram_gb: 1760, storage_gb: 16384, series: 'B200' },
    ],
    quotes: [
      { product_id: 'p1', supplier_id: 'hr', unit_price_usd: 3.24, gpu_count: 1, valid_until: null },
      { product_id: 'p1', supplier_id: 'gc', unit_price_usd: 7.0084, gpu_count: 1, valid_until: null },
      { product_id: 'p2', supplier_id: 'gc', unit_price_usd: 13.8299, gpu_count: 2, valid_until: null },
      { product_id: 'p4', supplier_id: 'gc', unit_price_usd: 27.1926, gpu_count: 4, valid_until: null },
      { product_id: 'p8', supplier_id: 'gc', unit_price_usd: 53.591, gpu_count: 8, valid_until: null },
    ],
    suppliers: [
      { id: 'hr', name: 'High Reso', color: '#3b82f6' },
      { id: 'gc', name: 'gcube', color: '#10b981' },
    ],
    direct: [],
    margin_pct: 18,
    usd_krw: 1400,
    fx_date: '2026-06-03',
    today: '2026-06-03',
  }
}

test('perGpuOf — 구성 총액 ÷ 장수', () => {
  assert.equal(perGpuOf(53.591, 8), 6.6989)
  assert.equal(perGpuOf(3.24, 1), 3.24)
})

test('실견적 우선 — 같은 product+supplier에 실견적 있으면 추종가(market_link) 제외', () => {
  const raw: CatalogRawData = {
    products: [{ id: 'p1', model_name: 'H100', memory: '80GB', tier: 1, pricing_mode: 'quote', gpu_count: 1, vcpu: 26, ram_gb: 220, storage_gb: 1024, series: 'H100' }],
    quotes: [
      // 같은 공급사 A: 실견적 5.0 + 추종가(market_link) 3.0(더 쌈) → 추종가 제외되어 5.0이 effective
      { product_id: 'p1', supplier_id: 'A', unit_price_usd: 5.0, gpu_count: 1, valid_until: null, source_format: 'pdf' },
      { product_id: 'p1', supplier_id: 'A', unit_price_usd: 3.0, gpu_count: 1, valid_until: null, source_format: 'market_link' },
    ],
    suppliers: [{ id: 'A', name: 'A사', color: '#000' }],
    direct: [], margin_pct: 20, usd_krw: 1400, fx_date: '2026-06-12', today: '2026-06-12',
  }
  const cat = buildCatalog(raw)
  const p = cat.products.find((x) => x.id === 'p1')!
  assert.equal(p.effective_unit_price_usd, 5.0, '실견적 5.0이 추종가 3.0보다 우선')
})

test('추종가 단독 — 실견적 없으면 추종가(market_link) 사용', () => {
  const raw: CatalogRawData = {
    products: [{ id: 'p1', model_name: 'H100', memory: '80GB', tier: 1, pricing_mode: 'quote', gpu_count: 1, vcpu: 26, ram_gb: 220, storage_gb: 1024, series: 'H100' }],
    quotes: [{ product_id: 'p1', supplier_id: 'A', unit_price_usd: 3.0, gpu_count: 1, valid_until: null, source_format: 'market_link' }],
    suppliers: [{ id: 'A', name: 'A사', color: '#000' }],
    direct: [], margin_pct: 20, usd_krw: 1400, fx_date: '2026-06-12', today: '2026-06-12',
  }
  const cat = buildCatalog(raw)
  const p = cat.products.find((x) => x.id === 'p1')!
  assert.equal(p.effective_unit_price_usd, 3.0, '실견적 없으면 추종가 사용')
})

test('1장당 전파 — 최저 per_gpu(High Reso 3.24)가 모든 구성에 전파', () => {
  const cat = buildCatalog(b200Raw())
  const byId = new Map(cat.products.map((p) => [p.id, p]))

  // ×1 = 3.24 (자기 견적 = 전파값, 동률 → own 우선)
  assert.equal(byId.get('p1')!.effective_unit_price_usd, 3.24)
  assert.equal(byId.get('p1')!.effective_supplier!.name, 'High Reso')

  // ×2 = min(13.8299, 3.24×2=6.48) = 6.48 (전파, High Reso)
  assert.equal(byId.get('p2')!.effective_unit_price_usd, 6.48)
  assert.equal(byId.get('p2')!.is_propagated, true)
  assert.equal(byId.get('p2')!.effective_supplier!.name, 'High Reso')

  // ×8 = min(53.591, 3.24×8=25.92) = 25.92 (전파)
  assert.equal(byId.get('p8')!.effective_unit_price_usd, 25.92)
  assert.equal(byId.get('p8')!.is_propagated, true)
})

test('per_gpu_usd는 모델 최저 1장당으로 통일', () => {
  const cat = buildCatalog(b200Raw())
  for (const p of cat.products) {
    assert.equal(p.per_gpu_usd, 3.24)
  }
})

test('판매가 = effective × (1+마진)', () => {
  const cat = buildCatalog(b200Raw())
  const p8 = cat.products.find((p) => p.id === 'p8')!
  // 25.92 × 1.18 = 30.5856
  assert.ok(Math.abs(p8.sell_price_usd! - 30.5856) < 1e-6)
  assert.equal(p8.sell_price_krw, Math.round(30.5856 * 1400))
})

test('모델별 우리 공급사 목록 — per_gpu 오름차순', () => {
  const cat = buildCatalog(b200Raw())
  const mk = modelKeyOf({ model_name: 'B200', tier: 1 })
  const sups = cat.suppliersByModel.get(mk)!
  assert.equal(sups[0].name, 'High Reso')
  assert.equal(sups[0].per_gpu_usd, 3.24)
  assert.equal(sups[1].name, 'gcube')
})

test('만료 비활성(v0.7.226): valid_until 경과 견적도 포함 — 공급가는 영속 원가기준', () => {
  const raw = b200Raw()
  // High Reso 견적을 과거 만료일로 설정해도 cost 풀에 그대로 남아야 함
  raw.quotes = raw.quotes.map((q) =>
    q.supplier_id === 'hr' ? { ...q, valid_until: '2026-06-01' } : q
  )
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!
  // 만료 무시 → High Reso 3.24(최저) 유지. (만료 폐기 시였다면 gcube로 폴백됐을 것)
  assert.equal(p1.effective_supplier!.name, 'High Reso')
  assert.equal(p1.effective_unit_price_usd, 3.24)
})

// ─── 054: price_type(cost/list) 분리 + 채택(is_selected) ───

test('gcube가 list면 cost 풀에서 제외 — effective는 cost(High Reso)만', () => {
  const raw = b200Raw()
  // gcube 견적 전부 list로 마킹
  raw.quotes = raw.quotes.map((q) => q.supplier_id === 'gc' ? { ...q, price_type: 'list' as const } : q)
  const cat = buildCatalog(raw)
  const byId = new Map(cat.products.map((p) => [p.id, p]))

  // p1: cost는 High Reso 3.24만 남음
  assert.equal(byId.get('p1')!.effective_unit_price_usd, 3.24)
  assert.equal(byId.get('p1')!.effective_supplier!.name, 'High Reso')

  // suppliersByModel에 gcube 없음 (list 제외)
  const mk = modelKeyOf({ model_name: 'B200', tier: 1 })
  const names = (cat.suppliersByModel.get(mk) ?? []).map((s) => s.name)
  assert.ok(!names.includes('gcube'), 'gcube는 cost 비교에서 제외되어야 함')
  assert.ok(names.includes('High Reso'))
})

test('채택(is_selected)이 자동 최저가를 override', () => {
  const raw = b200Raw()
  // p1에 비싼 두번째 cost 견적 추가 + 그걸 채택
  raw.suppliers.push({ id: 'eq', name: 'Equinix', color: '#f59e0b' })
  raw.quotes.push({ product_id: 'p1', supplier_id: 'eq', unit_price_usd: 5.0, gpu_count: 1, valid_until: null, is_selected: true })
  // gcube list 처리(노이즈 제거)
  raw.quotes = raw.quotes.map((q) => q.supplier_id === 'gc' ? { ...q, price_type: 'list' as const } : q)
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!

  // 자동최저는 3.24(High Reso)지만 채택은 5.0(Equinix) → 채택 우선
  assert.equal(p1.effective_unit_price_usd, 5.0)
  assert.equal(p1.basis, 'selected')
  assert.equal(p1.selected_supplier!.name, 'Equinix')
  // 판매가 = 채택 × (1+마진)
  assert.ok(Math.abs((p1.sell_price_usd as number) - 5.0 * 1.18) < 1e-9)
})

test('만료 비활성(v0.7.226): 채택(is_selected) 견적은 만료돼도 영속 유지 — 폴백 없음', () => {
  const raw = b200Raw()
  raw.suppliers.push({ id: 'eq', name: 'Equinix', color: '#f59e0b' })
  // 과거 만료일의 채택 견적 (실사고: Equinix Metal valid_until 경과)
  raw.quotes.push({ product_id: 'p1', supplier_id: 'eq', unit_price_usd: 5.0, gpu_count: 1, valid_until: '2020-01-01', is_selected: true })
  raw.quotes = raw.quotes.map((q) => q.supplier_id === 'gc' ? { ...q, price_type: 'list' as const } : q)
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!

  // 만료 무시 → 채택 단가(Equinix 5.0) 그대로 기준, 추종가/자동 폴백 없음
  assert.equal(p1.effective_unit_price_usd, 5.0)
  assert.equal(p1.basis, 'selected')
  assert.equal(p1.selected_supplier!.name, 'Equinix')
  assert.equal(p1.fallback_reason, null)
})

test('cost 없고 list만 있으면 list 공시가를 고객가로 그대로(마진 미적용)', () => {
  const raw: CatalogRawData = {
    products: [{ id: 'pL', model_name: 'L40S', memory: '48GB', tier: 2, pricing_mode: 'quote', gpu_count: 1, vcpu: 16, ram_gb: 128, storage_gb: 1024, series: 'L40S' }],
    quotes: [{ product_id: 'pL', supplier_id: 'gc', unit_price_usd: 2.0, gpu_count: 1, valid_until: null, price_type: 'list' }],
    suppliers: [{ id: 'gc', name: 'gcube', color: '#10b981' }],
    direct: [], margin_pct: 25, usd_krw: 1400, fx_date: '2026-06-03', today: '2026-06-03',
  }
  const cat = buildCatalog(raw)
  const p = cat.products[0]
  assert.equal(p.basis, 'list')
  assert.equal(p.effective_unit_price_usd, null)          // 원가 없음
  assert.equal(p.sell_price_usd, 2.0)                     // 공시가 그대로(2.0 × 1.25 아님)
  assert.equal(p.sell_price_krw, 2800)                    // 2.0 × 1400
})

// ─── P2-2: 경쟁사 시장가 인입(market_link) cost가 자동으로 effective→+마진 sell에 반영 ───

test('인입 cost(market_link)는 일반 cost와 동일하게 effective→×(1+마진) sell로 자동 반영', () => {
  const raw = b200Raw()
  // 경쟁사 시장가 인입 견적: p1에 기존 최저(High Reso 3.24)보다 낮은 2.5 cost가 들어왔다고 가정.
  // 동기화/검토 commit 경로가 INSERT하는 cost 견적 형태: price_type='cost', valid_until=null.
  raw.quotes = [
    ...raw.quotes,
    { product_id: 'p1', supplier_id: 'comp-sup', unit_price_usd: 2.5, gpu_count: 1, valid_until: null, price_type: 'cost' },
  ]
  raw.suppliers = [...raw.suppliers, { id: 'comp-sup', name: '경쟁사연계공급사', color: '#ef4444' }]
  const cat = buildCatalog(raw)
  const byId = new Map(cat.products.map((p) => [p.id, p]))
  const p1 = byId.get('p1')!
  // 인입가 2.5가 자기 구성 최저 → effective=2.5
  assert.equal(p1.effective_unit_price_usd, 2.5)
  // sell = 2.5 × (1+0.18)
  assert.ok(Math.abs((p1.sell_price_usd as number) - 2.5 * 1.18) < 1e-9)
  // 모델 최저 1장당(2.5)이 파생 구성에도 전파됨 → p8 effective = 2.5 × 8
  const p8 = byId.get('p8')!
  assert.ok(Math.abs((p8.effective_unit_price_usd as number) - 2.5 * 8) < 1e-9)
})

// ─── P1-2: strategic_price_krw 파생 필드 ───

test('strategic 설정 시 strategic_krw = strategic_price_krw, is_strategic_set = true', () => {
  const raw = b200Raw()
  // p1에 strategic_price_krw 설정
  raw.products[0] = { ...raw.products[0], strategic_price_krw: 6000000 }
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!
  assert.equal(p1.strategic_price_krw, 6000000)
  assert.equal(p1.strategic_krw, 6000000)
  assert.equal(p1.is_strategic_set, true)
})

test('strategic 미설정 시 strategic_krw = sell_price_krw (자동마진가 fallback)', () => {
  const raw = b200Raw()
  // strategic_price_krw 없음
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!
  assert.equal(p1.strategic_price_krw, null)
  assert.equal(p1.is_strategic_set, false)
  assert.equal(p1.strategic_krw, p1.sell_price_krw)
})

test('effective_margin_pct 계산 — (strategic_krw - cost_krw) / cost_krw × 100', () => {
  const raw = b200Raw()
  // p1: effective = 3.24 USD, usdKrw=1400 → cost_krw = 3.24 × 1400 = 4536
  // strategic_price_krw = 5000000 원 → margin = (5000000 - 4536) / 4536 × 100 ≈ 110228%
  // 실제 검증: 마진이 계산되는 구조만 확인
  raw.products[0] = { ...raw.products[0], strategic_price_krw: 5000 }
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!
  // cost_krw = 3.24 × 1400 = 4536
  // strategic_krw = 5000
  // expected_margin = (5000 - 4536) / 4536 × 100 ≈ 10.23%
  const expected = ((5000 - 4536) / 4536) * 100
  assert.ok(p1.effective_margin_pct != null)
  assert.ok(Math.abs(p1.effective_margin_pct! - expected) < 0.01, `got ${p1.effective_margin_pct}, expected ~${expected}`)
})

test('effective_margin_pct fallback — strategic 미설정 시 sell_price_krw 기반으로 계산', () => {
  const raw = b200Raw()
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!
  // sell_price_krw = round(3.24 × 1.18 × 1400) = round(5348.16) = 5348
  // cost_krw = 3.24 × 1400 = 4536
  // expected_margin = (5348 - 4536) / 4536 × 100 ≈ 17.9% (≈ 18% 마진과 일치)
  assert.ok(p1.effective_margin_pct != null)
  assert.ok(Math.abs(p1.effective_margin_pct! - 18) < 1, `expected ~18, got ${p1.effective_margin_pct}`)
})

test('market_deviation_pct, market_median_krw — buildCatalog에서 null 초기화', () => {
  const cat = buildCatalog(b200Raw())
  for (const p of cat.products) {
    assert.equal(p.market_deviation_pct, null)
    assert.equal(p.market_median_krw, null)
  }
})

test('strategic_price_krw 컬럼 없는 환경(undefined) — 기존 sell_price_krw 불변', () => {
  const raw = b200Raw()
  // strategic_price_krw 필드 자체가 undefined인 경우 (컬럼 미존재 환경)
  // b200Raw()의 products에는 strategic_price_krw 없음 → undefined → null 처리 확인
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!
  // 기존 동작 불변 확인
  assert.equal(p1.effective_unit_price_usd, 3.24)
  assert.equal(p1.sell_price_krw, Math.round(3.24 * 1.18 * 1400))
  assert.equal(p1.is_strategic_set, false)
  assert.equal(p1.strategic_price_krw, null)
})
