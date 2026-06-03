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

test('만료 견적은 제외 (valid_until < today)', () => {
  const raw = b200Raw()
  raw.quotes = raw.quotes.map((q) =>
    q.supplier_id === 'hr' ? { ...q, valid_until: '2026-06-01' } : q
  )
  const cat = buildCatalog(raw)
  const p1 = cat.products.find((p) => p.id === 'p1')!
  // High Reso 만료 → gcube 7.0084가 ×1 최저, per_gpu = min(7.0084, 6.699)=6.699 (×8 gcube)
  assert.equal(p1.effective_supplier!.name, 'gcube')
})
