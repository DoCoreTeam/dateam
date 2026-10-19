import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baselineCheck, blocks } from './baseline-check.ts'

test('실사 후 견적 줄(가격 기준에서 왔는데 금액이 없음)은 막는다', () => {
  const f = baselineCheck([{ name: '저장소 구성', unitPriceMinor: '0', listPriceMinor: null, priceSource: 'LIST' }])
  assert.equal(blocks(f).length, 1)
})

test('ENT 기본 포함 0원 줄은 막지 않는다', () => {
  const f = baselineCheck([{ name: '옵션 GPU 분할', unitPriceMinor: '0', listPriceMinor: null, priceSource: 'LIST', provenance: { unitPrice: { source: 'RULE', note: 'ENT 기본 금액 기본 포함' } } }])
  assert.deepEqual(f, [])
})

test('손으로 친 0원 줄(무상 제공)은 막지 않는다 — 가격 기준에서 온 줄만 본다', () => {
  assert.deepEqual(baselineCheck([{ name: '무상 교육', unitPriceMinor: '0' }]), [])
})

test('정상가와 다른 단가는 알리고, 10배 넘게 다르면 자리수를 말한다', () => {
  const f = baselineCheck([
    { name: 'GPU', unitPriceMinor: '6000000', listPriceMinor: '7300000', priceSource: 'LIST' },
    { name: 'STD', unitPriceMinor: '150000', listPriceMinor: '15000000', priceSource: 'LIST' },
  ])
  assert.equal(f.length, 2)
  assert.ok(f.every((x) => x.level === 'warn'))
  assert.match(f[0].message, /1,300,000원 달라요/)
  assert.match(f[1].message, /10배/)
})

test('확인 전 가격과 그 사이 바뀐 정상가를 알린다', () => {
  const f = baselineCheck(
    [{ name: 'A', unitPriceMinor: '100', listPriceMinor: '100', priceSource: 'LIST', productId: 'p1', provenance: { unitPrice: { source: 'UNVERIFIED' } } }],
    new Map([['p1', BigInt(120)]]),
  )
  assert.equal(f.length, 2)
  assert.ok(f.some((x) => x.message.includes('확인 전')))
  assert.ok(f.some((x) => x.message.includes('바뀌었어요')))
})

test('비율 줄은 금액을 서버가 다시 세므로 대조하지 않는다', () => {
  assert.deepEqual(baselineCheck([{ name: '유지보수', unitPriceMinor: '0', listPriceMinor: null, priceSource: 'LIST', ratioPct: '15' }]), [])
})
