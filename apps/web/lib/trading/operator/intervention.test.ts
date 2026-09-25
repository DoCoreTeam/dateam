/**
 * AI 개입 수준 — **자동이 기본인 항목이 하나도 없다** (§15.3)
 *
 * 기본값은 아무도 안 고른 값이다. 아무도 안 고른 값으로 AI 가 돈이 걸린 일을 하면
 * 그 일은 「하기로 정한 것」이 아니라 「막지 않은 것」이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTERVENTION_LEVELS, LEVEL_LABEL, INTERVENTION_ITEMS, INTERVENTION_KEY_PREFIX,
  DEFAULT_LEVELS, interventionKey, decideIntervention, autoByDefault, readLevel,
  levelChangeTiming,
} from './intervention.ts'
import { AI_ALLOWED_ACTIONS, FORBIDDEN_WORDS } from './remedy-policy.ts'
import { AI_FORBIDDEN_PREFIXES, aiMayPropose } from '../knowledge/proposal-policy.ts'
import { TRADING_SETTINGS } from '../settings/registry.ts'

test('수준이 셋이다', () => {
  assert.deepEqual([...INTERVENTION_LEVELS], ['auto', 'approve', 'off'])
  for (const l of INTERVENTION_LEVELS) assert.ok(LEVEL_LABEL[l]?.length > 0)
})

test('★ 자동이 기본인 항목이 하나도 없다', () => {
  assert.deepEqual(autoByDefault(), [])
  for (const [item, level] of Object.entries(DEFAULT_LEVELS)) {
    assert.notEqual(level, 'auto', `${item} 이 자동으로 시작한다`)
  }
})

test('★ 레지스트리 기본값도 자동이 없다 — 코드와 설정이 갈리면 설정이 이긴다', () => {
  const rows = TRADING_SETTINGS.filter((s) => s.key.startsWith(INTERVENTION_KEY_PREFIX))
  assert.ok(rows.length >= 3, `개입 설정이 ${rows.length}개뿐이다`)
  for (const r of rows) {
    assert.notEqual(r.defaultValue, 'auto', `${r.key} 가 자동으로 시작한다`)
  }
})

test('개입 항목이 허용 조치와 같은 집합이다', () => {
  assert.deepEqual([...INTERVENTION_ITEMS], [...AI_ALLOWED_ACTIONS])
})

test('설정 키에 접두사가 붙는다', () => {
  assert.equal(interventionKey('retry_notifications'), 'ai_intervention_retry_notifications')
  assert.ok(interventionKey('backfill_bars').startsWith(INTERVENTION_KEY_PREFIX))
})

// ── 수준이 금지를 못 넘는다 ──────────────────────────────

test('★ 금지 항목은 어느 수준에서도 안 열린다', () => {
  for (const level of INTERVENTION_LEVELS) {
    for (const bad of ['place_order', 'change_owner', 'open_lockbox', 'disable_gate']) {
      const r = decideIntervention(bad, level)
      assert.equal(r.allowed, false, `${bad} 가 ${level} 에서 열렸다`)
    }
  }
})

test('★ 금지 목록을 수준보다 먼저 본다', () => {
  const r = decideIntervention('place_order', 'auto')
  assert.equal(r.allowed, false)
  assert.equal(r.allowed === false && r.reason, 'forbidden_word:order',
    '수준 판정이 먼저 나왔다 — 금지가 뒤에 있으면 자동이 금지를 이길 수 있다')
})

test('모르는 항목은 수준을 못 정한다', () => {
  const r = decideIntervention('brand_new_thing', 'auto')
  assert.equal(r.allowed === false && r.reason, 'not_an_intervention_item')
})

test('끔이면 안 한다, 승인이면 사람을 기다린다, 자동이면 바로 한다', () => {
  assert.equal(decideIntervention('retry_notifications', 'off').allowed, false)
  assert.deepEqual(decideIntervention('retry_notifications', 'approve'),
    { allowed: true, needsApproval: true })
  assert.deepEqual(decideIntervention('retry_notifications', 'auto'),
    { allowed: true, needsApproval: false })
})

test('★ 모르는 값은 가장 막는 쪽으로 읽는다 — 오타 하나가 AI 를 풀어 주면 안 된다', () => {
  assert.equal(readLevel('auto'), 'auto')
  assert.equal(readLevel('approve'), 'approve')
  for (const bad of ['Auto', 'AUTO', 'automatic', '', null, undefined, 1, {}]) {
    assert.equal(readLevel(bad), 'off', `${JSON.stringify(bad)} 를 off 로 안 읽는다`)
  }
})

// ── AI 가 자기 권한을 못 넓힌다 ──────────────────────────

test('★ 개입 수준 자체를 AI 가 못 바꾼다 (§15.3)', () => {
  assert.ok(AI_FORBIDDEN_PREFIXES.includes(INTERVENTION_KEY_PREFIX),
    '개입 수준 접두사가 스펙 후보 금지 목록에 없다')
  for (const item of INTERVENTION_ITEMS) {
    assert.ok(aiMayPropose(interventionKey(item)), `${item} 의 수준을 AI 가 제안할 수 있다`)
  }
  // 운영자 스위치도 마찬가지
  assert.ok(aiMayPropose('operator_enabled'))
})

test('★ 허용 조치 어디에도 금지어가 없다 — 있으면 수준을 정할 수 없게 된다', () => {
  for (const item of INTERVENTION_ITEMS) {
    const hit = FORBIDDEN_WORDS.find((w) => item.toLowerCase().includes(w))
    assert.equal(hit, undefined, `${item} 에 금지어 ${hit} 가 있다`)
  }
})

test('★ 수준을 바꾸면 다음 거래일부터 (§15.2)', () => {
  assert.deepEqual(levelChangeTiming(), { when: 'next_trade_day', reason: 'intervention_level_change' })
})

test('인계는 조치가 아니라 수준이 끔이다', () => {
  assert.equal(DEFAULT_LEVELS.hand_off, 'off')
  assert.equal(INTERVENTION_ITEMS.includes('hand_off'), false)
})
