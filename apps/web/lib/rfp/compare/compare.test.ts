/**
 * 유사 사업 비교 가드 (설계서 3.12)
 *
 * 여기서 잠그는 것 셋
 * - 임베딩 상위 20건에서 구조화 필터를 거쳐 상위 5건으로 좁히는가
 * - 정형 비교표가 다섯 축을 같은 자로 재는가
 * - 양쪽 근거가 함께 실리는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  findSimilar, VECTOR_TOP_K, FINAL_TOP_K, DEFAULT_FILTERS,
  type CaseSummary, type VectorHit,
} from './similar.ts'
import {
  compareReports, COMPARE_AXES, AXIS_FIELD, AXIS_LABEL, hasBothEvidence, evidenceCoverage,
} from './diff.ts'
import { emptyReport, makeValue, type Report, type ReportMeta } from '../report/schema.ts'

const META: ReportMeta = {
  analysisMode: 'base', baseVendor: 'A', crossVendors: [], fallbackApplied: false,
  costKrw: 0, durationMs: 0, parserQuality: 80, generatedAt: '2026-09-09T00:00:00Z',
  aiNotice: 'AI 생성 결과, 검토 필요', docClass: 'public',
}

const 지금 = () => Date.parse('2026-09-09T00:00:00Z')

function 케이스(over: Partial<CaseSummary> & { caseId: string }): CaseSummary {
  return {
    title: `${over.caseId} 사업`, agency: null, sector: 'IT', projectType: '구축',
    budgetAmount: 1_000_000_000, durationMonths: 12, participated: false,
    noticeDate: '2026-01-01', ...over,
  }
}

const 나 = 케이스({ caseId: 'me' })

const 근거 = (quote: string) => [{ documentFileId: 'f', blockId: 'b', pageNo: 1, quote }]

function 리포트(over: { budget?: number; duration?: number; deliverables?: string[]; withEvidence?: boolean }): Report {
  const r = emptyReport(META)
  const ev = over.withEvidence === false ? [] : 근거('원문 인용')
  if (over.budget !== undefined) r.budget.totalAmount = makeValue(over.budget, { evidence: ev, confidence: 0.9 })
  if (over.duration !== undefined) r.schedule.durationMonths = makeValue(over.duration, { evidence: ev })
  if (over.deliverables) r.scope.deliverables = makeValue(over.deliverables.map((name) => ({ name })), { evidence: ev })
  return r
}

// 두 단계 좁히기

test('임베딩 상위 20건까지만 본다', () => {
  // 21번째부터는 예산이 벗어난 것으로 둔다 — 스무 건 제한을 지우면 제외 목록에 나타난다
  const summaries = Array.from({ length: 30 }, (_, i) => 케이스({
    caseId: `c${i}`,
    budgetAmount: i < VECTOR_TOP_K ? 1_000_000_000 : 90_000_000_000,
  }))
  const hits: VectorHit[] = summaries.map((s, i) => ({ caseId: s.caseId, similarity: 1 - i * 0.01 }))
  const { results, excluded } = findSimilar({ target: 나, hits, summaries, now: 지금 })

  assert.equal(VECTOR_TOP_K, 20)
  assert.equal(FINAL_TOP_K, 5)
  // 스무 건 밖은 아예 안 본다 — 제외 목록에도 안 들어간다
  assert.deepEqual(excluded, [])
  assert.equal(results.length, FINAL_TOP_K)
})

test('예산이 크게 다르면 제외한다', () => {
  const summaries = [
    케이스({ caseId: 'c1', budgetAmount: 1_200_000_000 }),
    케이스({ caseId: 'c2', budgetAmount: 30_000_000_000 }),
  ]
  const hits: VectorHit[] = [{ caseId: 'c1', similarity: 0.8 }, { caseId: 'c2', similarity: 0.95 }]
  const { results, excluded } = findSimilar({ target: 나, hits, summaries, now: 지금 })

  // 예산 3억과 300억은 같은 사업이 아니다 — 참여 방식도 경쟁 상대도 다르다
  assert.deepEqual(results.map((r) => r.caseId), ['c1'])
  assert.deepEqual(excluded, [{ caseId: 'c2', reason: 'budget_out_of_range' }])
})

test('기간이 크게 다르면 제외한다', () => {
  const summaries = [케이스({ caseId: 'c1', durationMonths: 36 })]
  const { results, excluded } = findSimilar({
    target: 나, hits: [{ caseId: 'c1', similarity: 0.9 }], summaries, now: 지금,
  })
  assert.deepEqual(results, [])
  assert.equal(excluded[0].reason, 'duration_out_of_range')
})

test('오래된 사업은 제외한다', () => {
  const summaries = [케이스({ caseId: 'c1', noticeDate: '2015-01-01' })]
  const { excluded } = findSimilar({
    target: 나, hits: [{ caseId: 'c1', similarity: 0.9 }], summaries, now: 지금,
  })
  assert.equal(excluded[0].reason, 'too_old')
  assert.equal(DEFAULT_FILTERS.withinYears, 5)
})

test('같은 업종만 보기를 켤 수 있다', () => {
  const summaries = [케이스({ caseId: 'c1', sector: '건설' })]
  const { excluded } = findSimilar({
    target: 나, hits: [{ caseId: 'c1', similarity: 0.9 }], summaries,
    filters: { sameSectorOnly: true }, now: 지금,
  })
  assert.equal(excluded[0].reason, 'sector_mismatch')
})

test('참여한 사업이 먼저 온다', () => {
  const summaries = [
    케이스({ caseId: 'c1', participated: false }),
    케이스({ caseId: 'c2', participated: true }),
  ]
  const { results } = findSimilar({
    target: 나,
    hits: [{ caseId: 'c1', similarity: 0.99 }, { caseId: 'c2', similarity: 0.6 }],
    summaries, now: 지금,
  })
  // 참여한 사업은 결과를 우리가 안다
  assert.deepEqual(results.map((r) => r.caseId), ['c2', 'c1'])
})

test('왜 골랐는지 남긴다', () => {
  const summaries = [케이스({ caseId: 'c1', participated: true })]
  const { results } = findSimilar({
    target: 나, hits: [{ caseId: 'c1', similarity: 0.9 }], summaries, now: 지금,
  })
  // 「비슷한 사업이 없습니다」만 뜨면 필터가 빡빡한 건지 정말 없는 건지 알 수 없다
  assert.ok(results[0].reasons.some((r) => r.includes('예산 규모')))
  assert.ok(results[0].reasons.some((r) => r.includes('우리가 참여한')))
  assert.ok(results[0].reasons.some((r) => r.includes('본문 유사도')))
})

test('자기 자신은 후보가 아니다', () => {
  const { results } = findSimilar({
    target: 나, hits: [{ caseId: 'me', similarity: 1 }], summaries: [나], now: 지금,
  })
  assert.deepEqual(results, [])
})

test('구조화 정보가 없는 후보는 제외한다', () => {
  const { excluded } = findSimilar({
    target: 나, hits: [{ caseId: 'ghost', similarity: 0.9 }], summaries: [], now: 지금,
  })
  assert.equal(excluded[0].reason, 'no_summary')
})

test('값이 비어 있으면 그 축으로 안 거른다', () => {
  const summaries = [케이스({ caseId: 'c1', budgetAmount: null, durationMonths: null })]
  const { results } = findSimilar({
    target: 케이스({ caseId: 'me', budgetAmount: null, durationMonths: null }),
    hits: [{ caseId: 'c1', similarity: 0.9 }], summaries, now: 지금,
  })
  assert.equal(results.length, 1)
})

// 비교표

test('비교 축이 다섯이고 필드 경로가 붙어 있다', () => {
  assert.equal(COMPARE_AXES.length, 5)
  assert.deepEqual([...COMPARE_AXES], ['budget', 'duration', 'eligibility', 'deliverables', 'evaluation'])
  for (const a of COMPARE_AXES) {
    assert.ok(AXIS_FIELD[a], `${a} 에 필드 경로가 없다`)
    assert.ok(AXIS_LABEL[a], `${a} 에 이름이 없다`)
  }
})

test('숫자 축은 몇 배 차이인지 낸다', () => {
  const row = compareReports(
    리포트({ budget: 1_000_000_000, duration: 12 }),
    리포트({ budget: 2_000_000_000, duration: 12 }),
    { caseId: 'c1', title: 'ㄱ', similarity: 0.9 },
  )
  const budget = row.axes.find((a) => a.axis === 'budget')!
  assert.equal(budget.ratio, 2)
  const duration = row.axes.find((a) => a.axis === 'duration')!
  assert.equal(duration.ratio, 1)
})

test('목록 축은 한쪽에만 있는 항목을 뽑는다', () => {
  const row = compareReports(
    리포트({ deliverables: ['설계서', '소스코드'] }),
    리포트({ deliverables: ['설계서', '교육', '운영매뉴얼'] }),
    { caseId: 'c1', title: 'ㄱ', similarity: 0.9 },
  )
  const d = row.axes.find((a) => a.axis === 'deliverables')!
  // 「저쪽에는 있는데 우리 쪽엔 없다」가 사용자가 가장 알고 싶은 것이다
  assert.deepEqual(d.onlyTheirs.sort(), ['교육', '운영매뉴얼'])
  assert.deepEqual(d.onlyMine, ['소스코드'])
})

test('양쪽 근거가 함께 실린다', () => {
  const row = compareReports(
    리포트({ budget: 1_000_000_000 }),
    리포트({ budget: 2_000_000_000 }),
    { caseId: 'c1', title: 'ㄱ', similarity: 0.9 },
  )
  const budget = row.axes.find((a) => a.axis === 'budget')!
  // 양쪽 원문이 있어야 문장을 믿거나 반박할 수 있다
  assert.equal(budget.mine.evidence.length, 1)
  assert.equal(budget.theirs.evidence.length, 1)
  assert.equal(hasBothEvidence(budget), true)
})

test('한쪽 근거가 없으면 그렇게 표시한다', () => {
  const row = compareReports(
    리포트({ budget: 1_000_000_000 }),
    리포트({ budget: 2_000_000_000, withEvidence: false }),
    { caseId: 'c1', title: 'ㄱ', similarity: 0.9 },
  )
  const budget = row.axes.find((a) => a.axis === 'budget')!
  assert.equal(hasBothEvidence(budget), false)
  assert.ok(evidenceCoverage(row.axes) < 1)
})

test('요약이 조사를 맞게 붙인다', () => {
  // 손으로 적으면 「사업 금액가」가 나온다 — 저장소의 josa 헬퍼를 쓴다(용어집 §0-2)
  const row = compareReports(
    리포트({ budget: 1_000_000_000, duration: 12 }),
    리포트({ budget: 3_000_000_000, duration: 36 }),
    { caseId: 'c1', title: 'ㄱ', similarity: 0.9 },
  )
  assert.match(row.summary, /사업 금액이/)
  assert.match(row.summary, /사업 기간이/)
  assert.equal(/금액가|기간가/.test(row.summary), false)
})

test('한 줄 요약이 무엇이 다른지 말한다', () => {
  const row = compareReports(
    리포트({ budget: 1_000_000_000, deliverables: ['설계서'] }),
    리포트({ budget: 3_000_000_000, deliverables: ['설계서', '교육'] }),
    { caseId: 'c1', title: 'ㄱ', similarity: 0.9 },
  )
  assert.match(row.summary, /사업 금액이 3배 더 크다/)
  assert.match(row.summary, /산출물에 1건이 더 있다/)
})

test('차이가 없으면 없다고 말한다', () => {
  const row = compareReports(
    리포트({ budget: 1_000_000_000 }),
    리포트({ budget: 1_000_000_000 }),
    { caseId: 'c1', title: 'ㄱ', similarity: 0.9 },
  )
  assert.equal(row.summary, '다섯 축에서 뚜렷한 차이가 없다')
})

test('값이 없는 축도 행은 만든다', () => {
  const row = compareReports(리포트({}), 리포트({}), { caseId: 'c1', title: 'ㄱ', similarity: 0.9 })
  assert.equal(row.axes.length, 5)
  assert.equal(row.axes[0].ratio, null)
  assert.equal(evidenceCoverage(row.axes), 0)
})
