import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkRules, checkItems, checkExamples, amountInSource, unitProblems, diffItems, sourceUnitOf } from './validate.ts'
import { GCUBE_EDGE } from './gcube-edge.ts'
import type { PriceProduct } from './types.ts'

test('gcube edge 가격표는 규칙 모양 검사를 통과하고 계산 예시를 그대로 재현한다', () => {
  assert.deepEqual(checkRules(GCUBE_EDGE), [])
  assert.deepEqual(checkItems(GCUBE_EDGE), [])
  const ex = checkExamples(GCUBE_EDGE)
  assert.equal(ex.length, 1)
  assert.equal(ex[0].ok, true, ex[0].mismatches.join(', '))
})

test('★ 일부러 깨기: 정상가 하나를 틀리면 예시 재현이 어긋난 값을 짚는다', () => {
  const broken: PriceProduct = {
    ...GCUBE_EDGE,
    items: GCUBE_EDGE.items.map((i) => (i.id === 'edge-gpu-dc' ? { ...i, listPriceMinor: BigInt(73_000_000) } : i)),
  }
  const ex = checkExamples(broken)[0]
  assert.equal(ex.ok, false)
  assert.match(ex.mismatches[0], /초기 도입 금액/)
})

test('규칙 모양: 없는 품목, 음수 상한, 범위 밖 할인, 어긋나는 규칙을 잡는다', () => {
  const p: PriceProduct = {
    ...GCUBE_EDGE,
    rules: [
      { kind: 'CAP', item: 'nope', varKey: 'gpu.total', max: -1 },
      { kind: 'DISCOUNT', companyKind: 'school', pct: 120, confirmed: false, label: '교육기관' },
      { kind: 'ONE_OF', items: ['edge-std', 'edge-ent'] },
      { kind: 'WITH', item: 'edge-std', with: ['edge-ent'] },
    ],
  }
  const msgs = checkRules(p).map((x) => `${x.index}:${x.message}`)
  assert.ok(msgs.some((m) => m.startsWith('0:규칙이 가리키는 품목이 없어요')))
  assert.ok(msgs.some((m) => m.startsWith('0:상한은 양수')))
  assert.ok(msgs.some((m) => m.startsWith('1:할인율은')))
  assert.ok(msgs.some((m) => m.startsWith('3:하나만 고르는 품목끼리')))
})

test('품목 모양: 비율이 비율 묶음을 가리키면 돈다', () => {
  const p: PriceProduct = {
    ...GCUBE_EDGE,
    items: GCUBE_EDGE.items.map((i) => (i.id === 'edge-maint-std' ? { ...i, ratioOfSection: '유지보수' } : i)),
  }
  assert.ok(checkItems(p).some((x) => x.itemId === 'edge-maint-std'))
})

test('원문 대조: 「단위: 만원」 가격표에서 7,300,000원은 730 으로 찾는다', () => {
  const raw = '(단위: 만원) GPU 라이선스 데이터센터용 730 / STD 기본 금액 1,500'
  assert.equal(sourceUnitOf(raw), 10_000)
  assert.equal(amountInSource(BigInt(7_300_000), raw), true)
  assert.equal(amountInSource(BigInt(15_000_000), raw), true)
  assert.equal(amountInSource(BigInt(7_400_000), raw), false, '원문에 없는 숫자는 확인 전')
})

test('단위: 만원 가격표인데 곱하지 않은 금액(730원)을 짚는다', () => {
  const raw = '단위: 만원'
  assert.deepEqual(unitProblems([{ id: 'a', minor: BigInt(730) }, { id: 'b', minor: BigInt(15_000_000) }], raw), ['a'])
})

test('단위를 못 찾으면 자릿수로 혼자 튄 줄을 짚는다', () => {
  const r = unitProblems([
    { id: 'a', minor: BigInt(7_300_000) }, { id: 'b', minor: BigInt(2_200_000) },
    { id: 'c', minor: BigInt(4_000_000) }, { id: 'd', minor: BigInt(730) },
  ], '가격표')
  assert.deepEqual(r, ['d'])
})

test('차이 보기: 바뀐 정상가, 새 품목, 없어진 품목', () => {
  const d = diffItems(
    [{ name: 'A', listPriceMinor: BigInt(1) }, { name: 'B', listPriceMinor: BigInt(2) }],
    [{ name: 'A', listPriceMinor: BigInt(3) }, { name: 'C', listPriceMinor: BigInt(4) }],
  )
  assert.equal(d.changed[0].name, 'A')
  assert.deepEqual(d.added, ['C'])
  assert.deepEqual(d.removed, ['B'])
})
