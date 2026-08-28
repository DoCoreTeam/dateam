import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeTax, canUseGrossBasis, largestRemainder, roundToUnit,
  divRound, divFloor, pctToBp, formatMinor, formatMinorShort, toMinor, pctOfMinor, ratioPct
} from './money.ts'

// ── 부가세 ─────────────────────────────────────────────────────────
// 이 절의 단정 하나가 기획서 §01 답 1 의 근거다.

test('GROSS 기준 — 포함가에 세율을 곱하지 않는다 (13억 → 세액 1억1,818만)', () => {
  const r = computeTax({ amountMinor: 1_300_000_000n, taxBasis: 'GROSS', taxRatePct: 10 })
  assert.equal(r.grossMinor, 1_300_000_000n)
  assert.equal(r.netMinor, 1_181_818_182n)
  assert.equal(r.taxMinor, 118_181_818n)
  // 흔한 오류(gross × 10% = 1.3억)와 1,181만 이상 차이 난다
  assert.ok(130_000_000n - r.taxMinor > 11_000_000n)
})

test('NET 기준 — 세액은 버림이 기본 (DA 시트의 «부가세(절사)»)', () => {
  const r = computeTax({ amountMinor: 24_260_000n, taxBasis: 'NET', taxRatePct: 10 })
  assert.equal(r.netMinor, 24_260_000n)
  assert.equal(r.taxMinor, 2_426_000n)
  assert.equal(r.grossMinor, 26_686_000n)
})

test('NET 기준 — 1원 미만이 생기면 버린다', () => {
  const r = computeTax({ amountMinor: 12_345n, taxBasis: 'NET', taxRatePct: 10 })
  // 1234.5 → 버림 1234
  assert.equal(r.taxMinor, 1_234n)
  assert.equal(r.grossMinor, 13_579n)
})

test('어느 방향이든 net + tax = gross 가 정확히 성립한다 (I5)', () => {
  for (const amount of [1n, 7n, 999n, 1_300_000_000n, 24_265_200n, 123_456_789n]) {
    for (const basis of ['NET', 'GROSS'] as const) {
      const r = computeTax({ amountMinor: amount, taxBasis: basis, taxRatePct: 10 })
      assert.equal(r.netMinor + r.taxMinor, r.grossMinor, `${basis} ${amount}`)
    }
  }
})

test('영세율과 면세는 세액 0 — 둘 다 금액은 그대로', () => {
  for (const kind of ['ZERO_RATED', 'EXEMPT'] as const) {
    const r = computeTax({ amountMinor: 1_000_000n, taxBasis: 'NET', taxKind: kind, taxRatePct: 10 })
    assert.equal(r.taxMinor, 0n)
    assert.equal(r.grossMinor, 1_000_000n)
  }
})

test('세율 0%도 세액 0', () => {
  const r = computeTax({ amountMinor: 1_000_000n, taxBasis: 'NET', taxRatePct: 0 })
  assert.equal(r.taxMinor, 0n)
})

test('금액 0이면 셋 다 0 — 조용히 다른 값을 만들지 않는다', () => {
  const r = computeTax({ amountMinor: 0n, taxBasis: 'GROSS', taxRatePct: 10 })
  assert.equal(r.netMinor, 0n)
  assert.equal(r.taxMinor, 0n)
})

test('세율이 섞이면 GROSS 역산을 쓸 수 없다', () => {
  assert.equal(canUseGrossBasis([{ taxRatePct: 10 }, { taxRatePct: 10 }]), true)
  assert.equal(canUseGrossBasis([{ taxRatePct: 10 }, { taxKind: 'ZERO_RATED' }]), false)
  assert.equal(canUseGrossBasis([{ taxRatePct: 10 }, { taxRatePct: 7 }]), false)
  assert.equal(canUseGrossBasis([]), true)
})

// ── 반올림 ─────────────────────────────────────────────────────────

test('제안가 절사 — 만원 단위 버림 (24,265,200 → 24,260,000)', () => {
  assert.equal(roundToUnit(24_265_200n, 10_000n, 'floor'), 24_260_000n)
  assert.equal(24_265_200n - 24_260_000n, 5_200n)
})

test('roundToUnit — 세 방식이 다르게 동작한다', () => {
  assert.equal(roundToUnit(12_500n, 10_000n, 'floor'), 10_000n)
  assert.equal(roundToUnit(12_500n, 10_000n, 'ceil'), 20_000n)
  assert.equal(roundToUnit(12_500n, 10_000n, 'round'), 10_000n) // 10,000 쪽이 가깝다
  assert.equal(roundToUnit(15_000n, 10_000n, 'round'), 20_000n) // 정확히 절반은 올림
  assert.equal(roundToUnit(14_999n, 10_000n, 'round'), 10_000n)
  assert.equal(roundToUnit(20_000n, 10_000n, 'floor'), 20_000n) // 나머지 0이면 그대로
  assert.equal(roundToUnit(123n, 1n, 'floor'), 123n)            // unit 1이면 손대지 않는다
})

test('roundToUnit — 음수도 절댓값 기준으로 같은 방향', () => {
  assert.equal(roundToUnit(-12_500n, 10_000n, 'floor'), -10_000n)
  assert.equal(roundToUnit(-12_500n, 10_000n, 'ceil'), -20_000n)
})

test('divRound 는 HALF_UP, divFloor 는 0 방향', () => {
  assert.equal(divRound(5n, 2n), 3n)
  assert.equal(divRound(-5n, 2n), -3n)
  assert.equal(divFloor(5n, 2n), 2n)
  assert.equal(divFloor(-5n, 2n), -2n)
  assert.equal(divRound(1n, 0n), 0n) // 0으로 나누기는 던지지 않고 0
})

