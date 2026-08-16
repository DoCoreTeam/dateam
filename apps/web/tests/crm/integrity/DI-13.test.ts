/**
 * DI-13 관문 — AI 는 코어 테이블에 직접 닿지 못한다. 제안을 거치고, 사람이 확정한 필드는 못 건드린다
 * 근거: CLAUDE_dacrm 절대규칙 1·2 / 구현명세서 4.3 표 / TASKS T1-06 "DI-12, 13"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideApply, MIN_SUGGESTION_CONFIDENCE } from '../../../lib/crm/ai/apply-policy.ts'

const base = { targetType: 'company', isNewRecord: false, autoApply: true, minConfidence: 0.85 }

test('DI-13 confidence 가 0.6 미만이면 저장조차 하지 않는다', () => {
  const v = decideApply({ ...base, field: 'industry', confidence: 0.59 })
  assert.equal(v.decision, 'DISCARD')
  assert.equal(v.reason, 'BELOW_THRESHOLD')
})

test(`DI-13 경계값 ${MIN_SUGGESTION_CONFIDENCE} 은 살린다`, () => {
  assert.notEqual(decideApply({ ...base, field: 'industry', confidence: 0.6 }).decision, 'DISCARD')
})

test('DI-13 사람이 확정한 필드는 confidence 1.0 이어도 자동 반영되지 않는다', () => {
  const v = decideApply({
    ...base, field: 'industry', confidence: 1.0, verifiedFields: ['industry'],
  })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'FIELD_VERIFIED_BY_HUMAN')
})

test('DI-13 autoApply 가 꺼져 있으면 아무리 확신해도 PENDING', () => {
  const v = decideApply({ ...base, field: 'industry', confidence: 0.99, autoApply: false })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'AUTO_APPLY_OFF')
})

test('DI-13 필드별 임계값 미만이면 PENDING', () => {
  const v = decideApply({ ...base, field: 'industry', confidence: 0.8, minConfidence: 0.85 })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'BELOW_FIELD_CONFIDENCE')
})

test('DI-13 조건을 모두 만족해야만 자동 반영된다', () => {
  const v = decideApply({ ...base, field: 'industry', confidence: 0.9 })
  assert.equal(v.decision, 'AUTO_APPLIED')
})
