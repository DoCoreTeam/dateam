import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCorrectionExamples, suggestRulePromotions,
  RULE_PROMOTION_MIN_REPEAT, type CorrectionRecord,
} from './corrections.ts'

const NAMES = { t1: '요리', t2: 'IT·테크' }

function rec(over: Partial<CorrectionRecord> = {}): CorrectionRecord {
  return {
    title: '오늘의 김치찌개',
    fromTopicId: 't2',
    toTopicId: 't1',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

test('예시 — 무엇을 무엇으로 고쳤는지 그대로 쓴다', () => {
  const out = buildCorrectionExamples([rec()], NAMES)
  assert.equal(out.length, 1)
  assert.match(out[0], /오늘의 김치찌개/)
  assert.match(out[0], /요리/)
  assert.match(out[0], /IT·테크/)
})

test('예시 — 이전 주제가 없으면 화살표만 남긴다', () => {
  const out = buildCorrectionExamples([rec({ fromTopicId: null })], NAMES)
  assert.match(out[0], /→ 요리/)
  assert.doesNotMatch(out[0], /잘못 분류/)
})

test('예시 — 제목이 없으면 배울 게 없으므로 뺀다', () => {
  assert.deepEqual(buildCorrectionExamples([rec({ title: null }), rec({ title: '   ' })], NAMES), [])
})

test('예시 — "주제 없음"으로 되돌린 정정은 예시가 아니다', () => {
  assert.deepEqual(buildCorrectionExamples([rec({ toTopicId: null })], NAMES), [])
})

test('예시 — 삭제된 주제는 혼선이라 제외한다', () => {
  assert.deepEqual(buildCorrectionExamples([rec({ toTopicId: 'gone' })], NAMES), [])
})

test('예시 — 같은 (제목→주제)는 한 번만', () => {
  assert.equal(buildCorrectionExamples([rec(), rec(), rec()], NAMES).length, 1)
})

test('예시 — 상한을 넘지 않는다', () => {
  const many = Array.from({ length: 20 }, (_, i) => rec({ title: `제목 ${i}` }))
  assert.equal(buildCorrectionExamples(many, NAMES, 5).length, 5)
})

test('승격 제안 — 반복 임계 미달이면 제안하지 않는다', () => {
  const few = Array.from({ length: RULE_PROMOTION_MIN_REPEAT - 1 }, (_, i) => rec({ title: `t${i}` }))
  assert.deepEqual(suggestRulePromotions(few, NAMES), [])
})

test('승격 제안 — 임계 도달하면 횟수와 함께 제안한다', () => {
  const many = Array.from({ length: 4 }, (_, i) => rec({ title: `t${i}` }))
  const out = suggestRulePromotions(many, NAMES)
  assert.equal(out.length, 1)
  assert.equal(out[0].topicId, 't1')
  assert.equal(out[0].repeats, 4)
  assert.match(out[0].suggestion, /4번/)
})

test('승격 제안 — 많이 고친 주제가 위로', () => {
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => rec({ title: `a${i}`, toTopicId: 't1' })),
    ...Array.from({ length: 5 }, (_, i) => rec({ title: `b${i}`, toTopicId: 't2' })),
  ]
  const out = suggestRulePromotions(rows, NAMES)
  assert.deepEqual(out.map((r) => r.topicId), ['t2', 't1'])
})
