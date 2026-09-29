/**
 * 거래비용 — **안 빼면 성적이 부풀려진다**
 *
 * 선물은 왕복 수수료가 건당 손익을 쉽게 뒤집는다. 실측 2026-09-29: 설정이 0원이라
 * 화면 성적에 비용이 하나도 안 빠져 있었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roundTripFeeKrw, feeConfigured } from './fees.ts'

/** 미니 KOSPI200: 승수 50,000원. 지수 1,084 이면 한 계약 약정금액 5,420만원 */
const MINI = { referencePrice: 1084, multiplier: 50_000, quantity: 1 }

test('★ 수수료가 약정금액에 비례한다 — 정액으로 두면 지수가 올라도 안 따라간다', () => {
  const low = roundTripFeeKrw({ ...MINI, percentPerSide: 0.00185, flatKrw: 0 })
  const high = roundTripFeeKrw({ ...MINI, referencePrice: 2168, percentPerSide: 0.00185, flatKrw: 0 })
  assert.ok(high > low, '지수가 두 배인데 수수료가 안 늘었다')
  assert.ok(Math.abs(high - low * 2) < 0.01, '비례가 아니다')
})

test('★ 한국투자증권 공개 요율로 센 값이 맞다 (뱅키스 온라인 0.00185%)', () => {
  // 약정금액 54,200,000원 × 0.00185% = 1,002.7원 (편도) → 왕복 2,005.4원
  const fee = roundTripFeeKrw({ ...MINI, percentPerSide: 0.00185, flatKrw: 0 })
  assert.ok(Math.abs(fee - 2005.4) < 1, `왕복 수수료가 ${fee} 원이다`)
  // 영업점 요율은 다섯 배가 넘는다 — 계좌 경로가 성적을 바꾼다
  const branch = roundTripFeeKrw({ ...MINI, percentPerSide: 0.009811, flatKrw: 0 })
  assert.ok(branch > fee * 5, '영업점 요율이 온라인과 비슷하게 잡힌다')
})

test('★ 왕복이다 — 편도만 세면 비용이 절반으로 잡힌다', () => {
  const notional = MINI.referencePrice * MINI.multiplier
  const oneSide = notional * (0.00185 / 100)
  assert.ok(Math.abs(roundTripFeeKrw({ ...MINI, percentPerSide: 0.00185, flatKrw: 0 }) - oneSide * 2) < 0.01)
})

test('★ 유관기관제비용 같은 고정 비용을 더한다 — 요율로 안 잡히는 것이 있다', () => {
  const withFlat = roundTripFeeKrw({ ...MINI, percentPerSide: 0.00185, flatKrw: 500 })
  const withoutFlat = roundTripFeeKrw({ ...MINI, percentPerSide: 0.00185, flatKrw: 0 })
  assert.ok(Math.abs(withFlat - withoutFlat - 500) < 0.01, '고정 비용을 안 더한다')
})

test('★ 이상한 값이 수익이 되지 않는다 — 음수 비용은 막는다', () => {
  assert.equal(roundTripFeeKrw({ ...MINI, percentPerSide: -1, flatKrw: 0 }), 0)
  assert.ok(roundTripFeeKrw({ ...MINI, percentPerSide: 0.00185, flatKrw: -9999 }) > 0)
  // 약정금액을 못 구하면 고정 비용만 남기고, 그것도 음수면 0 이다
  assert.equal(roundTripFeeKrw({ ...MINI, referencePrice: 0, percentPerSide: 0.00185, flatKrw: 300 }), 300)
  assert.equal(roundTripFeeKrw({ ...MINI, referencePrice: Number.NaN, percentPerSide: 0.00185, flatKrw: -1 }), 0)
})

test('★ 둘 다 0이면 비용이 안 잡힌 것이다 — 화면이 그 사실을 말할 수 있어야 한다', () => {
  assert.equal(feeConfigured(0, 0), false)
  assert.equal(feeConfigured(0.00185, 0), true)
  assert.equal(feeConfigured(0, 500), true)
  assert.equal(feeConfigured(Number.NaN, Number.NaN), false)
})
