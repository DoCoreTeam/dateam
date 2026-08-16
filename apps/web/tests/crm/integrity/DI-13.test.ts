/**
 * DI-13 관문 — AI 는 코어 테이블에 직접 닿지 못한다. 제안을 거치고, 사람이 확정한 필드는 못 건드린다
 * 근거: CLAUDE_dacrm 절대규칙 1·2 / 구현명세서 4.3 표 / TASKS T1-06 "DI-12, 13"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideApply, canConfigureAutoApply,
  MIN_SUGGESTION_CONFIDENCE, NEVER_AUTO_APPLY_FIELDS,
} from '../../../lib/crm/ai/apply-policy.ts'

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

// ------------------------------------------------------------
// 같은 관문의 나머지 두 규칙 (명세 4.3 표의 마지막 두 행)
// ------------------------------------------------------------

const MONEY_AND_STAGE = ['amountMinor', 'currency', 'stageId', 'status', 'wonAt', 'lostReason']

test('DI-13 금액·스테이지·won/lost 는 코드로 막혀 있다 — 설정으로 켤 수 없다', () => {
  // 설정으로 두면 언젠가 누가 켠다. 금액이 사람 확인 없이 바뀌면
  // 파이프라인 합계가 조용히 틀리고 아무도 모른다(CLAUDE_dacrm 절대규칙 3).
  for (const f of MONEY_AND_STAGE) {
    assert.ok(NEVER_AUTO_APPLY_FIELDS.has(f), `${f} 가 금지 목록에 없다`)
    const v = decideApply({
      targetType: 'deal', field: f, isNewRecord: false,
      confidence: 1.0, autoApply: true, minConfidence: 0,
    })
    assert.equal(v.decision, 'PENDING', `${f} 가 자동 반영됐다`)
    assert.equal(v.reason, 'FIELD_NEVER_AUTO')
    assert.equal(canConfigureAutoApply(f), false, `${f} 토글이 설정 UI 에 노출된다`)
  }
  assert.equal(canConfigureAutoApply('industry'), true, '일반 필드는 설정 가능해야 한다')
})

test('DI-13 신규 레코드 생성 제안은 confidence 무관 항상 사람이 확인한다', () => {
  for (const t of ['company', 'person', 'deal']) {
    const v = decideApply({
      targetType: t, isNewRecord: true, confidence: 1.0, autoApply: true, minConfidence: 0,
    })
    assert.equal(v.decision, 'PENDING', `${t} 가 자동 생성됐다`)
    assert.equal(v.reason, 'NEW_RECORD_NEEDS_HUMAN')
  }
})

test('DI-13 금지 필드 판정이 verifiedFields 보다 먼저다 — 이유가 흐려지면 안 된다', () => {
  const v = decideApply({
    targetType: 'deal', field: 'amountMinor', isNewRecord: false,
    confidence: 1.0, autoApply: true, verifiedFields: ['amountMinor'],
  })
  assert.equal(v.reason, 'FIELD_NEVER_AUTO')
})
