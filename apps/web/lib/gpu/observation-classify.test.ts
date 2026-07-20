import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferSegment, inferBundleInclusive, inferTaxBasis, inferComparable, classifyObservation } from './observation-classify.ts'

test('세그먼트 — 소프트뱅크 DGX 플랜은 managed_bundle, 순수 시간임대는 raw_gpu', () => {
  assert.equal(inferSegment('NVIDIA DGX H100プラン'), 'managed_bundle')
  assert.equal(inferSegment('H100 SXM $2.10/hr 온디맨드'), 'raw_gpu')
  assert.equal(inferSegment('RunPod H100 spot'), 'raw_gpu')
})

test('번들 포함 — 스토리지·InfiniBand 포함 문구 감지', () => {
  assert.equal(inferBundleInclusive('データストアストレージ InfiniBand 400Gbps'), true)
  assert.equal(inferBundleInclusive('H100 80GB $2.10/hr'), false)
})

test('세금 — 税別/税込', () => {
  assert.equal(inferTaxBasis('月額 ¥2,500,000 税別'), 'tax_excluded')
  assert.equal(inferTaxBasis('¥2,500,000 税込'), 'tax_included')
  assert.equal(inferTaxBasis('$2.10/hr'), 'unknown')
})

test('비교가능성 — 번들·최소약정·문의견적은 비교불가', () => {
  assert.equal(inferComparable('NVIDIA DGX H100プラン 月額'), false)   // 번들
  assert.equal(inferComparable('H100 最低利用 12ヶ月'), false)        // 최소약정
  assert.equal(inferComparable('H100 お問い合わせ'), false)          // 문의견적
  assert.equal(inferComparable('H100 SXM $2.10/hr 온디맨드'), true)  // raw 시간임대
})

test('소프트뱅크 H100 플랜 일괄 판정 — 번들·비교불가·세금별도', () => {
  const c = classifyObservation('NVIDIA DGX H100プラン 月額 ¥2,500,000 税別 ストレージ InfiniBand 포함')
  assert.equal(c.segment, 'managed_bundle')
  assert.equal(c.bundle_inclusive, true)
  assert.equal(c.tax_basis, 'tax_excluded')
  assert.equal(c.comparable, false) // 밴드 제외(참고전용)
})

test('순수 GPU 시간임대는 비교가능·raw', () => {
  const c = classifyObservation('RunPod H100 80GB $2.79/hr on-demand')
  assert.equal(c.segment, 'raw_gpu')
  assert.equal(c.comparable, true)
})
