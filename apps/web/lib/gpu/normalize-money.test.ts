import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCurrency, resolvePeriod, resolveGpuCount, periodToHours, toUsdPerGpuHour,
} from './normalize-money.ts'

test('통화 토큰 정규화(기호·약어·다국어)', () => {
  assert.equal(resolveCurrency('₩'), 'KRW')
  assert.equal(resolveCurrency('원'), 'KRW')
  assert.equal(resolveCurrency('USD'), 'USD')
  assert.equal(resolveCurrency('$'), 'USD')
  assert.equal(resolveCurrency('달러'), 'USD')
  assert.equal(resolveCurrency('₩7,000,000'), 'KRW') // 기호 포함 부분일치
  assert.equal(resolveCurrency('비트코인'), null)     // 미지 → null
})

test('기간 토큰 정규화(다국어)', () => {
  assert.equal(resolvePeriod('시간당'), 'hour')
  assert.equal(resolvePeriod('/hr'), 'hour')
  assert.equal(resolvePeriod('월'), 'month')
  assert.equal(resolvePeriod('monthly'), 'month')
  assert.equal(resolvePeriod('연간'), 'year')
  assert.equal(resolvePeriod('보름'), null)
})

test('GPU 장수 추론', () => {
  assert.equal(resolveGpuCount('GPU모델 x8'), 8)
  assert.equal(resolveGpuCount('서버1대(8장)'), 8)
  assert.equal(resolveGpuCount('GPU 1장'), 1)
  assert.equal(resolveGpuCount('x1'), 1)
  assert.equal(resolveGpuCount('그냥텍스트'), null)
})

test('월=720시간 환산 계수', () => {
  assert.equal(periodToHours('hour'), 1)
  assert.equal(periodToHours('month'), 720)
  assert.equal(periodToHours('day'), 24)
  assert.equal(periodToHours('year'), 8760)
})

test('핵심 검증: T4 8장 월 7,000,000 KRW → 1장 시간당 0.81 USD (정답 J37)', () => {
  const usd = toUsdPerGpuHour({ amount: 7_000_000, currency: 'KRW', period: 'month', gpuCount: 8, krwPerUsd: 1500 })
  assert.ok(Math.abs(usd - 0.8101851) < 0.0001, `got ${usd}`)
})

test('USD 직접·1장 시간당은 그대로', () => {
  const usd = toUsdPerGpuHour({ amount: 0.81, currency: 'USD', period: 'hour', gpuCount: 1, krwPerUsd: 1500 })
  assert.ok(Math.abs(usd - 0.81) < 1e-9)
})

test('잘못된 입력은 throw(조용한 오답 금지)', () => {
  assert.throws(() => toUsdPerGpuHour({ amount: 0, currency: 'USD', period: 'hour', gpuCount: 1, krwPerUsd: 1500 }))
  assert.throws(() => toUsdPerGpuHour({ amount: 10, currency: 'USD', period: 'hour', gpuCount: 0, krwPerUsd: 1500 }))
  assert.throws(() => toUsdPerGpuHour({ amount: 10, currency: 'BTC', period: 'hour', gpuCount: 1, krwPerUsd: 1500 }))
})
