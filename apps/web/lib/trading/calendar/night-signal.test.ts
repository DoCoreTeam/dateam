/**
 * 야간장 신호 — **꺼진 채로 시작하고, 야간 표본으로 통과해야 켜진다**
 *
 * 정규장에서 통과한 관문은 정규장 표본으로 통과한 것이다.
 * 그 통과를 야간에 그대로 쓰면 재 본 적 없는 장에서 돈이 나간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mayEmitNightSignal, nightTradeDateOf, nightRunsAllGates, inNightWindow, decideToggleNight,
  type NightSignalContext,
} from './night-signal.ts'
import { GATE_IDS } from '../gate/safety.ts'
import { TRADING_SETTINGS } from '../settings/registry.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRADING = join(HERE, '..')

const READY: NightSignalContext = {
  enabled: true, nightGatePassed: true, nightShadowDays: 5, requiredShadowDays: 5, isNight: true,
}

test('전부 갖추면 야간 신호가 나간다', () => {
  assert.deepEqual(mayEmitNightSignal(READY), { allowed: true })
})

test('★ 기본이 꺼짐이다 — 레지스트리 기본값으로 확인', () => {
  const row = TRADING_SETTINGS.find((s) => s.key === 'night_signal_enabled')
  assert.ok(row, 'night_signal_enabled 설정이 없다')
  assert.equal(row.defaultValue, false, '야간 신호가 켜진 채로 배포된다')
})

test('★ 꺼져 있으면 안 나간다', () => {
  const r = mayEmitNightSignal({ ...READY, enabled: false })
  assert.equal(r.allowed === false && r.reason, 'night_signal_off')
})

test('★ 정규장 통과를 야간에 쓰지 않는다 — 야간 관문이 따로다', () => {
  const r = mayEmitNightSignal({ ...READY, nightGatePassed: false })
  assert.equal(r.allowed, false)
  assert.equal(r.allowed === false && r.reason, 'night_gate_not_passed')
  assert.ok(r.allowed === false && r.userMessage.includes('정규장 통과는 야간에 쓰지 않습니다'))
})

test('★ 야간 섀도가 모자라면 안 나간다', () => {
  const r = mayEmitNightSignal({ ...READY, nightShadowDays: 3 })
  assert.equal(r.allowed === false && r.reason, 'not_enough_night_shadow:3')
  assert.match(r.allowed === false ? r.userMessage : '', /3일.*5일/)
})

test('낮에 이 판정을 물으면 막는다 — 부르는 쪽이 잘못 물은 것이다', () => {
  assert.equal(mayEmitNightSignal({ ...READY, isNight: false }).allowed, false)
})

test('★ 끄는 것은 언제나 된다 — 야간에 문제가 생긴 날 끄지도 못하면 안 된다', () => {
  const broken = { nightGatePassed: false, nightShadowDays: 0, requiredShadowDays: 5 }
  assert.deepEqual(decideToggleNight(false, broken), { allowed: true })
  assert.equal(decideToggleNight(true, broken).allowed, false)
})

// ── 거래일 귀속 (§6.3) ───────────────────────────────────

test('★ 야간 거래일 규칙이 설정에서 온다 — 코드에 박으면 바뀐 날 집계가 두 갈래가 된다', () => {
  assert.equal(nightTradeDateOf('2026-09-25', 'next'), '2026-09-26')
  assert.equal(nightTradeDateOf('2026-09-25', 'same'), '2026-09-25')
  const row = TRADING_SETTINGS.find((s) => s.key === 'night_trade_date_rule')
  assert.ok(row, '야간 거래일 규칙이 설정에 없다')
})

test('야간 시간 판정을 한 곳으로 모은다', () => {
  // 18:00 KST 이후, 06:00 이전
  assert.equal(inNightWindow(new Date('2026-09-25T10:00:00Z')), true)   // 19:00 KST
  assert.equal(inNightWindow(new Date('2026-09-25T04:00:00Z')), false)  // 13:00 KST
})

// ── 야간 전용 우회가 없다 ────────────────────────────────

test('★ 야간에도 게이트를 그대로 돌린다', () => {
  assert.equal(nightRunsAllGates(), true)
})

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

test('★ 게이트·신호 코드에 「야간이니까 건너뛴다」가 0개다', () => {
  const offenders: string[] = []
  for (const file of [...walk(join(TRADING, 'gate')), ...walk(join(TRADING, 'signal'))]) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    // 야간을 조건으로 게이트를 건너뛰는 자리
    if (/isNight|night/i.test(src)) offenders.push(relative(TRADING, file))
  }
  assert.deepEqual(offenders, [],
    `게이트·신호가 야간을 따로 본다 — 「야간이니까」는 한 번 열면 늘어나기만 한다:\n  ${offenders.join('\n  ')}`)
})

test('★ 안전 게이트 열둘이 목록에 그대로 있다 — 야간용으로 줄인 판이 없다', () => {
  assert.equal(GATE_IDS.length, 12)
  for (let i = 1; i <= 12; i += 1) {
    assert.ok(GATE_IDS.includes(`SG-${String(i).padStart(2, '0')}` as never), `SG-${i} 가 없다`)
  }
})

test('★ 야간 판정이 게이트를 대신하지 않는다 — 통과해도 게이트는 따로 돈다', () => {
  const src = readFileSync(join(HERE, 'night-signal.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const banned of ['checkSafetyGates', 'newSignalAllowed', 'GateHit', 'decideEmit']) {
    assert.equal(src.includes(banned), false,
      `야간 판정이 ${banned} 를 만진다 — 게이트를 대신하려 든다`)
  }
})
