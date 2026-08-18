import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  decideApply,
  canConfigureAutoApply,
  NEVER_AUTO_APPLY_FIELDS,
  AUTO_CREATABLE_TARGETS,
  AUTO_CREATABLE_AXES,
  DEFAULT_AUTO_APPLY,
  DEFAULT_MIN_CONFIDENCE,
  MIN_SUGGESTION_CONFIDENCE,
} from './apply-policy.ts'

/**
 * 이 가드가 지키는 것은 "AI 가 얼마나 스스로 하는가"의 경계다.
 *
 * 실측(2026-08-17): 제안 36건 중 29건(81%)이 반영되지 못한 채 만료됐다.
 * 막은 것은 둘뿐이었다 — AUTO_APPLY_OFF 22건, NEW_RECORD_NEEDS_HUMAN 7건.
 * 평균 신뢰도는 0.97 이었다. 즉 **AI 가 못 한 게 아니라 정책이 못 하게 했다.**
 *
 * 그래서 경계를 옮겼다. 옮긴 뒤에도 절대 넘으면 안 되는 선을 여기서 잠근다.
 */

// ── 절대 자동 반영 금지 필드 ──────────────────────────────────────────────

test('★ 돈·단계·성사 여부는 어떤 신뢰도에서도 자동 반영되지 않는다 — 합계가 조용히 틀리면 아무도 모른다', () => {
  for (const field of ['amountMinor', 'currency', 'stageId', 'status', 'wonAt', 'lostReason']) {
    const v = decideApply({
      confidence: 1, field, targetType: 'deal', isNewRecord: false, autoApply: true,
    })
    assert.equal(v.decision, 'PENDING', `${field} 가 자동 반영됐다`)
    assert.equal(v.reason, 'FIELD_NEVER_AUTO')
  }
})

test('★ 삭제·소유권·권한도 자동 반영 금지다 — 되돌리기 비용이 다른 필드와 다르다', () => {
  for (const field of ['deletedAt', 'ownerId', 'role']) {
    const v = decideApply({
      confidence: 1, field, targetType: 'deal', isNewRecord: false, autoApply: true,
    })
    assert.equal(v.decision, 'PENDING', `${field} 가 자동 반영됐다`)
    assert.equal(v.reason, 'FIELD_NEVER_AUTO')
  }
})

test('설정 화면은 자동 반영을 켤 수 없는 필드를 토글로 보여주지 않는다', () => {
  assert.equal(canConfigureAutoApply('amountMinor'), false)
  assert.equal(canConfigureAutoApply('ownerId'), false)
  assert.equal(canConfigureAutoApply('note'), true)
})

test('★ 사람이 확정한 필드는 AI 가 못 덮는다 (절대규칙 2)', () => {
  const v = decideApply({
    confidence: 1, field: 'title', targetType: 'person', isNewRecord: false,
    autoApply: true, verifiedFields: ['title'],
  })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'FIELD_VERIFIED_BY_HUMAN')
})

// ── 신뢰도 문턱 ───────────────────────────────────────────────────────────

test('0.6 미만은 저장조차 하지 않는다 — 인박스가 쓰레기로 차면 아무도 안 본다', () => {
  const v = decideApply({
    confidence: MIN_SUGGESTION_CONFIDENCE - 0.001,
    field: 'title', targetType: 'person', isNewRecord: false, autoApply: true,
  })
  assert.equal(v.decision, 'DISCARD')
  assert.equal(v.reason, 'BELOW_THRESHOLD')
})

test('0.6 이상 0.85 미만은 저장하되 사람에게 묻는다', () => {
  const v = decideApply({
    confidence: 0.7, field: 'title', targetType: 'person', isNewRecord: false, autoApply: true,
  })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'BELOW_FIELD_CONFIDENCE')
})

test('경계: 정확히 minConfidence 면 자동 반영된다 (미만일 때만 막는다)', () => {
  const v = decideApply({
    confidence: DEFAULT_MIN_CONFIDENCE, field: 'title', targetType: 'person',
    isNewRecord: false, autoApply: true,
  })
  assert.equal(v.decision, 'AUTO_APPLIED')
})

// ── v0.7.540 에서 바뀐 것: 기본값 ─────────────────────────────────────────

