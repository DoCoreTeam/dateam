/**
 * DI-17 관문 — 신규 레코드 생성 제안은 confidence 와 무관하게 항상 사람이 확인한다
 * 근거: 구현명세서 4.3 "신규 레코드 생성 제안(회사, 인물, 딜) | confidence 무관 항상 PENDING (자동 생성 금지)"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideApply } from '../../../lib/crm/ai/apply-policy.ts'

test('DI-17 회사·인물·딜 신규 생성 제안은 confidence 1.0 이어도 PENDING', () => {
  for (const t of ['company', 'person', 'deal']) {
    const v = decideApply({
      targetType: t, isNewRecord: true, confidence: 1.0, autoApply: true, minConfidence: 0,
    })
    assert.equal(v.decision, 'PENDING', `${t} 가 자동 생성됐다`)
    assert.equal(v.reason, 'NEW_RECORD_NEEDS_HUMAN')
  }
})

test('DI-17 신규 생성이어도 0.6 미만이면 아예 저장하지 않는다 (버려지는 게 먼저다)', () => {
  const v = decideApply({ targetType: 'company', isNewRecord: true, confidence: 0.4 })
  assert.equal(v.decision, 'DISCARD')
})

test('DI-17 기존 레코드 갱신은 신규 생성 규칙에 걸리지 않는다', () => {
  const v = decideApply({
    targetType: 'company', field: 'industry', isNewRecord: false,
    confidence: 0.95, autoApply: true, minConfidence: 0.85,
  })
  assert.equal(v.decision, 'AUTO_APPLIED')
})
