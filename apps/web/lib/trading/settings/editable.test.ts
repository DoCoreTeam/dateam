/**
 * 설정 화면이 관문을 우회하지 못하게 — 세 값은 여기서 안 바뀐다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANGED_ELSEWHERE, editableHere, whyElsewhere } from './editable.ts'
import { TRADING_SETTINGS } from './registry.ts'

test('관문이 있는 값과 문이 되는 값은 설정 화면에서 안 바뀐다', () => {
  for (const key of ['notify_enabled', 'night_signal_enabled', 'owner_user_id']) {
    assert.equal(editableHere(key), false, `${key} 를 설정 화면에서 그냥 쓸 수 있다 — 관문 옆문이 열린다`)
    assert.ok(whyElsewhere(key), `${key} 를 막아 놓고 어디서 바꾸는지를 안 말한다`)
  }
})

test('나머지 값은 바꿀 수 있다 — 막는 것이 기본이 되면 화면이 쓸모없어진다', () => {
  const editable = TRADING_SETTINGS.filter((s) => editableHere(s.key))
  assert.ok(
    editable.length >= TRADING_SETTINGS.length - 5,
    `88개 중 ${editable.length}개만 바꿀 수 있다 — 막는 목록이 너무 넓다`,
  )
  assert.equal(whyElsewhere('daily_loss_limit_krw'), null)
})

test('막은 값은 전부 실제 레지스트리 키다 — 아무것도 안 막는 줄이 없다', () => {
  const keys = new Set(TRADING_SETTINGS.map((s) => s.key))
  for (const key of Object.keys(CHANGED_ELSEWHERE)) {
    assert.ok(keys.has(key), `${key} 는 레지스트리에 없다 — 이 줄은 아무것도 안 막는다`)
  }
})

test('사유는 어디서 바꾸는지를 말한다', () => {
  for (const [key, why] of Object.entries(CHANGED_ELSEWHERE)) {
    assert.match(why, /화면/, `${key} 의 사유가 갈 곳을 안 말한다`)
    assert.doesNotMatch(why, /나중에|추후|TODO/, `${key} 의 사유가 「나중에」다`)
  }
})
