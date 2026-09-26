/**
 * 화면이 보는 꼴 — **「신호 없음」만으로는 고칠 곳을 못 찾는다**
 *
 * 마지막 실행이 다섯 단계 중 어디서 멈췄는지를 화면이 말해야 한다.
 * 안 말하면 사람은 전략을 의심하는데, 실제로는 보정 모델이 없어서 네 번째에서 멈춘 것이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitProgressOf, isSignalActionable, isDayComplete, missingCount, type SignalRow } from './overview-shape.ts'
import { EMIT_STAGES } from './signal/emit.ts'
import { TRADING_APP_DIR } from '../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..', '..', TRADING_APP_DIR)

test('★ 멈춘 단계를 실행 사유에서 읽는다', () => {
  const p = emitProgressOf('judged|watch=none|emit:calibrate:no_calibration')
  assert.ok(p)
  assert.equal(p.stage, 'calibrate')
  assert.equal(p.step, 4)
  assert.equal(p.total, 5)
  assert.equal(p.reason, 'no_calibration')
})

test('단계마다 번호가 §M2 순서와 같다', () => {
  for (const [i, stage] of EMIT_STAGES.entries()) {
    const p = emitProgressOf(`emit:${stage}:why`)
    assert.ok(p, stage)
    assert.equal(p.step, i + 1, stage)
  }
})

test('신호가 나갔으면 멈춘 단계가 없다', () => {
  assert.equal(emitProgressOf('judged|emit:signal'), null)
  assert.equal(emitProgressOf('judged'), null)
  assert.equal(emitProgressOf(null), null)
  assert.equal(emitProgressOf(''), null)
})

test('★ 모르는 사유를 억지로 단계로 읽지 않는다', () => {
  assert.equal(emitProgressOf('emit:something_new'), null)
  assert.equal(emitProgressOf('emit_failed:boom'), null)
})

// ── 지나간 신호에 단추를 안 그린다 ────────────────────────

const SIG: SignalRow = {
  id: 's1', contractCode: '101W12', direction: 'long',
  referencePrice: 300, stopPrice: 299, targetPrice: 302,
  barCloseAt: '2026-09-25T04:00:00.000Z',
  notifySentAt: null, openedAt: null, ackAt: null, orderAt: null, fillAt: null,
  result: null, userReportedStop: null, calibratedProb: null,
}
const at = (m: number) => new Date(Date.parse(SIG.barCloseAt) + m * 60_000)

test('★ 유효 시간 안이고 결과가 없으면 단추를 그린다', () => {
  assert.equal(isSignalActionable(SIG, at(5), 10), true)
  assert.equal(isSignalActionable(SIG, at(10), 10), true)
  assert.equal(isSignalActionable(SIG, at(11), 10), false)
})

test('★ 결과가 적힌 신호에는 단추가 없다 — 눌러도 되는 줄 알게 된다', () => {
  assert.equal(isSignalActionable({ ...SIG, result: 'skipped' }, at(1), 10), false)
  assert.equal(isSignalActionable({ ...SIG, result: 'followed' }, at(1), 10), false)
})

test('수집 완결과 결측 셈', () => {
  const day = { tradeDate: '2026-09-25', expected: 380, actual: 380, unknown: false, sameDayExitAt: null }
  assert.equal(isDayComplete(day), true)
  assert.equal(missingCount({ ...day, actual: 370 }), 10)
  // 셀 수 없는 날을 「결측 0」으로 말하지 않는다 — 완결도 아니다
  assert.equal(isDayComplete({ ...day, unknown: true }), false)
})

// ── 화면 배선 ────────────────────────────────────────────

test('★ 지연 화면이 못 잰 건수를 같이 그린다 — 안 그리면 두 건짜리 중앙값이 같아 보인다', () => {
  const src = readFileSync(join(APP, 'LatencyPanel.tsx'), 'utf8')
  assert.ok(src.includes('unmeasured'), '못 잼 건수를 안 그린다')
  assert.ok(src.includes('못 잼'), '못 잰 값을 0 으로 그린다')
})

test('★ 알림 켜기 창구가 기존 소유자 확인을 지난다 (S2)', () => {
  const src = readFileSync(join(APP, 'actions.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function setNotifyEnabled'))
  assert.ok(fn.includes('tradingAccess()'), '소유자 확인을 안 지난다')
  assert.ok(fn.includes('decideEnableNotify'), '관문 판정을 안 부른다')
  assert.ok(fn.includes('decideDisableNotify'), '끄기 판정을 안 부른다')
})

test('★ 켜고 끈 일이 사유와 함께 저장된다', () => {
  const src = readFileSync(join(APP, 'actions.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function setNotifyEnabled'))
  assert.ok(fn.includes('auditLine('), '기록 문장을 안 만든다')
  assert.ok(fn.includes('reason: auditLine('), '기록 문장을 저장에 안 싣는다')
  assert.ok(fn.includes('changedBy: user.id'), '누가 했는지를 안 적는다')
})

test('★ 못 켤 때 왜 못 켜는지가 단추에 붙는다 — 흐린 단추는 이유를 안 말한다', () => {
  const src = readFileSync(join(APP, 'NotifyPanel.tsx'), 'utf8')
  assert.ok(src.includes('notify.hint'), '이유를 안 그린다')
  assert.ok(src.includes('title={notify.canEnable ? undefined : notify.hint}'), '흐린 단추에 이유가 없다')
})

test('★ 끄기 단추는 관문과 무관하게 눌린다', () => {
  const src = readFileSync(join(APP, 'NotifyPanel.tsx'), 'utf8')
  const off = src.slice(src.indexOf('알림 끄기') - 400, src.indexOf('알림 끄기'))
  assert.equal(/canEnable/.test(off), false, '끄기 단추가 관문을 본다')
})
