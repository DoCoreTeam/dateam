/**
 * 자동 청산 — **진입을 자동으로 하면 청산도 자동이다**
 *
 * 진입을 시스템이 하고 청산을 사람이 하면, 사람이 자리를 비운 사이에 들어간 포지션이 생긴다.
 * 사람은 자기가 안 낸 주문의 청산을 지켜야 하고, 못 지키면 그것이 가장 위험하다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXIT_TRIGGERS, EXIT_LABEL, TRIGGER_PRIORITY,
  hitExits, chooseExit, shouldExit, entryAndExitArmTogether, exitOrderKind,
  type ExitContext,
} from './exit-plan.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = new Date('2026-09-25T04:00:00Z')

const LONG: ExitContext = {
  direction: 'long',
  stopPrice: 299, targetPrice: 303,
  barHigh: 301.5, barLow: 300.5,
  minutesHeld: 5, timeExitMinutes: 15,
  now: T0, sameDayExitAt: new Date(T0.getTime() + 3_600_000),
}

test('★ 청산 계기 넷이 설계 §5 그대로다', () => {
  assert.deepEqual([...EXIT_TRIGGERS], ['stop', 'target', 'time', 'session_close'])
  for (const t of EXIT_TRIGGERS) assert.ok(EXIT_LABEL[t]?.length > 0)
})

test('아무 계기도 안 닿으면 청산 안 한다', () => {
  assert.deepEqual(hitExits(LONG), [])
  assert.equal(shouldExit(LONG), null)
})

test('★ 종가가 아니라 봉의 범위로 본다 — 종가만 보면 지났다 돌아온 날을 놓친다', () => {
  // 저가가 손절을 찍고 올라온 봉
  const touched = hitExits({ ...LONG, barLow: 298.5, barHigh: 301 })
  assert.ok(touched.some((h) => h.trigger === 'stop'))
})

test('★ 매도는 방향이 뒤집힌다 — 안 뒤집으면 반대 계기를 잡는다', () => {
  const short: ExitContext = { ...LONG, direction: 'short', stopPrice: 302, targetPrice: 298 }
  // 고가가 손절을 넘었다
  assert.ok(hitExits({ ...short, barHigh: 302.5 }).some((h) => h.trigger === 'stop'))
  // 저가가 목표에 닿았다
  assert.ok(hitExits({ ...short, barLow: 297.5 }).some((h) => h.trigger === 'target'))
  // 매수 기준으로 보면 안 걸린다 — 뒤집지 않으면 이것이 통과한다
  assert.equal(hitExits({ ...short, barHigh: 300, barLow: 300 }).length, 0)
})

test('시간 청산과 당일 청산', () => {
  assert.ok(hitExits({ ...LONG, minutesHeld: 15 }).some((h) => h.trigger === 'time'))
  assert.equal(hitExits({ ...LONG, minutesHeld: 14 }).some((h) => h.trigger === 'time'), false)
  // 설정이 0 이면 시간 청산을 안 쓴다
  assert.equal(hitExits({ ...LONG, timeExitMinutes: 0, minutesHeld: 999 }).some((h) => h.trigger === 'time'), false)
  assert.ok(hitExits({ ...LONG, sameDayExitAt: T0 }).some((h) => h.trigger === 'session_close'))
})

test('★ 겹치면 가장 보수적인 쪽 — 손절이 목표를 이긴다', () => {
  // 같은 봉에서 손절과 목표가 둘 다 닿았다. 어느 쪽이 먼저였는지 1분 봉으로는 모른다
  const both = hitExits({ ...LONG, barLow: 298, barHigh: 304 })
  assert.equal(both.length, 2)
  assert.equal(chooseExit(both)?.trigger, 'stop', '모르는 것을 유리하게 읽었다')
})

test('★ 보수적인 순서가 정해져 있다', () => {
  assert.deepEqual([...TRIGGER_PRIORITY], ['stop', 'session_close', 'time', 'target'])
  // 넷이 다 목록에 있다. 빠지면 그 계기는 영영 안 골린다
  for (const t of EXIT_TRIGGERS) assert.ok(TRIGGER_PRIORITY.includes(t), `${t} 가 순서에 없다`)
})

test('★ 목록에 없는 계기는 안 고른다 — 「아무거나 하나」가 되면 그 아무거나가 목표일 수 있다', () => {
  const unknown = [{ trigger: 'made_up' as never, reason: 'x', userMessage: 'x' }]
  assert.equal(chooseExit(unknown), null)
})

test('당일 청산이 시간 청산보다 앞이다 — 장이 닫히면 시간이 남아도 나가야 한다', () => {
  const both = hitExits({ ...LONG, minutesHeld: 20, sameDayExitAt: T0 })
  assert.equal(chooseExit(both)?.trigger, 'session_close')
})

// ── 진입과 청산이 함께 켜진다 ────────────────────────────

test('★ 진입만 자동으로 켤 수 없다', () => {
  assert.equal(entryAndExitArmTogether(), true)
  const src = readFileSync(join(HERE, 'arming-policy.ts'), 'utf8')
  // 무장 관문에 「진입만」·「청산만」 같은 갈래가 없다
  assert.equal(/entryOnly|exitOnly|armEntry|armExit/i.test(src), false,
    '무장이 진입과 청산을 나눠 켤 수 있다')
})

test('★ 청산 주문도 같은 멱등 키를 지난다', () => {
  assert.equal(exitOrderKind(), 'exit')
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes("order_kind    TEXT        NOT NULL CHECK (order_kind IN ('entry', 'exit'))"))
  assert.ok(sql.includes('UNIQUE (signal_id, order_kind)'))
})

test('★ 계기 판정에 AI 나 DB 가 안 들어간다 — 조합을 다 시험할 수 있어야 한다', () => {
  const src = readFileSync(join(HERE, 'exit-plan.ts'), 'utf8')
  assert.equal(/callKnowledge|callGemini|createAdminClient|fetch\(/.test(src), false)
  assert.equal(src.includes("import 'server-only'"), false)
})
