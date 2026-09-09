/**
 * 교차검증 합의 가드 (설계서 3.6.5)
 *
 * 여기서 잠그는 것 다섯
 * - 필드 유형 6종마다 「같다」의 뜻이 다른가
 * - 합의율 1.0 일치 / 0.5 초과 다수일치 / 그 외 불일치인가
 * - 목록형이 합집합을 유지하는가 (빠뜨린 서류가 입찰을 무효로 만든다)
 * - 기본 벤더를 다시 안 부르고 앞 판을 안 덮는가
 * - 권장 점수가 오판 손실 × 불확실성인가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  consensus, sameValue, textSimilarity, listFoundBy, FIELD_KINDS,
  AMOUNT_TOLERANCE, LONG_TEXT_SIMILARITY, type VendorValue,
} from './consensus.ts'
import {
  recommend, uncertainty, stakesOf, estimateCross, planCross,
  STAKES_WEIGHT, RECOMMEND_THRESHOLD, DEFAULT_STAKES,
} from './estimate.ts'
import { runCross, applyCross, conflicts, type CrossRunner, type CrossFieldRequest } from './run-cross.ts'
import { emptyReport, makeValue, type ReportMeta } from '../report/schema.ts'

const META: ReportMeta = {
  analysisMode: 'base', baseVendor: 'A', crossVendors: [], fallbackApplied: false,
  costKrw: 0, durationMs: 0, parserQuality: 80, generatedAt: '2026-09-09T00:00:00Z',
  aiNotice: 'AI 생성 결과, 검토 필요', docClass: 'public',
}

const 값 = (vendorId: string, value: unknown, confidence: number | null = 0.9): VendorValue =>
  ({ vendorId, value, confidence })

// 유형 6종

test('필드 유형이 여섯이다', () => {
  assert.equal(FIELD_KINDS.length, 6)
  assert.deepEqual([...FIELD_KINDS], ['amount', 'date', 'enum', 'short_text', 'long_text', 'list'])
})

test('금액은 표기가 달라도 같다', () => {
  // 500,000,000 과 5억은 같은 값이다
  assert.equal(sameValue('amount', 500_000_000, '5억'), true)
  assert.equal(sameValue('amount', 500_000_000, '500,000,000원'), true)
  assert.equal(sameValue('amount', 500_000_000, 600_000_000), false)
  assert.ok(AMOUNT_TOLERANCE < 0.01)
})

test('날짜는 시각이 달라도 같은 날이면 같다', () => {
  assert.equal(sameValue('date', '2026-04-10', '2026-04-10T00:00:00Z'), true)
  assert.equal(sameValue('date', '2026-04-10', '2026-04-11'), false)
  assert.equal(sameValue('date', '2026-04-10', '날짜 아님'), false)
})

test('열거형은 대소문자와 공백을 무시한다', () => {
  assert.equal(sameValue('enum', '협상에 의한 계약', '협상에 의한 계약 '), true)
  assert.equal(sameValue('enum', 'negotiated', 'NEGOTIATED'), true)
  assert.equal(sameValue('enum', '협상', '일반'), false)
})

test('짧은 글은 공백만 무시하고 글자 그대로 본다', () => {
  assert.equal(sameValue('short_text', '한국전력공사', '한국전력공사'), true)
  assert.equal(sameValue('short_text', '한국전력공사', '한국수자원공사'), false)
})

test('긴 글은 뜻이 닮으면 같다', () => {
  const a = '본 사업은 인공지능 기반 데이터 분석 플랫폼을 구축하는 것을 목적으로 한다'
  const b = '본 사업은 인공지능 기반 데이터 분석 플랫폼 구축을 목적으로 한다'
  assert.ok(textSimilarity(a, b) >= LONG_TEXT_SIMILARITY)
  assert.equal(sameValue('long_text', a, b), true)
  assert.equal(sameValue('long_text', a, '본 사업은 도로 포장 공사를 수행한다'), false)
})

test('없는 값끼리는 같다고 하지 않는다', () => {
  assert.equal(sameValue('amount', null, 500), false)
  assert.equal(sameValue('amount', null, null), true)
})

// 합의 삼분

test('전부 같으면 일치다', () => {
  const c = consensus('amount', [값('A', 500_000_000), 값('B', '5억'), 값('C', 500_000_000)])
  assert.equal(c.verification, 'agreed')
  assert.equal(c.agreementRate, 1)
  assert.deepEqual(c.agreedBy.sort(), ['A', 'B', 'C'])
  assert.deepEqual(c.dissent, [])
})

test('과반이 같으면 다수일치다', () => {
  const c = consensus('amount', [값('A', 500_000_000), 값('B', 500_000_000), 값('C', 300_000_000)])
  assert.equal(c.verification, 'majority')
  assert.ok(c.agreementRate > 0.5)
  assert.equal(c.value, 500_000_000)
  assert.deepEqual(c.dissent.map((d) => d.vendorId), ['C'])
})

test('과반이 없으면 불일치다', () => {
  const c = consensus('amount', [값('A', 100), 값('B', 200), 값('C', 300)])
  assert.equal(c.verification, 'conflict')
  assert.ok(c.agreementRate <= 0.5)
  // 값은 보이되 배지가 경고한다
  assert.equal(c.dissent.length, 2)
})

test('둘이 갈리면 불일치다', () => {
  const c = consensus('amount', [값('A', 100), 값('B', 200)])
  assert.equal(c.agreementRate, 0.5)
  assert.equal(c.verification, 'conflict')
})

test('한 곳만 냈으면 단일이다', () => {
  const c = consensus('amount', [값('A', 100)])
  assert.equal(c.verification, 'single')
  assert.equal(c.agreementRate, 1)
})

test('아무도 못 냈으면 값이 없다', () => {
  const c = consensus('amount', [값('A', null), 값('B', null)])
  assert.equal(c.value, null)
  assert.equal(c.verification, 'single')
})

// 목록 합집합

test('목록은 합집합을 유지한다', () => {
  const c = consensus('list', [
    값('A', ['사업자등록증', '실적증명서', '인감증명서']),
    값('B', ['사업자등록증', '실적증명서', '납세증명서']),
  ])
  // 「일치하는 것만」 남기면 빠뜨린 서류 때문에 입찰이 무효가 된다
  assert.equal((c.value as unknown[]).length, 4)
  assert.deepEqual(
    (c.value as string[]).sort(),
    ['납세증명서', '사업자등록증', '실적증명서', '인감증명서'],
  )
})

test('목록 항목마다 몇 곳이 봤는지 남는다', () => {
  const found = listFoundBy([
    값('A', ['가', '나']),
    값('B', ['가']),
  ])
  assert.equal(found.find((f) => f.item === '가')!.vendors.length, 2)
  assert.equal(found.find((f) => f.item === '나')!.vendors.length, 1)
})

test('목록이 완전히 같으면 일치다', () => {
  const c = consensus('list', [값('A', ['가', '나']), 값('B', ['나', '가'])])
  assert.equal(c.verification, 'agreed')
  assert.equal(c.agreementRate, 1)
})

// 권장 점수

test('권장 점수가 오판 손실 곱하기 불확실성이다', () => {
  const r = recommend('budget.totalAmount', {
    confidence: 0.5, grounded: false, ruleFlagged: true, conflictingMentions: 2,
  })
  const expected = STAKES_WEIGHT.high * uncertainty({
    confidence: 0.5, grounded: false, ruleFlagged: true, conflictingMentions: 2,
  })
  assert.equal(r.score, Math.round(expected * 100) / 100)
  assert.equal(r.stakes, 'high')
  assert.equal(r.recommended, true)
})

test('손실이 작은 필드는 같은 불확실성에도 안 권한다', () => {
  const u = { confidence: 0.5, grounded: false, ruleFlagged: false, conflictingMentions: 0 }
  // 배경 설명이 조금 달라도 아무 일도 안 난다
  assert.equal(recommend('overview.background', u).recommended, false)
  assert.equal(recommend('budget.totalAmount', u).recommended, true)
})

test('근거 없음이 확신 없음보다 무겁다', () => {
  // 모델이 자신 있게 지어낸 값이 가장 위험하다
  const 근거없음 = uncertainty({ confidence: 1, grounded: false, ruleFlagged: false, conflictingMentions: 0 })
  const 확신없음 = uncertainty({ confidence: 0, grounded: true, ruleFlagged: false, conflictingMentions: 0 })
  assert.ok(근거없음 > 확신없음)
})

test('확실한 값은 권하지 않는다', () => {
  const r = recommend('budget.totalAmount', {
    confidence: 0.98, grounded: true, ruleFlagged: false, conflictingMentions: 0,
  })
  assert.equal(r.recommended, false)
  assert.ok(r.score < RECOMMEND_THRESHOLD)
})

test('손실 등급을 관리자가 덮을 수 있다', () => {
  assert.equal(stakesOf('overview.background'), 'low')
  assert.equal(stakesOf('overview.background', { 'overview.background': 'high' }), 'high')
  assert.equal(stakesOf('없는.필드'), 'medium')
  assert.ok(Object.keys(DEFAULT_STAKES).length > 0)
})

// 비용 예상

test('확인 전에 비용과 시간을 보여 준다', () => {
  const e = estimateCross({ fieldCount: 3, vendorCount: 2, krwPerFieldPerVendor: 350, secondsPerVendor: 90 })
  assert.equal(e.calls, 6)
  assert.equal(e.krw, 2100)
  // 벤더는 동시에 부르므로 시간은 곱이 아니라 가장 느린 하나다
  assert.equal(e.seconds, 90)
})

test('권장 필드만 골라 계획을 만든다', () => {
  const recs = [
    recommend('budget.totalAmount', { confidence: 0.3, grounded: false, ruleFlagged: true, conflictingMentions: 3 }),
    recommend('overview.background', { confidence: 0.99, grounded: true, ruleFlagged: false, conflictingMentions: 0 }),
  ]
  const plan = planCross(recs, 2, { krwPerFieldPerVendor: 350, secondsPerVendor: 90 })
  // 전부 검증하면 비용이 벤더 수만큼 곱해진다
  assert.deepEqual(plan.fields, ['budget.totalAmount'])
  assert.equal(plan.estimate.calls, 2)
})

// 실행

const 필드: CrossFieldRequest = {
  fieldPath: 'budget.totalAmount', kind: 'amount',
  baseValue: makeValue(500_000_000, { confidence: 0.9, vendor: 'A' }),
}

test('기본 벤더를 다시 부르지 않는다', async () => {
  const 불린벤더: string[] = []
  const run: CrossRunner = async (vendorId) => {
    불린벤더.push(vendorId)
    return { value: 500_000_000, confidence: 0.9, costKrw: 100 }
  }
  const r = await runCross({ fields: [필드], vendorIds: ['A', 'B', 'C'], baseVendorId: 'A' }, run)

  // 기본 벤더를 다시 부르면 같은 값에 돈을 두 번 낸다
  assert.deepEqual(불린벤더, ['B', 'C'])
  assert.equal(r.results[0].verification, 'agreed')
  assert.deepEqual(r.results[0].agreedBy.sort(), ['A', 'B', 'C'])
  assert.equal(r.totalCostKrw, 200)
})

test('한 벤더가 죽어도 나머지로 합의한다', async () => {
  const run: CrossRunner = async (vendorId) => {
    if (vendorId === 'B') throw new Error('503')
    return { value: 500_000_000, confidence: 0.9, costKrw: 100 }
  }
  const r = await runCross({ fields: [필드], vendorIds: ['B', 'C'], baseVendorId: 'A' }, run)

  // 셋 중 하나가 막혔다고 전체를 버리면 돈만 쓰고 아무것도 못 얻는다
  assert.equal(r.results[0].verification, 'agreed')
  assert.deepEqual(r.failedVendors.map((f) => f.vendorId), ['B'])
})

test('불일치를 골라낸다', async () => {
  const run: CrossRunner = async (vendorId) =>
    ({ value: vendorId === 'B' ? 300_000_000 : 700_000_000, confidence: 0.8, costKrw: 10 })
  const r = await runCross({ fields: [필드], vendorIds: ['B', 'C'], baseVendorId: 'A' }, run)
  assert.equal(conflicts(r.results).length, 1)
})

// 새 판

test('새 판을 만들되 앞 판을 안 덮는다', () => {
  const base = emptyReport(META)
  base.budget.totalAmount = makeValue(500_000_000, { vendor: 'A' })

  const next = applyCross(base, [{
    fieldPath: 'budget.totalAmount', verification: 'majority', value: 700_000_000,
    agreedBy: ['B', 'C'], dissent: [{ vendorId: 'A', value: 500_000_000 }],
    agreementRate: 0.67, costKrw: 200,
  }], { crossVendors: ['B', 'C'] })

  // 「기본 모드에서는 5억이라 했는데 교차검증 후 7억이 됐다」를 보여 줄 수 있어야 한다
  assert.equal(base.budget.totalAmount.value, 500_000_000)
  assert.equal(next.budget.totalAmount.value, 700_000_000)
  assert.equal(next.budget.totalAmount.verification, 'majority')
  assert.equal(next.budget.totalAmount.vendor, 'B, C')
  assert.equal(next.meta.analysisMode, 'cross')
  assert.deepEqual(next.meta.crossVendors, ['B', 'C'])
})

test('검증 안 한 필드는 앞 판 값을 그대로 든다', () => {
  const base = emptyReport(META)
  base.budget.totalAmount = makeValue(500_000_000)
  base.overview.title = makeValue('○○사업')

  const next = applyCross(base, [], {})
  assert.equal(next.overview.title.value, '○○사업')
  assert.equal(next.budget.totalAmount.verification, 'single')
})

test('없는 필드를 검증 결과로 만들지 않는다', () => {
  const base = emptyReport(META)
  const next = applyCross(base, [{
    fieldPath: 'budget.없는칸', verification: 'agreed', value: 1,
    agreedBy: ['A'], dissent: [], agreementRate: 1, costKrw: 0,
  }], {})
  assert.equal('없는칸' in next.budget, false)
})
