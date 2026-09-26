/**
 * AI 운영자 배선 — **맨 뒤이고, 꺼진 채로 시작한다**
 *
 * 먼저 돌면 AI 가 느린 날 그 분의 수집과 판단이 밀리고, 밀린 봉은 다시 안 온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRADING_SETTINGS } from '../settings/registry.ts'
import { CHECK_IDS } from '../operator/checks.ts'
import { GATE_IDS } from '../gate/safety.ts'
import { CHECK_STATUS_LABEL } from '../operator-labels.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..', '..', '..', TRADING_APP_DIR)

test('★ 운영자가 tick 에서 맨 뒤에 불린다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const watchAt = tick.search(/const watch = await runWatch\(/)
  const emitAt = tick.search(/const emitNote = await emitOrExplain\(/)
  const knowAt = tick.search(/const knowledgeNote = await knowledgeOrExplain\(/)
  const opAt = tick.search(/const operatorNote = await operatorOrExplain\(/)
  assert.ok(watchAt > 0 && emitAt > 0 && knowAt > 0 && opAt > 0, '넷 중 하나가 안 불린다')
  assert.ok(watchAt < opAt, '운영자가 감시보다 먼저 돈다')
  assert.ok(emitAt < opAt, '운영자가 신호 발행보다 먼저 돈다')
  assert.ok(knowAt < opAt, '운영자가 지식보다 먼저 돈다')
})

test('★ 운영자가 실패해도 앞의 일이 산다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const fn = tick.slice(tick.indexOf('async function operatorOrExplain'))
  assert.ok(fn.includes('try {') && fn.includes('} catch'), '감싸져 있지 않다')
  assert.ok(fn.includes('operator_failed:'), '실패 사유를 안 남긴다')
})

test('★ 모르는 값을 0 으로 넘기지 않는다 — 0 이면 점검이 「괜찮다」로 읽는다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const fn = tick.slice(tick.indexOf('async function operatorOrExplain'))
  const block = fn.slice(fn.indexOf('measurements: {'), fn.indexOf('},', fn.indexOf('measurements: {')))
  const zeros = [...block.matchAll(/(\w+):\s*0\b/g)].map((m) => m[1])
  assert.deepEqual(zeros, [], `모르는 값을 0 으로 넘긴다: ${zeros.join(', ')}`)
  assert.ok(block.includes('null'), '값을 하나도 안 넘긴다')
})

test('★ 꺼진 채로 시작한다 — 운영자와 야간 둘 다', () => {
  for (const key of ['operator_enabled', 'night_signal_enabled']) {
    const row = TRADING_SETTINGS.find((s) => s.key === key)
    assert.ok(row, `${key} 설정이 없다`)
    assert.equal(row.defaultValue, false, `${key} 가 켜진 채로 배포된다`)
  }
})

test('★ 운영자가 꺼져 있으면 아무것도 안 한다', () => {
  const src = readFileSync(join(HERE, 'operator-job.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function runOperatorJob'))
  assert.ok(fn.includes("if (values.operator_enabled !== true)"), '꺼짐을 안 본다')
  const offAt = fn.indexOf("values.operator_enabled !== true")
  const checkAt = fn.indexOf('runChecks(')
  assert.ok(offAt < checkAt, '꺼짐을 보기 전에 점검을 돈다')
})

test('★ 조치는 한 실행에 하나만 — 여덟을 다 고치면 50초를 넘는다', () => {
  const src = readFileSync(join(HERE, 'operator-job.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function runOperatorJob'))
  assert.ok(fn.includes('remedyOne(tradeDate, attention[0]'), '가장 급한 하나만 안 고른다')
  assert.equal(/for \(const .* of attention\)/.test(fn), false, '전부 돌면서 고친다')
})

test('★ 야간이어도 게이트를 안 줄인다', () => {
  const src = readFileSync(join(HERE, 'operator-job.ts'), 'utf8')
  assert.ok(src.includes('nightRunsAllGates()'), '야간 판정을 한 곳에서 안 묻는다')
  assert.ok(src.includes('GATES_REDUCED'), '줄어든 사실을 기록에 안 남긴다')
  // 열둘이 그대로다
  assert.equal(GATE_IDS.length, 12)
})

test('★ 야간 봉이 설정이 정한 거래일에 속한다 (§6.3)', () => {
  const src = readFileSync(join(HERE, 'operator-job.ts'), 'utf8')
  assert.ok(src.includes('nightTradeDateOf('), '야간 거래일을 안 정한다')
  assert.ok(src.includes('values.night_trade_date_rule'), '규칙을 설정에서 안 읽는다')
})

test('★ 승인 수준이면 AI 가 안 하고 사람에게 넘긴다', () => {
  const src = readFileSync(join(HERE, 'operator-job.ts'), 'utf8')
  const fn = src.slice(src.indexOf('async function remedyOne'))
  assert.ok(fn.includes('gate.needsApproval'), '승인 수준을 안 본다')
  const approvalAt = fn.indexOf('gate.needsApproval')
  const applyAt = fn.indexOf('applyRemedy(')
  assert.ok(approvalAt < applyAt, '승인을 보기 전에 조치한다')
})

test('★ 소유자를 모르면 못 넘기고 그 사실을 남긴다', () => {
  const src = readFileSync(join(HERE, 'operator-job.ts'), 'utf8')
  assert.ok(src.includes("return ',handoff=no_owner'"), '소유자 없음을 조용히 넘긴다')
})

// ── 화면 ────────────────────────────────────────────────

test('★ 점검 여덟에 화면 이름이 있다', () => {
  for (const s of ['ok', 'warn', 'fail', 'unknown']) {
    assert.ok(CHECK_STATUS_LABEL[s]?.length > 0, `${s} 에 이름이 없다`)
  }
  assert.equal(CHECK_STATUS_LABEL.unknown, '모름', 'unknown 을 「괜찮다」 쪽으로 옮겼다')
  assert.ok(CHECK_IDS.length === 8)
})

test('★ 기본이 자동인 항목이 있으면 화면이 먼저 말한다', () => {
  const src = readFileSync(join(APP, 'OperatorPanel.tsx'), 'utf8')
  assert.ok(src.includes('operator.autoByDefault'), '자동 기본값을 안 알린다')
  assert.ok(src.includes('아무도 고르지 않은 값으로 AI 가 일합니다'))
  assert.ok(src.includes('operator.levelsOutOfSync'), '안 그린 항목이 있어도 말 안 한다')
})

test('★ 야간 끄기는 관문과 무관하게 눌린다', () => {
  const src = readFileSync(join(APP, 'OperatorPanel.tsx'), 'utf8')
  const off = src.slice(src.indexOf('야간 신호 끄기') - 300, src.indexOf('야간 신호 끄기'))
  assert.equal(/canEnable/.test(off), false, '끄기 단추가 관문을 본다')
})

test('★ 야간 켜기 창구가 소유자 확인을 지나고 관문 판정을 부른다', () => {
  const src = readFileSync(join(APP, 'actions.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function setNightSignalEnabled'))
  assert.ok(fn.includes('tradingAccess()'), '소유자 확인을 안 지난다')
  assert.ok(/decideToggleNight\s*\(/.test(fn), '관문 판정을 안 부른다')
  const gateAt = fn.indexOf('tradingAccess()')
  const saveAt = fn.indexOf('saveTradingSetting(')
  assert.ok(gateAt < saveAt, '확인보다 먼저 저장한다')
})

test('★ 새 창구를 안 연다 — 서버 액션뿐이고 API 라우트는 그대로다', () => {
  const src = readFileSync(join(APP, 'actions.ts'), 'utf8')
  assert.ok(src.startsWith("'use server'"), '서버 액션 파일이 아니다')
})
