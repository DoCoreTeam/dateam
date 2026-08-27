import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkI1, checkI2, checkI3, checkI4, checkI5, checkI6, checkI7, checkI8, checkI9,
  checkQuote, checkDeal, assertNoViolation,
} from './invariants.ts'

const SECTIONS = [{ id: 's1', subtotalMinor: 24_265_200n }, { id: 's2', subtotalMinor: 0n }]
const LINES = [
  { id: 'l1', sectionId: 's1', lineTotalMinor: 24_265_200n, taxRatePct: 10 },
  { id: 'l2', sectionId: 's2', lineTotalMinor: 0n, taxRatePct: 10 },
]
const QUOTE = {
  netMinor: 24_265_200n,
  discountMinor: 5_200n,
  proposedNetMinor: 24_260_000n,
  taxMinor: 2_426_520n,
  grossMinor: 26_686_520n,
}

test('I1 — 라인 합이 섹션 소계와 같으면 통과', () => {
  assert.deepEqual(checkI1(SECTIONS, LINES), [])
})

test('I1 — 어긋나면 어느 섹션이 얼마 차이인지 말한다', () => {
  const v = checkI1([{ id: 's1', subtotalMinor: 24_265_999n }], LINES)
  assert.equal(v.length, 1)
  assert.equal(v[0].code, 'I1')
  assert.equal(v[0].at, 's1')
  assert.equal(v[0].expectedMinor, 24_265_200n)
  assert.match(v[0].message, /차이 \+799/)
})

test('I2 — 섹션 합 = 견적 소계', () => {
  assert.deepEqual(checkI2(SECTIONS, 24_265_200n), [])
  assert.equal(checkI2(SECTIONS, 24_265_201n)[0].code, 'I2')
})

test('I3 — 소계 − 할인 = 제안가 (절사 5,200이 설명된다)', () => {
  assert.deepEqual(checkI3(QUOTE), [])
  assert.equal(checkI3({ ...QUOTE, proposedNetMinor: 24_265_200n })[0].code, 'I3')
})

test('I3 — 할인이 없으면 소계 = 제안가', () => {
  assert.deepEqual(checkI3({ ...QUOTE, discountMinor: undefined, netMinor: 100n, proposedNetMinor: 100n }), [])
})

test('I4 — 세율별로 나눠 계산한 합이 세액과 같아야 한다', () => {
  assert.deepEqual(checkI4(LINES, 2_426_520n), [])
  assert.equal(checkI4(LINES, 2_426_521n)[0].code, 'I4')
})

test('I4 — 과세와 영세율이 섞여도 세율별로 옳게 센다', () => {
  const mixed = [
    { lineTotalMinor: 1_000_000n, taxRatePct: 10 },
    { lineTotalMinor: 2_000_000n, taxKind: 'ZERO_RATED' as const },
  ]
  // 영세율분은 세액 0이므로 100,000 만 남는다
  assert.deepEqual(checkI4(mixed, 100_000n), [])
  assert.equal(checkI4(mixed, 300_000n)[0].code, 'I4')
})

test('I5 — 제안가 + 세액 = 총액', () => {
  assert.deepEqual(checkI5(QUOTE), [])
  assert.equal(checkI5({ ...QUOTE, grossMinor: 26_686_521n })[0].code, 'I5')
})

test('I6 — 구성비 합 100%. 부동소수로 비교하지 않는다', () => {
  assert.deepEqual(checkI6([32, 18, 8, 20, 12, 5, 5]), [])
  assert.deepEqual(checkI6([33.333333, 33.333333, 33.333334]), [])
  const v = checkI6([33.33, 33.33, 33.33])
  assert.equal(v[0].code, 'I6')
  assert.match(v[0].message, /99\.99/)
})

test('I7 — 구성 금액 합 = 기준 금액', () => {
  assert.deepEqual(checkI7([780_000_000n, 130_000_000n, 130_000_000n, 260_000_000n], 1_300_000_000n), [])
  assert.equal(checkI7([1n, 2n], 4n)[0].code, 'I7')
})

test('I8 — 대표 견적이 없으면 검사하지 않는다', () => {
  assert.deepEqual(checkI8(null, null), [])
  assert.deepEqual(checkI8(100n, null), [])
})

test('I8 — 대표 견적이 있으면 딜 견적금액과 같아야 한다', () => {
  assert.deepEqual(checkI8(24_260_000n, 24_260_000n), [])
  assert.equal(checkI8(24_260_000n, 24_999_999n)[0].code, 'I8')
})

// ── I9 — 이번 지시(답 7)로 새로 생긴 불변식 ───────────────────────────

test('I9 — 현물이 수주 매출 이하면 통과', () => {
  assert.deepEqual(checkI9(260_000_000n, 1_300_000_000n), [])
  assert.deepEqual(checkI9(0n, 0n), [])                    // 둘 다 0
  assert.deepEqual(checkI9(100n, 100n), [])                // 정확히 같은 경계
})

test('I9 — 현물이 수주 매출을 넘으면 거부하고 초과분을 말한다', () => {
  const v = checkI9(1_500_000_000n, 1_300_000_000n)
  assert.equal(v.length, 1)
  assert.equal(v[0].code, 'I9')
  assert.match(v[0].message, /200,000,000원 초과/)
})

test('checkQuote — 다섯을 한 번에', () => {
  assert.deepEqual(checkQuote({ sections: SECTIONS, lines: LINES, quote: QUOTE }), [])
  const bad = checkQuote({ sections: SECTIONS, lines: LINES, quote: { ...QUOTE, grossMinor: 1n } })
  assert.deepEqual(bad.map((v) => v.code), ['I5'])
})

test('checkDeal — I8·I9', () => {
  assert.deepEqual(checkDeal({ bookedMinor: 1_300_000_000n, inKindMinor: 260_000_000n }), [])
  const bad = checkDeal({ bookedMinor: 100n, inKindMinor: 300n, quotedMinor: 1n, primaryProposedMinor: 2n })
  assert.deepEqual(bad.map((v) => v.code), ['I8', 'I9'])
})

test('assertNoViolation — 위반이 있으면 던지고 목록을 붙인다', () => {
  assert.doesNotThrow(() => assertNoViolation([]))
  try {
    assertNoViolation(checkI9(300n, 100n))
    assert.fail('던져야 한다')
  } catch (e) {
    const err = e as Error & { violations?: { code: string }[] }
    assert.match(err.message, /\[I9\]/)
    assert.equal(err.violations?.[0].code, 'I9')
  }
})
