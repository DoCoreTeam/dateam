/**
 * 알림 켜기 관문 — **검증이 먼저다** (C4)
 *
 * 관문을 안 지나고 켜면 켠 그 순간부터 우리는 모르는 것을 권하고 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideEnableNotify, decideDisableNotify, enableHint, auditLine,
  BLOCK_REASONS, type EnableContext, type EnableActor,
} from './enable-gate.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HUMAN: EnableActor = { kind: 'human', userId: 'u1' }
const AI: EnableActor = { kind: 'ai', lane: 'lib/trading/judge/jev.ts' }

/** 켤 수 있는 상태 */
const READY: EnableContext = {
  gatePassed: true, gateInsufficientCount: 0, gateFailedCount: 0,
  shadowTradeDays: 5, requiredShadowDays: 5, currentlyEnabled: false,
}

test('전부 갖추면 켤 수 있다', () => {
  assert.deepEqual(decideEnableNotify(HUMAN, READY), { allowed: true })
})

test('★ 관문을 통과 못 했으면 못 켠다 (C4)', () => {
  const r = decideEnableNotify(HUMAN, { ...READY, gatePassed: false, gateFailedCount: 2 })
  assert.equal(r.allowed, false)
  assert.equal(r.allowed === false && r.reason, 'gate_not_passed')
  assert.match(r.allowed === false ? r.userMessage : '', /미달 2개/)
})

test('★ 아직 못 잰 항목이 있으면 「미달」이 아니라 「모른다」로 막는다', () => {
  const r = decideEnableNotify(HUMAN, { ...READY, gateInsufficientCount: 3 })
  assert.equal(r.allowed === false && r.reason, 'gate_insufficient')
  // 표본이 없어서 통과 표시가 났을 수도 있다. 못 잰 것을 먼저 본다
  const both = decideEnableNotify(HUMAN, { ...READY, gatePassed: true, gateInsufficientCount: 1 })
  assert.equal(both.allowed, false)
})

test('★ 섀도 거래일이 모자라면 못 켠다', () => {
  const r = decideEnableNotify(HUMAN, { ...READY, shadowTradeDays: 4 })
  assert.equal(r.allowed === false && r.reason, 'not_enough_shadow_days')
  assert.match(r.allowed === false ? r.userMessage : '', /4일.*5일/)
  // 기준은 설정이다. 기준을 올리면 같은 일수로도 막힌다
  assert.equal(decideEnableNotify(HUMAN, { ...READY, requiredShadowDays: 10 }).allowed, false)
})

test('★ AI 는 못 켠다 (§15.3)', () => {
  const r = decideEnableNotify(AI, READY)
  assert.equal(r.allowed, false)
  assert.equal(r.allowed === false && r.reason, 'ai_cannot_enable')
  // 관문이 다 통과해도 마찬가지다
  assert.equal(decideEnableNotify(AI, { ...READY, shadowTradeDays: 99 }).allowed, false)
})

test('★ 막을 때 무엇이 모자란지를 말한다 — 「안 됩니다」만으로는 뭘 할지 모른다', () => {
  const cases: EnableContext[] = [
    { ...READY, gatePassed: false },
    { ...READY, gateInsufficientCount: 2 },
    { ...READY, shadowTradeDays: 0 },
  ]
  for (const ctx of cases) {
    const r = decideEnableNotify(HUMAN, ctx)
    assert.equal(r.allowed, false)
    assert.ok(r.allowed === false && r.userMessage.length > 10, '문장이 너무 짧다')
    assert.ok(r.allowed === false && BLOCK_REASONS.includes(r.reason))
  }
})

test('★ 끄는 것은 언제나 된다 — 관문이 깨진 날 끄지도 못하면 안 된다', () => {
  assert.deepEqual(decideDisableNotify(HUMAN), { allowed: true })
  const broken: EnableContext = {
    gatePassed: false, gateInsufficientCount: 9, gateFailedCount: 9,
    shadowTradeDays: 0, requiredShadowDays: 5, currentlyEnabled: true,
  }
  assert.equal(decideEnableNotify(HUMAN, broken).allowed, false)
  assert.equal(decideDisableNotify(HUMAN).allowed, true)

  // 「인자를 안 넘기면 통과」로는 부족하다 — 관문을 받는 인자가 생기면 그날로 막힐 수 있다.
  // 실측: 끄기에 ctx 를 더해 관문을 보게 만들었더니 이 시험이 그대로 초록이었다
  assert.equal(decideDisableNotify.length, 1, '끄기가 관문 같은 인자를 더 받는다')
  const body = readFileSync(join(HERE, 'enable-gate.ts'), 'utf8')
    .slice(readFileSync(join(HERE, 'enable-gate.ts'), 'utf8').indexOf('export function decideDisableNotify'))
  const fn = body.slice(0, body.indexOf('\n}'))
  for (const word of ['gatePassed', 'shadowTradeDays', 'Insufficient', 'gateFailed']) {
    assert.equal(fn.includes(word), false, `끄기가 ${word} 를 본다 — 위험을 줄이는 쪽은 막지 않는다`)
  }
})

test('AI 는 끄지도 못한다 — 켜고 끄는 일 자체가 사람 몫이다', () => {
  assert.equal(decideDisableNotify(AI).allowed, false)
})

test('★ 켜고 끈 일이 기록으로 남고 그때의 관문 상태가 들어간다', () => {
  const line = auditLine({
    action: 'enable', actorUserId: 'u1', at: new Date('2026-09-25T04:00:00Z'),
    gatePassed: true, shadowTradeDays: 7,
  })
  assert.match(line, /알림 켬/)
  assert.match(line, /u1/)
  assert.match(line, /관문 통과/)
  assert.match(line, /섀도 7일/)
  assert.match(auditLine({
    action: 'disable', actorUserId: 'u2', at: new Date(), gatePassed: false, shadowTradeDays: 0,
  }), /알림 끔.*관문 미통과/)
})

test('★ 화면이 왜 못 켜는지를 말한다 — 흐린 단추는 이유를 안 말한다', () => {
  assert.match(enableHint({ ...READY, shadowTradeDays: 2 }), /2일.*5일/)
  assert.equal(enableHint(READY), '알림을 켤 수 있습니다')
  assert.equal(enableHint({ ...READY, currentlyEnabled: true }), '알림이 켜져 있습니다')
})

test('★ 켜기를 우회하는 말이 코드에 없다', () => {
  const src = readFileSync(join(HERE, 'enable-gate.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const word of ['force', 'override', 'bypass', 'skipGate', 'ignoreGate']) {
    assert.equal(new RegExp(`\\b${word}`, 'i').test(src), false, `우회하는 말 ${word} 가 있다`)
  }
})
