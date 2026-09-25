/**
 * 신호 발행 — **다섯을 다 지나야 신호다** (M2)
 *
 * 하나라도 건너뛰면 그 신호는 다른 것이 된다. 게이트를 건너뛰면 깨진 데이터에서 나온 신호,
 * 보정을 건너뛰면 확률이 아닌 숫자로 판단한 신호, 규칙을 건너뛰면 기대값이 음수여도 나가는 신호.
 * **그리고 셋은 화면에서 똑같이 보인다.**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideEmit, blockedSummary, stageIndex, EMIT_STAGES, type EmitInput } from './emit.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 다섯을 다 지나는 입력 */
const CLEAN: EmitInput = {
  gateHits: [],
  triggerFired: true,
  judgeCompleted: true,
  judgeAbstainReason: null,
  hasCalibration: true,
  ruleBlocks: [],
}

test('다섯을 다 지나면 신호가 나간다', () => {
  assert.deepEqual(decideEmit(CLEAN), { kind: 'signal' })
})

test('★ 순서가 값으로 못 박혀 있다', () => {
  assert.deepEqual([...EMIT_STAGES], ['safety_gate', 'trigger', 'judge', 'calibrate', 'signal_rules'])
})

test('★ 안전 게이트가 걸리면 거기서 멈춘다 — 뒤 단계를 아예 안 묻는다', () => {
  const out = decideEmit({
    ...CLEAN,
    gateHits: [{ id: 'SG-01', reason: 'bar_missing', userMessage: '봉이 빠졌습니다' }],
    // 규칙도 막혀 있지만 게이트가 먼저다
    ruleBlocks: [{ id: 'SR-01', reason: 'ev_low', userMessage: '기대값 부족' }],
  })
  assert.equal(out.kind, 'blocked')
  assert.equal(out.kind === 'blocked' && out.stage, 'safety_gate',
    '게이트가 걸렸는데 규칙 탓으로 말한다 — 사람이 전략을 고치려 든다, 고칠 것은 데이터인데')
  assert.equal(out.kind === 'blocked' && out.userMessage, '봉이 빠졌습니다')
})

test('진입 조건이 없으면 조건에서 멈춘다', () => {
  const out = decideEmit({ ...CLEAN, triggerFired: false })
  assert.equal(out.kind === 'blocked' && out.stage, 'trigger')
})

test('판단이 안 끝났으면 판단에서 멈추고 기권 사유를 싣는다', () => {
  const out = decideEmit({ ...CLEAN, judgeCompleted: false, judgeAbstainReason: 'timeout:10000ms' })
  assert.equal(out.kind === 'blocked' && out.stage, 'judge')
  assert.match(out.kind === 'blocked' ? out.reason : '', /timeout:10000ms/)
})

test('★ 보정이 없으면 보정 단계에서 멈춘다 (M3)', () => {
  const out = decideEmit({ ...CLEAN, hasCalibration: false })
  assert.equal(out.kind === 'blocked' && out.stage, 'calibrate')
  assert.ok(out.kind === 'blocked' && out.userMessage.includes('확률로 옮길 수 없'))
})

test('규칙에 막히면 규칙에서 멈춘다', () => {
  const out = decideEmit({
    ...CLEAN, ruleBlocks: [{ id: 'SR-09', reason: 'max_signals:6>=6', userMessage: '오늘 6건을 채웠습니다' }],
  })
  assert.equal(out.kind === 'blocked' && out.stage, 'signal_rules')
})

test('★ 막힌 단계가 순서대로 앞선다 — 뒤 단계가 앞 단계를 가리지 않는다', () => {
  const cases: [Partial<EmitInput>, number][] = [
    [{ gateHits: [{ id: 'SG-01', reason: 'x', userMessage: 'x' }] }, 0],
    [{ triggerFired: false }, 1],
    [{ judgeCompleted: false }, 2],
    [{ hasCalibration: false }, 3],
    [{ ruleBlocks: [{ id: 'SR-01', reason: 'x', userMessage: 'x' }] }, 4],
  ]
  for (const [patch, expected] of cases) {
    const out = decideEmit({ ...CLEAN, ...patch })
    assert.equal(out.kind, 'blocked')
    assert.equal(stageIndex(out.kind === 'blocked' ? out.stage : 'signal_rules'), expected)
  }
})

test('★ 안 나간 이유가 한 줄로 남는다 — 「신호 없음」만으로는 고칠 곳을 못 찾는다', () => {
  const out = decideEmit({ ...CLEAN, triggerFired: false })
  assert.equal(blockedSummary(out), 'trigger:no_trigger')
  assert.equal(blockedSummary({ kind: 'signal' }), 'signal')
})

// ── M2: 지름길이 없다 ────────────────────────────────────

test('★ 판단기에서 알림으로 가는 지름길이 없다 (M2)', () => {
  const judgeDir = join(HERE, '..', 'judge')
  for (const name of readdirSync(judgeDir)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    const src = readFileSync(join(judgeDir, name), 'utf8')
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    for (const pattern of [/notify|notification|outbox|saveSignal|emitSignal/i]) {
      assert.equal(pattern.test(body), false,
        `judge/${name} 이 알림이나 신호로 바로 간다 — 게이트와 규칙을 건너뛴다(M2)`)
    }
  }
})

test('★ 신호 저장이 게이트·규칙을 안 지나고 불리는 길이 없다', () => {
  const signalDir = HERE
  const emit = readFileSync(join(signalDir, 'emit.ts'), 'utf8')
  // 발행 판정이 다섯 단계를 전부 본다
  for (const field of ['gateHits', 'triggerFired', 'judgeCompleted', 'hasCalibration', 'ruleBlocks']) {
    assert.ok(emit.includes(`input.${field}`), `발행 판정이 ${field} 를 안 본다`)
  }
})
