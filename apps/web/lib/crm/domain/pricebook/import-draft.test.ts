import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildImportDraft } from './import-draft.ts'
import { RAW, read } from './import-fixture.ts'

test('★ 가격표를 읽으면 만원을 곱해 원으로, 계산 예시 12,840만원을 재현한다', () => {
  const d = buildImportDraft('product', read(), RAW)
  assert.equal(d.items.find((i) => i.name === 'GPU 라이선스 데이터센터용')!.listPriceMinor, BigInt(7_300_000))
  assert.equal(d.exampleChecks.length, 1)
  assert.equal(d.exampleChecks[0].ok, true, d.exampleChecks[0].mismatches.join(', '))
  assert.equal(d.productNeedsReview, false)
  assert.equal(d.items.filter((i) => i.needsReview).length, 0)
  assert.ok(d.rules.some((r) => r.rule.kind === 'DISCOUNT' && !r.disabledReason))
})

test('★ AI 가 단위를 원으로 잘못 읽어도 원문의 「단위: 만원」이 이긴다', () => {
  const d = buildImportDraft('product', read({ unit: '원' }), RAW)
  assert.equal(d.items[0].listPriceMinor, BigInt(15_000_000))
  assert.ok(d.notes.some((n) => n.includes('원문 단위')))
})

test('원문에 없는 숫자는 그 줄을 확인 전으로 둔다 — 지우지 않고 채운 채로', () => {
  const r = read()
  r.items[0] = { ...r.items[0], price: 1600 }
  const d = buildImportDraft('product', r, RAW)
  const std = d.items[0]
  assert.equal(std.listPriceMinor, BigInt(16_000_000))
  assert.equal(std.needsReview, true)
  assert.ok(std.problems.includes('이 숫자를 원문에서 못 찾았어요'))
  assert.equal(d.productNeedsReview, true, '정상가가 틀리면 예시 재현도 어긋나 제품 전체가 확인 전')
})

test('가리키는 품목이 없는 규칙은 끈 채로 남는다', () => {
  const d = buildImportDraft('product', read({ rules: [{ kind: 'WITH', item: 'STD 기본 금액', with: ['없는 품목'] }] }), RAW)
  assert.ok(d.rules[0].disabledReason)
})

test('그림째 읽어 원문 글이 없으면 원문 대조를 못 했다고 남긴다', () => {
  const d = buildImportDraft('product', read(), '')
  assert.equal(d.sourceChecked, false)
  assert.equal(d.items[0].listPriceMinor, BigInt(15_000_000), 'AI 단위(만원)로 센다')
})

test('다시 올리면 차이를 센다 — 바뀐 정상가, 새 품목, 없어진 품목', () => {
  const d = buildImportDraft('product', read(), RAW, [
    { id: 'a', name: 'STD 기본 금액', listPriceMinor: BigInt(14_000_000) },
    { id: 'b', name: '옛 옵션', listPriceMinor: BigInt(1) },
  ])
  assert.equal(d.diff!.changed[0].name, 'STD 기본 금액')
  assert.deepEqual(d.diff!.removed, ['옛 옵션'])
})

test('공표 노임단가 PDF — 등급마다 공표값, 원문 대조', () => {
  const raw = '2026년 SW 기술자 평균임금 (단위: 원) 특급 9,500,000 고급 7,800,000 중급 6,200,000 초급 4,800,000'
  const d = buildImportDraft('labor', read({
    unit: '원', items: [], rules: [], discounts: [], examples: [],
    grades: [
      { name: '특급', publicRate: 9_500_000, price: null, effectiveFrom: '2026-01-01', sourceText: null },
      { name: '고급', publicRate: 7_900_000, price: null, effectiveFrom: '2026-01-01', sourceText: null },
    ],
  }), raw)
  assert.equal(d.grades[0].publicRateMinor, BigInt(9_500_000))
  assert.deepEqual(d.grades[0].problems, [])
  assert.deepEqual(d.grades[1].problems, ['이 숫자를 원문에서 못 찾았어요'])
})

test('★ AI 가 수량 규칙을 빠뜨려도 품목 이름으로 채워 예시가 맞는다 — 같은 글에 다른 답이 와도 같은 결과', () => {
  const d = buildImportDraft('product', read({ rules: [{ kind: 'ONE_OF', items: ['STD 기본 금액', 'ENT 기본 금액'] }] }), RAW)
  assert.equal(d.exampleChecks[0].ok, true, d.exampleChecks[0].mismatches.join(', '))
  assert.ok(d.notes.some((n) => n.includes('규칙') && n.includes('채웠어요')))
  assert.ok(d.rules.some((r) => r.rule.kind === 'WITH'), 'STD 와 STD 기본 구축을 잇는다')
})

test('★ AI 가 예시 금액을 계산기 쪽(할인 적용)에서 읽어도 예시 표가 같은 세 값을 적고 있으면 그 숫자로 맞춘다', () => {
  const raw = `--- 1쪽 --- ${RAW}\n--- 3쪽 --- 견적 계산기 | 교육기관 10% | 초기 도입 금액 | 7,660 | 연 유지보수 | 999 | 누적 | 11,656`
  const r = read()
  r.examples = [{ ...r.examples[0], expectOnce: 7660, expectAnnual: 999, expectTco: 11656 }]
  const d = buildImportDraft('product', r, raw)
  assert.equal(d.exampleChecks[0].ok, true, d.exampleChecks[0].mismatches.join(', '))
  assert.equal(d.examples[0].expectOnceMinor, BigInt(84_000_000))
  assert.ok(d.notes.some((n) => n.includes('원문 예시 표의 숫자로')))
  assert.equal(d.productNeedsReview, false)
})

test('예시 표에 엔진 값이 없으면 바로잡지 않고 어긋남을 그대로 보인다 — 엔진이 틀린 것을 숨기지 않는다', () => {
  const raw = RAW.replace('초기 도입 8,400', '초기 도입 8,500')
  const r = read()
  r.examples = [{ ...r.examples[0], expectOnce: 8500 }]
  const d = buildImportDraft('product', r, raw)
  assert.equal(d.exampleChecks[0].ok, false)
  assert.equal(d.productNeedsReview, true)
  assert.ok(!d.notes.some((n) => n.includes('원문 예시 표의 숫자로')))
})
