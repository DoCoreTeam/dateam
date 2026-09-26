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
import { emitProgressOf, isSignalActionable, isDayComplete, missingCount, jevStatusOf, type SignalRow } from './overview-shape.ts'
import { JEV_OFF_REASON_LABEL, JEV_OFF_REMEDY_LABEL } from './jev-labels.ts'
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

/**
 * **Jev 가 꺼져 있다는 사실이 화면에 있다**
 *
 * 실측 2026-09-27: 판단 0건·Jev 꺼짐이었고 화면 어디에도 그 사실이 없었다.
 * 「아직 아무 일도 없다」와 「사람이 값을 넣어야 시작된다」가 같은 빈 화면으로 보였다.
 * 앞의 것은 기다리면 풀리고 뒤의 것은 안 풀린다.
 */
test('★ 모델이 비면 모델 없음이다 — 키를 먼저 보지 않는다', () => {
  // 부르는 쪽(jobs/tick.ts)이 모델을 먼저 본다. 화면이 키를 먼저 보면 둘 다 없을 때
  // 실행 기록은 jev_model_not_set 이라 적고 화면은 키를 등록하라고 말한다
  assert.deepEqual(jevStatusOf({ model: '', keyReason: 'no_key' }),
    { on: false, reason: 'model_missing' })
  assert.deepEqual(jevStatusOf({ model: '   ', keyReason: 'pool' }),
    { on: false, reason: 'model_missing' })
})

test('★ 모델은 있는데 키가 없으면 그 둘을 갈라 말한다', () => {
  assert.deepEqual(jevStatusOf({ model: 'some-model', keyReason: 'no_key' }),
    { on: false, reason: 'key_missing' })
  // 「키가 없다」와 「판이 달라 안 쓴다」는 조치가 다르다
  assert.deepEqual(jevStatusOf({ model: 'some-model', keyReason: 'env_blocked' }),
    { on: false, reason: 'env_blocked' })
})

test('★ 켜져 있으면 이유가 없다 — 화면이 그 자리를 아예 안 그린다', () => {
  for (const keyReason of ['pool', 'meta'] as const) {
    assert.deepEqual(jevStatusOf({ model: 'some-model', keyReason }), { on: true, reason: null })
  }
  const panel = readFileSync(join(APP, 'JevPanel.tsx'), 'utf8')
  assert.ok(panel.includes('if (jev.on || !jev.reason) return null'),
    '켜져 있어도 경고가 남는다 — 늘 떠 있는 알림은 배경이 된다')
})

test('★ 꺼진 이유마다 무엇을 하면 되는지 말한다', () => {
  for (const reason of ['model_missing', 'key_missing', 'env_blocked'] as const) {
    assert.ok(JEV_OFF_REASON_LABEL[reason], `${reason} 의 사유가 없다`)
    assert.ok(JEV_OFF_REMEDY_LABEL[reason], `${reason} 에 할 일이 없다`)
  }
  // 라벨 표는 화면 밖에 있다 (lib/ui/glossary.test.ts 와 같은 이유)
  const panel = readFileSync(join(APP, 'JevPanel.tsx'), 'utf8')
  assert.ok(panel.includes("from '@/lib/trading/jev-labels'"), '말을 화면 안에서 짓는다')
})

/**
 * **키 값이 화면 데이터로 흘러가지 않는다** (S3)
 *
 * 형에 키가 들어갈 자리가 있으면 언젠가 채워진다. 있는지 없는지만 옮긴다.
 */
test('★ 키 원문이 화면으로 가는 길이 없다', () => {
  const overview = readFileSync(join(HERE, 'overview.ts'), 'utf8')
  const fn = overview.slice(overview.indexOf('async function loadJevStatus'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.equal(/apiKey/.test(body), false, '키 값을 만진다 — 화면 데이터로 샐 수 있다')
  assert.ok(body.includes('choice.reason'), '사유만 옮기지 않는다')

  const shape = readFileSync(join(HERE, 'overview-shape.ts'), 'utf8')
  const iface = shape.slice(shape.indexOf('export interface JevStatus'))
  assert.equal(/key|apiKey/i.test(iface.slice(0, iface.indexOf('}'))), false,
    '화면 형에 키 자리가 있다')
})
