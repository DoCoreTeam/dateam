import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPriceBreakdown, resolveConfirmUnitPrice } from './price-breakdown.ts'
import { toUsdPerGpuHour } from './normalize-money.ts'

test('KRW/month 단가 산출 근거 — 매매기준율 1523·월 720h 기준', () => {
  const b = buildPriceBreakdown({
    originalPrice: 3189800,
    originalCurrency: 'KRW',
    originalUnit: 'KRW/month',
    gpuCount: 1,
    krwPerUsd: 1523,
  })
  assert.equal(b.ok, true)
  // 3,189,800 / 1523 / 720 ≈ 2.909
  assert.ok(b.usdPerGpuHour! > 2.9 && b.usdPerGpuHour! < 2.92, `expected ~2.91, got ${b.usdPerGpuHour}`)
  // SSOT와 동일해야 함
  const ssot = toUsdPerGpuHour({ amount: 3189800, currency: 'KRW', period: 'month', gpuCount: 1, krwPerUsd: 1523 })
  assert.equal(b.usdPerGpuHour, ssot)
  // 단계: 원본 + 통화환산 + 시간환산 + 정합단가 (장수=1이라 장수환산 생략)
  const labels = b.steps.map((s) => s.label)
  assert.ok(labels.includes('원본'))
  assert.ok(labels.includes('통화 환산'))
  assert.ok(labels.includes('시간 환산'))
  assert.ok(labels.includes('정합 단가'))
})

test('하드코딩 1370 환율과 정합 환율(1523)은 다른 값을 낸다(버그 입증)', () => {
  const wrong = 3189800 / 1370 / 730 // 구 하드코딩 경로 ≈ 3.19
  const right = buildPriceBreakdown({
    originalPrice: 3189800, originalCurrency: 'KRW', originalUnit: 'month', gpuCount: 1, krwPerUsd: 1523,
  }).usdPerGpuHour!
  assert.ok(Math.abs(wrong - right) > 0.2, '하드코딩 경로와 정합 경로 차이가 유의미해야 함')
})

test('8장 묶음가 → 1장당 환산', () => {
  const b = buildPriceBreakdown({
    originalPrice: 16, originalCurrency: 'USD', originalUnit: '/hr', gpuCount: 8, krwPerUsd: 1523,
  })
  assert.equal(b.ok, true)
  assert.equal(b.usdPerGpuHour, 2)
  assert.ok(b.steps.some((s) => s.label === '장수 환산'))
})

test('8장 묶음 + KRW/month 복합 환산', () => {
  // 25,536,000 KRW/month, 8장 → 1장·시간당
  const b = buildPriceBreakdown({
    originalPrice: 25536000, originalCurrency: 'KRW', originalUnit: 'KRW/month', gpuCount: 8, krwPerUsd: 1523,
  })
  assert.equal(b.ok, true)
  const expected = 25536000 / 1523 / 720 / 8
  assert.ok(Math.abs((b.usdPerGpuHour ?? 0) - expected) < 1e-9)
  const labels = b.steps.map((s) => s.label)
  assert.ok(labels.includes('통화 환산') && labels.includes('시간 환산') && labels.includes('장수 환산'))
})

test('USD 시간당 직접가 — 환산 단계 없이 그대로', () => {
  const b = buildPriceBreakdown({
    originalPrice: 2.5, originalCurrency: 'USD', originalUnit: '/hr', gpuCount: 1, krwPerUsd: 1523,
  })
  assert.equal(b.ok, true)
  assert.equal(b.usdPerGpuHour, 2.5)
})

test('통화 미인식 → ok:false, 가능한 단계까지만', () => {
  const b = buildPriceBreakdown({
    originalPrice: 1000, originalCurrency: '비트코인', originalUnit: 'month', gpuCount: 1, krwPerUsd: 1523,
  })
  assert.equal(b.ok, false)
  assert.ok(b.steps.length >= 1)
})

test('금액 없음 → ok:false', () => {
  const b = buildPriceBreakdown({ originalPrice: null, krwPerUsd: 1523 })
  assert.equal(b.ok, false)
})

test('확정 단가 — KRW/month는 SSOT 재계산(AI 하드코딩값 버림)', () => {
  const r = resolveConfirmUnitPrice({
    aiUnitPriceUsd: 3.17, // AI 하드코딩(1370) 값
    originalPrice: 3189800, originalCurrency: 'KRW', originalUnit: 'KRW/month',
    gpuCount: 1, krwPerUsd: 1523, fallbackPerGpu: 3.17,
  })
  assert.equal(r.recomputed, true)
  assert.ok(r.value > 2.9 && r.value < 2.92, `expected ~2.91, got ${r.value}`)
})

test('확정 단가 — 이미 USD·시간당이면 AI 값 유지(회귀 0)', () => {
  const r = resolveConfirmUnitPrice({
    aiUnitPriceUsd: 2.5, originalPrice: 2.5, originalCurrency: 'USD', originalUnit: '/hr',
    gpuCount: 1, krwPerUsd: 1523, fallbackPerGpu: 2.5,
  })
  assert.equal(r.recomputed, false)
  assert.equal(r.value, 2.5)
})

test('확정 단가 — 원본가 없으면 폴백 유지', () => {
  const r = resolveConfirmUnitPrice({
    aiUnitPriceUsd: 1.8, originalPrice: null, gpuCount: 1, krwPerUsd: 1523, fallbackPerGpu: 1.8,
  })
  assert.equal(r.recomputed, false)
  assert.equal(r.value, 1.8)
})

test('확정 단가 — 환율 미주입이면 폴백 유지', () => {
  const r = resolveConfirmUnitPrice({
    aiUnitPriceUsd: 3.17, originalPrice: 3189800, originalCurrency: 'KRW', originalUnit: 'month',
    gpuCount: 1, krwPerUsd: 0, fallbackPerGpu: 3.17,
  })
  assert.equal(r.recomputed, false)
  assert.equal(r.value, 3.17)
})
