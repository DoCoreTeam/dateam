/**
 * 무장 관문 — **기본이 해제이고 만료가 있다**
 *
 * 설정 하나로 켜고 끄면 그 설정은 다른 설정들과 같은 무게로 보인다.
 * 화면에서 스무 개 값 중 하나이고, 잘못 눌러도 아무 일 없어 보인다.
 * 그런데 그 하나가 돈을 움직인다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARM_CHECKS, ARM_CHECK_LABEL, checkArming, isArmed, expiryFrom, mayDisarm, armingHint,
  DEFAULT_ARM_HOURS, type ArmContext,
} from './arming-policy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = new Date('2026-09-25T04:00:00Z')

const READY: ArmContext = {
  env: 'paper',
  gatePassed: true, gateInsufficient: 0,
  notifyEnabled: true,
  paperAutoDays: 20, requiredPaperDays: 20,
  reconciliationRequired: false,
  gateFailCount: 0,
  riskPerTradeKrw: 300000, dailyLossLimitKrw: 500000,
  paperExpectancyLowerR: 0.2,
}

test('★ 관문 일곱이 설계 §2 그대로다', () => {
  assert.equal(ARM_CHECKS.length, 7)
  for (const c of ARM_CHECKS) assert.ok(ARM_CHECK_LABEL[c]?.length > 0, `${c} 에 이름이 없다`)
})

test('모의는 A1~A6 를 지나면 무장된다', () => {
  assert.deepEqual(checkArming(READY), { allowed: true })
})

test('★ 실계좌는 A7 이 더 필요하다 — 「돌려 봤다」와 「남았다」는 다르다', () => {
  const real: ArmContext = { ...READY, env: 'real' }
  assert.deepEqual(checkArming(real), { allowed: true })
  const noProfit = checkArming({ ...real, paperExpectancyLowerR: 0 })
  assert.equal(noProfit.allowed, false)
  assert.ok(noProfit.allowed === false
    && noProfit.blocks.some((b) => b.check === 'A7_paper_expectancy_positive'))
  // 모의는 A7 을 안 본다
  assert.equal(checkArming({ ...READY, paperExpectancyLowerR: null }).allowed, true)
})

test('★ 못 잰 실적은 「0 이상」이 아니라 막는다', () => {
  const r = checkArming({ ...READY, env: 'real', paperExpectancyLowerR: null })
  assert.equal(r.allowed, false)
  assert.equal(r.allowed === false && r.blocks[0].reason, 'no_paper_expectancy')
})

test('★ 막힌 것을 전부 준다 — 하나씩 주면 고치고 다시 걸리고를 반복한다', () => {
  const r = checkArming({
    ...READY, gatePassed: false, notifyEnabled: false, paperAutoDays: 0,
    reconciliationRequired: true, gateFailCount: 2, dailyLossLimitKrw: 0,
  })
  assert.equal(r.allowed, false)
  const checks = r.allowed === false ? r.blocks.map((b) => b.check) : []
  assert.equal(checks.length, 6, `막힌 것이 ${checks.length}개만 나왔다`)
})

test('관문마다 사람이 읽을 문장이 있다', () => {
  const r = checkArming({ ...READY, env: 'real', gatePassed: false, notifyEnabled: false,
    paperAutoDays: 1, reconciliationRequired: true, gateFailCount: 1,
    riskPerTradeKrw: 9999999, paperExpectancyLowerR: -1 })
  assert.equal(r.allowed, false)
  const seen = new Set(r.allowed === false ? r.blocks.map((b) => b.check) : [])
  assert.equal(seen.size, 7, '일곱이 다 안 걸렸다')
  if (r.allowed === false) {
    for (const b of r.blocks) assert.ok(b.userMessage.length > 5, `${b.check} 문장이 짧다`)
  }
})

test('★ 알림이 꺼져 있으면 무장 못 한다 — 무장은 사람을 대신하는 것이 아니다', () => {
  const r = checkArming({ ...READY, notifyEnabled: false })
  assert.equal(r.allowed, false)
  assert.ok(r.allowed === false
    && r.blocks.some((b) => b.userMessage.includes('사람이 신호를 보고 있어야')))
})

test('★ 1회 위험이 한도보다 크면 무장 못 한다', () => {
  assert.equal(checkArming({ ...READY, riskPerTradeKrw: 600000 }).allowed, false)
  // 한도가 0 이면 「무제한」이 아니라 막는다
  assert.equal(checkArming({ ...READY, dailyLossLimitKrw: 0 }).allowed, false)
})

// ── 무장 상태 ────────────────────────────────────────────

test('★ 만료가 지나면 armed 가 참이어도 무장이 아니다', () => {
  const armed = { armed: true, expiresAt: new Date(T0.getTime() + 1000), armedBy: 'u1' }
  assert.equal(isArmed(armed, T0), true)
  assert.equal(isArmed(armed, new Date(T0.getTime() + 2000)), false, '만료를 안 본다')
  // 경계는 만료 시각에 이미 끝난 것으로 본다. 애매하면 막는 쪽
  assert.equal(isArmed(armed, new Date(T0.getTime() + 1000)), false)
})

test('★ 누가 무장했는지 없으면 무장이 아니다', () => {
  assert.equal(isArmed({ armed: true, expiresAt: new Date(T0.getTime() + 9999), armedBy: null }, T0), false)
})

test('해제 상태는 만료와 무관하게 무장이 아니다', () => {
  assert.equal(isArmed({ armed: false, expiresAt: new Date(T0.getTime() + 9e9), armedBy: 'u1' }, T0), false)
})

test('★ 무장 시간에 상한이 있다 — 켜 놓고 잊는 일을 구조가 막는다', () => {
  assert.equal(DEFAULT_ARM_HOURS, 24)
  assert.equal(expiryFrom(T0, 1).getTime(), T0.getTime() + 3_600_000)
  // 상한을 넘겨 달라고 해도 상한까지만
  assert.equal(expiryFrom(T0, 9999).getTime(), T0.getTime() + DEFAULT_ARM_HOURS * 3_600_000)
  // 이상한 값도 상한으로
  for (const bad of [0, -1, Number.NaN]) {
    assert.equal(expiryFrom(T0, bad).getTime(), T0.getTime() + DEFAULT_ARM_HOURS * 3_600_000)
  }
})

test('★ 해제는 언제나 된다 — 켜는 쪽과 대칭이 아니다', () => {
  assert.deepEqual(mayDisarm(), { allowed: true })
  const src = readFileSync(join(HERE, 'arming-policy.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export function mayDisarm'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.equal(/ctx|gate|check|if /.test(body), false, '해제가 무언가를 본다')
  assert.equal(mayDisarm.length, 0, '해제가 인자를 받는다 — 인자가 생기면 조건이 생긴다')
})

test('화면이 왜 못 무장하는지를 말한다', () => {
  assert.equal(armingHint({ allowed: true }), '무장할 수 있습니다')
  const hint = armingHint(checkArming({ ...READY, notifyEnabled: false }))
  assert.ok(hint.includes('알림이 꺼져'))
})

test('★ 관문에 AI 나 DB 가 안 들어간다 — 순수 판정이라 조합을 다 시험할 수 있다', () => {
  const src = readFileSync(join(HERE, 'arming-policy.ts'), 'utf8')
  assert.equal(/callKnowledge|callGemini|createAdminClient|fetch\(/.test(src), false)
  assert.equal(src.includes("import 'server-only'"), false, 'server-only 가 붙었다')
})
