/**
 * 통계 층·AI 층·병합 가드 (설계서 3.8.3~3.8.5)
 *
 * 여기서 잠그는 것 넷
 * - 표본 20건 미만이면 통계 층이 꺼지는가 (빈 결과가 아니라 「껐다」여야 한다)
 * - 등급이 설계서 3.8.5 표와 같은가
 * - 특정 업체를 단정하는 문장을 걸러내는가
 * - 출처(rule_id·model_id)를 병합에서 잃지 않는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { findOutliers, median, MIN_SAMPLE_SIZE, OUTLIER_MULTIPLIER } from './stat.ts'
import {
  filterCandidates, isAssertive, buildAnomalyInstruction, MIN_LLM_QUOTE, type LlmCandidate,
} from './llm.ts'
import {
  mergeAnomalies, decideGrade, titleSimilarity, dismissalRate, GRADE_ORDER, TITLE_SIMILARITY,
} from './merge.ts'
import type { Anomaly } from './engine.ts'

const 표본 = (n: number, v = 10) => ({ values: Array.from({ length: n }, () => v) })

const 규칙결과 = (over: Partial<Anomaly> = {}): Anomaly => ({
  ruleId: 'R01', title: '특정 상표 명시', grade: 'suspected', severity: 'competition',
  rationale: '상표가 적혀 있다', evidence: [{ blockId: 'b1', quote: 'Oracle 을 쓴다', pageNo: 1 }], ...over,
})

const AI후보 = (over: Partial<LlmCandidate> = {}): LlmCandidate => ({
  title: '요구 인증 조합이 좁다', rationale: '인증 3종을 모두 보유한 업체가 드물다',
  severity: 'competition', blockIds: ['b9'], quote: '참가 자격은 CSAP 와 GS 1등급을 모두 보유한 업체',
  modelId: 'gemini-2.5-pro', ...over,
})

// 통계 층

test('표본이 20건 미만이면 층을 끈다', () => {
  const r = findOutliers([{ metric: '요구사항수', value: 100, sample: 표본(MIN_SAMPLE_SIZE - 1) }])
  // 빈 결과로 두면 화면이 「이상 없음」으로 그린다
  assert.equal(r.enabled, false)
  assert.equal(r.disabledReason, 'insufficient_sample')
  assert.deepEqual(r.outliers, [])
})

test('표본이 충분하면 튄 값을 찾는다', () => {
  const r = findOutliers([{ metric: '요구사항수', value: 100, sample: 표본(MIN_SAMPLE_SIZE, 10) }])
  assert.equal(r.enabled, true)
  assert.equal(r.outliers.length, 1)
  assert.equal(r.outliers[0].median, 10)
  assert.equal(r.outliers[0].ratio, 10)
  assert.equal(r.outliers[0].sampleSize, MIN_SAMPLE_SIZE)
})

test('중앙값의 2배 안이면 안 짚는다', () => {
  const r = findOutliers([{ metric: '요구사항수', value: 15, sample: 표본(30, 10) }])
  assert.equal(r.enabled, true)
  assert.deepEqual(r.outliers, [])
  assert.equal(OUTLIER_MULTIPLIER, 2)
})

test('중앙값 계산이 맞다', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), null)
})

// AI 층

test('특정 업체를 단정하는 문장을 걸러낸다', () => {
  // 프롬프트로 부탁하는 것으로는 부족하다. 모델은 부탁을 잊는다
  assert.equal(isAssertive('이 조항은 특정 업체를 위한 것이다'), true)
  assert.equal(isAssertive('사실상 A사만이 수행할 수 있다'), true)
  assert.equal(isAssertive('특혜 소지가 있다'), true)
  assert.equal(isAssertive('법령 위반이다'), true)
  assert.equal(isAssertive('요구 인증 3종을 모두 보유한 업체가 드물다'), false)
})

test('단정하는 후보는 고쳐 쓰지 않고 버린다', () => {
  const r = filterCandidates([
    AI후보(),
    AI후보({ title: '특정 업체를 위한 조건', rationale: '특정 업체에 유리하다' }),
  ])
  // 문장을 다듬어도 그 후보가 담고 있던 판단은 그대로 남는다
  assert.equal(r.kept.length, 1)
  assert.equal(r.dropped.length, 1)
  assert.equal(r.dropped[0].reason, 'assertive')
})

test('근거 없는 후보는 소문이다', () => {
  const r = filterCandidates([AI후보({ blockIds: [] })])
  assert.deepEqual(r.kept, [])
  assert.equal(r.dropped[0].reason, 'no_evidence')
})

test('인용이 짧으면 안 받는다', () => {
  const r = filterCandidates([AI후보({ quote: '짧다' })])
  assert.equal(r.dropped[0].reason, 'short_quote')
  assert.ok(MIN_LLM_QUOTE > 0)
})

test('AI 프롬프트가 쓸 수 있는 문장과 없는 문장을 보여 준다', () => {
  const p = buildAnomalyInstruction()
  assert.match(p, /특정 업체가 유리하다거나/)
  assert.match(p, /쓸 수 있는 문장의 예/)
  assert.match(p, /쓸 수 없는 문장의 예/)
})

// 등급

test('등급이 설계서 표와 같다', () => {
  // 규칙 확정 → 확정
  assert.equal(decideGrade({ ruleGrades: ['confirmed'], fromAi: false, fromStat: false }), 'confirmed')
  // 규칙 확정은 AI 가 뭐라 하든 확정이다
  assert.equal(decideGrade({ ruleGrades: ['confirmed'], fromAi: true, fromStat: true }), 'confirmed')
  // 규칙 의심 + AI → 규칙과 AI 동시
  assert.equal(decideGrade({ ruleGrades: ['suspected'], fromAi: true, fromStat: false }), 'rule_and_ai')
  // 규칙 의심 단독 → 의심
  assert.equal(decideGrade({ ruleGrades: ['suspected'], fromAi: false, fromStat: false }), 'suspected')
  // AI 단독 → 의심
  assert.equal(decideGrade({ ruleGrades: [], fromAi: true, fromStat: false }), 'suspected')
  // 통계 단독 → 참고
  assert.equal(decideGrade({ ruleGrades: [], fromAi: false, fromStat: true }), 'reference')
})

test('등급 순서가 무거운 것부터다', () => {
  assert.deepEqual([...GRADE_ORDER], ['confirmed', 'rule_and_ai', 'suspected', 'reference'])
})

// 병합

test('같은 근거 블록을 가리키면 하나로 합친다', () => {
  const merged = mergeAnomalies(
    [규칙결과({ ruleId: 'R01', grade: 'suspected' })],
    [AI후보({ blockIds: ['b1'], title: '상표가 적혀 있다' })],
    [],
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].grade, 'rule_and_ai')
  // 출처를 버리면 「이 규칙이 자주 오탐한다」를 셀 수 없다
  assert.deepEqual(merged[0].ruleIds, ['R01'])
  assert.deepEqual(merged[0].modelIds, ['gemini-2.5-pro'])
})

test('제목이 닮아도 합친다', () => {
  const merged = mergeAnomalies(
    [규칙결과({ title: '지식재산권 귀속', evidence: [{ blockId: 'bx', quote: 'q', pageNo: null }] })],
    [AI후보({ title: '지식재산권 귀속 조항', blockIds: ['by'] })],
    [],
  )
  assert.equal(merged.length, 1)
  assert.ok(titleSimilarity('지식재산권 귀속', '지식재산권 귀속 조항') >= TITLE_SIMILARITY)
})

test('상관없는 것은 안 합친다', () => {
  const merged = mergeAnomalies(
    [규칙결과({ title: '법정 공고 기간', evidence: [{ blockId: 'b1', quote: 'q', pageNo: null }] })],
    [AI후보({ title: '지식재산권 귀속', blockIds: ['b9'] })],
    [],
  )
  assert.equal(merged.length, 2)
})

test('심각도는 가장 무거운 것을 쓴다', () => {
  const merged = mergeAnomalies(
    [규칙결과({ severity: 'blocking' }), 규칙결과({ ruleId: 'R03', severity: 'competition' })],
    [], [],
  )
  // 가벼운 쪽으로 접으면 놓친다
  assert.equal(merged[0].severity, 'blocking')
})

test('통계 단독은 참고로 붙는다', () => {
  const merged = mergeAnomalies([], [], [
    { metric: '요구사항수', value: 100, median: 10, ratio: 10, sampleSize: 30 },
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].grade, 'reference')
  assert.deepEqual(merged[0].statMetrics, ['요구사항수'])
})

test('무거운 등급이 위로 온다', () => {
  const merged = mergeAnomalies(
    [규칙결과({ ruleId: 'R03', grade: 'confirmed', title: '법정 공고 기간', evidence: [{ blockId: 'b7', quote: 'q', pageNo: null }] })],
    [AI후보({ title: '다른 것', blockIds: ['b8'] })],
    [{ metric: 'm', value: 3, median: 1, ratio: 3, sampleSize: 30 }],
  )
  assert.deepEqual(merged.map((m) => m.grade), ['confirmed', 'suspected', 'reference'])
})

test('같은 근거가 두 번 들어가지 않는다', () => {
  const merged = mergeAnomalies([규칙결과(), 규칙결과({ ruleId: 'R02' })], [], [])
  assert.equal(merged[0].evidence.length, 1)
})

test('규칙별 기각 비율을 센다', () => {
  const rate = dismissalRate({ R01: 10, R03: 2 }, [
    { ruleId: 'R01', reason: '동등 이상 문구가 다음 문단에 있었다' },
    { ruleId: 'R01', reason: '오탐' },
  ])
  // 높으면 임계값이 빡빡하다는 뜻이다
  assert.equal(rate.R01, 0.2)
  assert.equal(rate.R03, 0)
})
