/**
 * DI-16 관문 — 금액·스테이지 전이·won/lost 는 auto_apply 대상이 될 수 없다 (코드 하드코딩)
 * 근거: CLAUDE_dacrm 절대규칙 3 "auto_apply 대상이 될 수 없다 (코드 하드코딩)"
 *       구현명세서 4.3 마지막 행 "항상 PENDING (autoApply 설정 불가 필드 하드코딩)"
 *
 * 설정으로 두면 언젠가 누가 켠다. 그래서 설정이 아니라 코드여야 하고,
 * 이 테스트가 '코드에 박혀 있음'을 고정한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideApply, canConfigureAutoApply, NEVER_AUTO_APPLY_FIELDS,
} from '../../../lib/crm/ai/apply-policy.ts'

const MONEY_AND_STAGE = ['amountMinor', 'currency', 'stageId', 'status', 'wonAt', 'lostReason']

test('DI-16 금액·스테이지·won/lost 필드가 전부 금지 목록에 있다', () => {
  for (const f of MONEY_AND_STAGE) {
    assert.ok(NEVER_AUTO_APPLY_FIELDS.has(f), `${f} 가 금지 목록에 없다`)
  }
})

test('DI-16 autoApply 를 켜고 confidence 1.0 이어도 PENDING 이다', () => {
  for (const f of MONEY_AND_STAGE) {
    const v = decideApply({
      targetType: 'deal', field: f, isNewRecord: false,
      confidence: 1.0, autoApply: true, minConfidence: 0,
    })
    assert.equal(v.decision, 'PENDING', `${f} 가 자동 반영됐다`)
    assert.equal(v.reason, 'FIELD_NEVER_AUTO', `${f}`)
  }
})

test('DI-16 설정 UI 가 이 필드들에 토글을 노출하지 못한다', () => {
  for (const f of MONEY_AND_STAGE) {
    assert.equal(canConfigureAutoApply(f), false, `${f} 토글이 노출된다`)
  }
  assert.equal(canConfigureAutoApply('industry'), true, '일반 필드는 설정 가능해야 한다')
})

test('DI-16 verifiedFields 보다 먼저 판정된다 (둘 다 걸려도 이유가 명확해야 한다)', () => {
  const v = decideApply({
    targetType: 'deal', field: 'amountMinor', isNewRecord: false,
    confidence: 1.0, autoApply: true, verifiedFields: ['amountMinor'],
  })
  assert.equal(v.reason, 'FIELD_NEVER_AUTO')
})