test('★ 설정 행이 없어도 자동 반영이 돈다 — 켜는 비용을 사람에게 떠넘기면 아무도 안 켠다', () => {
  assert.equal(DEFAULT_AUTO_APPLY, true)
  // autoApply 를 아예 안 넘긴다 = ai_field_config 행이 없는 상태
  const v = decideApply({
    confidence: 0.95, field: 'title', targetType: 'person', isNewRecord: false,
  })
  assert.equal(v.decision, 'AUTO_APPLIED')
})

test('끄고 싶은 사람은 끌 수 있다 — 명시적 false 는 존중된다', () => {
  const v = decideApply({
    confidence: 1, field: 'title', targetType: 'person', isNewRecord: false, autoApply: false,
  })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'AUTO_APPLY_OFF')
})

// ── v0.7.540 에서 바뀐 것: 신규 생성 ──────────────────────────────────────

test('★ 되돌릴 수 있는 신규(인물)는 자동으로 만든다 — 신뢰도 1.00 짜리가 만료되던 자리', () => {
  const v = decideApply({
    confidence: 0.97, targetType: 'person', isNewRecord: true, axis: 'WHO',
  })
  assert.equal(v.decision, 'AUTO_APPLIED')
})

test('★ 할 일(NEXT)도 자동으로 만든다 — 지우면 그만인 레코드다', () => {
  const v = decideApply({
    confidence: 0.9, targetType: 'task', isNewRecord: true, axis: 'NEXT',
  })
  assert.equal(v.decision, 'AUTO_APPLIED')
})

test('★ 회사·딜은 자동으로 만들지 않는다 — 목록의 기준이 되고 파이프라인 합계를 바꾼다', () => {
  for (const targetType of ['company', 'deal']) {
    const v = decideApply({
      confidence: 1, targetType, isNewRecord: true, axis: 'WHAT', autoApply: true,
    })
    assert.equal(v.decision, 'PENDING', `${targetType} 가 자동 생성됐다`)
    assert.equal(v.reason, 'NEW_RECORD_NEEDS_HUMAN')
  }
})

test('신규 생성도 신뢰도 문턱을 그대로 지킨다 — 자동 허용 대상이라고 아무 값이나 만들지 않는다', () => {
  const v = decideApply({
    confidence: 0.7, targetType: 'person', isNewRecord: true, axis: 'WHO',
  })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'BELOW_FIELD_CONFIDENCE')
})

test('신규 생성도 autoApply=false 면 멈춘다', () => {
  const v = decideApply({
    confidence: 1, targetType: 'person', isNewRecord: true, axis: 'WHO', autoApply: false,
  })
  assert.equal(v.decision, 'PENDING')
  assert.equal(v.reason, 'AUTO_APPLY_OFF')
})

test('axis 를 모르면 대상 종류로만 판정한다 — 없는 축을 지어내 통과시키지 않는다', () => {
  const unknownAxis = decideApply({
    confidence: 1, targetType: 'meeting_summary', isNewRecord: true, axis: null,
  })
  assert.equal(unknownAxis.decision, 'PENDING')
  assert.equal(unknownAxis.reason, 'NEW_RECORD_NEEDS_HUMAN')
})

// ── 목록 자체가 규칙이다 ──────────────────────────────────────────────────

test('자동 생성 허용 목록이 의도한 것만 담고 있다 (조용히 늘어나면 안 된다)', () => {
  assert.deepEqual([...AUTO_CREATABLE_TARGETS].sort(), ['person'])
  assert.deepEqual([...AUTO_CREATABLE_AXES].sort(), ['NEXT', 'RISK'])
  assert.equal(AUTO_CREATABLE_TARGETS.has('company'), false)
  assert.equal(AUTO_CREATABLE_TARGETS.has('deal'), false)
})

test('금지 필드 목록에 돈·단계·삭제·권한이 모두 들어 있다', () => {
  for (const f of ['amountMinor', 'currency', 'stageId', 'status', 'wonAt', 'lostReason',
    'deletedAt', 'ownerId', 'role']) {
    assert.equal(NEVER_AUTO_APPLY_FIELDS.has(f), true, `${f} 가 목록에서 빠졌다`)
  }
})
