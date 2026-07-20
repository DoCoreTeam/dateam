import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCurrency, resolvePeriod, resolveGpuCount, periodToHours, toUsdPerGpuHour, competitorPriceToUsd,
  resolveCurrencyWithCountry, amountToKrw, krwToCurrency, pricingModelForUnit,
} from './normalize-money.ts'

// competitorPriceToUsd(SSOT) — market/refresh 경로가 AI 자체환산 대신 이 함수로 통화 정규화.
test('competitorPriceToUsd — USD는 그대로', () => {
  assert.equal(competitorPriceToUsd('USD', 2.39, 1300), 2.39)
})
test('competitorPriceToUsd — 통화 미감지(null)는 USD 가정', () => {
  assert.equal(competitorPriceToUsd(null, 2.5, 1300), 2.5)
})
test('competitorPriceToUsd — KRW는 fx로 환산', () => {
  assert.equal(competitorPriceToUsd('KRW', 2600, 1300), 2)
})
test('competitorPriceToUsd — JPY/EUR/CNY는 null 보류(USD 둔갑 절대 금지)', () => {
  for (const cur of ['JPY', 'EUR', 'CNY']) {
    assert.equal(competitorPriceToUsd(cur, 30000, 1300), null, `${cur}는 보류`)
  }
})
test('competitorPriceToUsd — 금액 없음/0/음수는 null', () => {
  assert.equal(competitorPriceToUsd('USD', null, 1300), null)
  assert.equal(competitorPriceToUsd('USD', 0, 1300), null)
  assert.equal(competitorPriceToUsd('USD', -5, 1300), null)
})
test('competitorPriceToUsd — KRW인데 fx 무효면 null', () => {
  assert.equal(competitorPriceToUsd('KRW', 2600, 0), null)
})

// ── 다통화 환산 (P2·P3) ──
test('resolveCurrencyWithCountry — $ 중의성: 국가로 확정(SG→SGD, US→USD)', () => {
  assert.equal(resolveCurrencyWithCountry('$500/hr', 'SG'), 'SGD')
  assert.equal(resolveCurrencyWithCountry('$500/hr', 'US'), 'USD')
  assert.equal(resolveCurrencyWithCountry('$500/hr', 'HK'), 'HKD')
})
test('resolveCurrencyWithCountry — ¥ 중의성: CN→위안(CNY), JP→엔(JPY)', () => {
  assert.equal(resolveCurrencyWithCountry('¥30000', 'CN'), 'CNY')
  assert.equal(resolveCurrencyWithCountry('¥30000', 'JP'), 'JPY')
})
test('resolveCurrencyWithCountry — 국가 힌트 없으면 기본값 폴백(¥→JPY, $→USD)', () => {
  assert.equal(resolveCurrencyWithCountry('¥30000', null), 'JPY')
  assert.equal(resolveCurrencyWithCountry('$500', undefined), 'USD')
})
test('amountToKrw — 통화맵으로 환산(JPY 9.5원/엔), KRW는 그대로', () => {
  const fx = { JPY: 9.5, USD: 1342.5 }
  assert.equal(amountToKrw(30000, 'JPY', fx), 285000)   // 30000 × 9.5
  assert.equal(amountToKrw(2400000, 'KRW', fx), 2400000)
  assert.equal(amountToKrw(2, 'USD', fx), 2685)
})
test('amountToKrw — 환율 미보유 통화·감지실패는 null(USD 둔갑 금지)', () => {
  const fx = { USD: 1342.5 }
  assert.equal(amountToKrw(30000, 'JPY', fx), null)  // 맵에 JPY 없음 → 보류
  assert.equal(amountToKrw(30000, null, fx), null)
  assert.equal(amountToKrw(0, 'USD', fx), null)
})
test('krwToCurrency — 교차환율(KRW→USD)', () => {
  const fx = { USD: 1342.5 }
  assert.equal(krwToCurrency(1342.5, 'USD', fx), 1)
  assert.equal(krwToCurrency(1000, 'KRW', fx), 1000)
})

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
  // EUR/JPY는 토큰 등록됐으나 fx 미지원 → throw(reconcile이 fx_error로 needs_human 라우팅)
  assert.throws(() => toUsdPerGpuHour({ amount: 10, currency: 'EUR', period: 'hour', gpuCount: 1, krwPerUsd: 1500 }))
})

test('GPU 장수 경계: x0→null(폴백1), 3자리 x128→null', () => {
  assert.equal(resolveGpuCount('x0'), 0) // 0은 reconcile에서 <=0 → null 폴백
  assert.equal(resolveGpuCount('x128'), null) // \d{1,2} → 3자리 미매치
})

// 요금형태 — 월/년=reserved(약정), 시간/분/일=on_demand. 소프트뱅크 월정액 번들을 버리지 않고 약정으로 저장.
test('pricingModelForUnit — 월정액=reserved, 시간제=on_demand', () => {
  assert.equal(pricingModelForUnit('month'), 'reserved')   // ¥2,500,000/월 → 약정
  assert.equal(pricingModelForUnit('year'), 'reserved')
  assert.equal(pricingModelForUnit('hour'), 'on_demand')   // 7.2円/분·시간제
  assert.equal(pricingModelForUnit('minute'), 'on_demand')
  assert.equal(pricingModelForUnit('day'), 'on_demand')
  assert.equal(pricingModelForUnit(null), 'on_demand')     // 미상 → 기본 on_demand
  assert.equal(pricingModelForUnit(undefined), 'on_demand')
})
