import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RFP_LAYERS, LAYER_ORDER, layerOf, canConfirm, isDisagreement,
  competitionFinding, canAdvance,
} from './layer.ts'

test('층 넷이 각각 무엇을 묻고 어느 능력을 쓰는지 적혀 있다', () => {
  assert.equal(LAYER_ORDER.length, 4)
  for (const l of LAYER_ORDER) {
    const m = RFP_LAYERS[l]
    assert.ok(m.question.length > 0, `${l} 이 무엇을 묻는지 안 적혀 있다`)
    assert.ok(['extract', 'judge', 'generate'].includes(m.capability))
  }
})

test('한 모델이 한 번 읽은 값은 1층에 머문다', () => {
  assert.equal(layerOf('single'), 'fact')
})

test('둘 이상이 본 것만 2층으로 올라간다', () => {
  assert.equal(layerOf('agreed'), 'check')
  assert.equal(layerOf('majority'), 'check')
  assert.equal(layerOf('conflict'), 'check')
})

test('사람이 고친 값은 사람의 판단이라 3층이다', () => {
  assert.equal(layerOf('user_fixed'), 'judge')
})

test('★ 어긋난 값은 근거가 있어도 확정으로 안 올라간다', () => {
  assert.equal(canConfirm('conflict', 'confirmed'), false, '근거가 있다는 것과 문서끼리 맞다는 것은 다른 명제다')
  assert.equal(canConfirm('agreed', 'confirmed'), true)
  assert.equal(canConfirm('single', 'confirmed'), true)
  assert.equal(canConfirm('agreed', 'unconfirmed'), false)
})

test('★ 어긋남을 화면이 알아볼 수 있다', () => {
  assert.equal(isDisagreement('conflict'), true)
  for (const v of ['single', 'agreed', 'majority', 'user_fixed'] as const) {
    assert.equal(isDisagreement(v), false)
  }
})

test('★ 경쟁 제한은 의심으로만 말한다', () => {
  assert.equal(competitionFinding(), 'restriction_suspected')
  // 「유리하다」는 사실 주장이고 틀리면 근거 없이 남을 비난한 것이 된다.
  // 그런 값을 만들 수 있는 길 자체를 안 둔다
  const src = String(competitionFinding())
  assert.ok(!src.includes('favor') && !src.includes('advantage'))
})

test('층은 건너뛰지 않는다', () => {
  assert.equal(canAdvance('fact', 'check'), true)
  assert.equal(canAdvance('check', 'judge'), true)
  assert.equal(canAdvance('fact', 'judge'), false, '2층을 안 거치고 3층 판단이 나오면 안 된다')
  assert.equal(canAdvance('judge', 'fact'), false)
})