test('pctToBp — 소수 2자리를 보존한다', () => {
  assert.equal(pctToBp(10), 1000n)
  assert.equal(pctToBp('10.00'), 1000n)
  assert.equal(pctToBp(7.5), 750n)
  assert.equal(pctToBp(0.05), 5n)
  assert.equal(pctToBp(-3), 0n)      // 음수는 0으로 접는다
  assert.equal(pctToBp('abc'), 0n)
})

// ── 최대잔여법 ──────────────────────────────────────────────────────

test('최대잔여법 — 100을 셋으로 나눠도 1원이 안 사라진다', () => {
  const r = largestRemainder(100n, [1n, 1n, 1n])
  assert.equal(r.reduce((a, b) => a + b, 0n), 100n)
  assert.deepEqual(r, [34n, 33n, 33n])
})

test('최대잔여법 — 가중치대로 나누고 합은 정확하다', () => {
  const total = 1_300_000_000n
  const w = [60n, 10n, 10n, 20n] // 국비·지방비·자부담현금·현물
  const r = largestRemainder(total, w)
  assert.equal(r.reduce((a, b) => a + b, 0n), total)
  assert.deepEqual(r, [780_000_000n, 130_000_000n, 130_000_000n, 260_000_000n])
})

test('최대잔여법 — 동점이면 앞이 먼저 받는다 (다시 계산해도 같은 답)', () => {
  const a = largestRemainder(10n, [1n, 1n, 1n])
  const b = largestRemainder(10n, [1n, 1n, 1n])
  assert.deepEqual(a, b)
  assert.deepEqual(a, [4n, 3n, 3n])
})

test('최대잔여법 — 가중치가 전부 0이면 첫 항목이 전부 갖는다', () => {
  assert.deepEqual(largestRemainder(100n, [0n, 0n]), [100n, 0n])
})

test('최대잔여법 — 빈 배열·0 총액', () => {
  assert.deepEqual(largestRemainder(100n, []), [])
  const z = largestRemainder(0n, [1n, 2n])
  assert.equal(z.reduce((a, b) => a + b, 0n), 0n)
})

test('최대잔여법 — 음수 총액도 합이 맞는다', () => {
  const r = largestRemainder(-100n, [1n, 1n, 1n])
  assert.equal(r.reduce((a, b) => a + b, 0n), -100n)
})

// ── 표시 ───────────────────────────────────────────────────────────

test('formatMinor — 세 자리 콤마', () => {
  assert.equal(formatMinor(1_300_000_000n), '1,300,000,000')
  assert.equal(formatMinor(-5_200n), '-5,200')
  assert.equal(formatMinor(0n), '0')
  assert.equal(formatMinor(1234n, 'USD'), '1,234 USD')
})

test('formatMinorShort — 폰에서 자릿수 열 개를 읽게 하지 않는다', () => {
  assert.equal(formatMinorShort(1_300_000_000n), '13억')
  assert.equal(formatMinorShort(1_040_000_000n), '10.4억')
  assert.equal(formatMinorShort(260_000_000n), '2.6억')
  assert.equal(formatMinorShort(24_260_000n), '2426만')
  assert.equal(formatMinorShort(5_200n), '5,200')
  assert.equal(formatMinorShort(-1_300_000_000n), '-13억')
})

// ── 변환 SSOT (v0.7.641) ────────────────────────────────
// 이 셋이 없던 시절 `big()` 이 cost.ts 와 booked-amount.ts 에 글자까지 똑같이 두 벌 있었다.

test('toMinor — 빈 값은 0이다. 던지면 폼의 빈 칸이 계산을 멈춘다', () => {
  assert.equal(toMinor(null), BigInt(0))
  assert.equal(toMinor(undefined), BigInt(0))
  assert.equal(toMinor(''), BigInt(0))
  assert.equal(toMinor('쓰레기'), BigInt(0))
  assert.equal(toMinor(NaN), BigInt(0))
})

test('toMinor — bigint 는 그대로, 소수는 반올림한다', () => {
  assert.equal(toMinor(BigInt(12345)), BigInt(12345))
  assert.equal(toMinor(100.4), BigInt(100))
  assert.equal(toMinor(100.5), BigInt(101))
  assert.equal(toMinor('250'), BigInt(250))
  // 잘라 버리면 합계가 늘 작아진다
  assert.equal(toMinor(0.9), BigInt(1))
})

test('pctOfMinor — 소수 넷까지 정확하다', () => {
  assert.equal(pctOfMinor(BigInt(1_000_000), 10), BigInt(100_000))
  assert.equal(pctOfMinor(BigInt(1_000_000), 12.5), BigInt(125_000))
  assert.equal(pctOfMinor(BigInt(1_000_000), 0.0001), BigInt(1))
  assert.equal(pctOfMinor(BigInt(1_000_000), 0), BigInt(0))
  assert.equal(pctOfMinor(BigInt(0), 50), BigInt(0))
  assert.equal(pctOfMinor(BigInt(1_000_000), null), BigInt(0))
})

test('ratioPct — 분모가 0이면 «모른다»(null). 0% 라고 단정하지 않는다', () => {
  assert.equal(ratioPct(BigInt(300), BigInt(1000)), 30)
  assert.equal(ratioPct(BigInt(1), BigInt(3)), 33.3)
  assert.equal(ratioPct(BigInt(0), BigInt(1000)), 0)
  assert.equal(ratioPct(BigInt(500), BigInt(0)), null, '0으로 나눈 결과를 0% 라 부르면 화면이 거짓말한다')
})
