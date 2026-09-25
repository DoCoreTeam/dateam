/**
 * 무장 상태와 멈추는 장치 — **모르면 해제다**
 *
 * 읽기가 실패했을 때 돈이 나가는 쪽으로 기울면 안 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DISARM_TRIGGERS, DISARM_LABEL, shouldDisarm, mustDisarm, disarmReason, disarmCancelsOrders,
  type DisarmContext,
} from './disarm.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations')
const T0 = new Date('2026-09-25T04:00:00Z')

const HEALTHY: DisarmContext = {
  expiresAt: new Date(T0.getTime() + 3_600_000),
  now: T0,
  ordersToday: 3, maxOrdersPerDay: 12,
  orderFailureStreak: 0, maxOrderFailureStreak: 3,
  reconciliationRequired: false,
  protectionBreached: false,
}

test('★ 멈추는 장치 여섯이 설계 §6 그대로다', () => {
  assert.deepEqual([...DISARM_TRIGGERS], [
    'expired', 'daily_order_cap', 'order_failure_streak',
    'reconciliation_required', 'protection_breached', 'human',
  ])
  for (const t of DISARM_TRIGGERS) assert.ok(DISARM_LABEL[t]?.length > 0, `${t} 에 문장이 없다`)
})

test('멀쩡하면 안 푼다', () => {
  assert.deepEqual(shouldDisarm(HEALTHY), [])
  assert.equal(mustDisarm(HEALTHY), false)
})

test('★ 다섯 장치가 각각 푼다 (사람 해제는 화면에서)', () => {
  const cases: [string, Partial<DisarmContext>][] = [
    ['expired', { expiresAt: new Date(T0.getTime() - 1) }],
    ['daily_order_cap', { ordersToday: 12 }],
    ['order_failure_streak', { orderFailureStreak: 3 }],
    ['reconciliation_required', { reconciliationRequired: true }],
    ['protection_breached', { protectionBreached: true }],
  ]
  for (const [trigger, patch] of cases) {
    const hits = shouldDisarm({ ...HEALTHY, ...patch })
    assert.ok(hits.some((h) => h.trigger === trigger), `${trigger} 가 안 걸린다`)
    assert.equal(mustDisarm({ ...HEALTHY, ...patch }), true)
  }
})

test('★ 걸린 것을 전부 준다 — 하나만 주면 시간을 늘리면 되는 줄 안다', () => {
  const hits = shouldDisarm({
    ...HEALTHY, expiresAt: new Date(T0.getTime() - 1), reconciliationRequired: true,
  })
  assert.equal(hits.length, 2)
  assert.equal(disarmReason(hits), 'expired+reconciliation_required')
  assert.equal(disarmReason([]), 'none')
})

test('★ 만료 경계는 같은 순간에 이미 끝난 것으로 본다 — 애매하면 막는 쪽', () => {
  assert.equal(mustDisarm({ ...HEALTHY, expiresAt: T0 }), true)
  assert.equal(mustDisarm({ ...HEALTHY, expiresAt: new Date(T0.getTime() + 1) }), false)
})

test('상한이 0 이면 그 장치는 안 쓴다 — 0 을 「즉시 해제」로 읽지 않는다', () => {
  assert.equal(mustDisarm({ ...HEALTHY, maxOrdersPerDay: 0, ordersToday: 999 }), false)
  assert.equal(mustDisarm({ ...HEALTHY, maxOrderFailureStreak: 0, orderFailureStreak: 999 }), false)
})

test('★ 해제가 주문을 취소하지 않는다 — 「해제했더니 포지션이 반만 남았다」를 막는다', () => {
  assert.equal(disarmCancelsOrders(), false)
  const src = readFileSync(join(HERE, 'arming.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  /**
   * 함수 하나를 자를 때 `\n}` 로 끊으면 안 된다 — 중첩 괄호 때문에 어디서 끊길지 모른다.
   * 실측: `cancel_orders: true` 를 심었는데 이 시험이 초록이었다. 다음 `export` 까지 자른다
   */
  const start = src.indexOf('export async function disarm')
  const next = src.indexOf('\nexport ', start + 1)
  const body = src.slice(start, next > 0 ? next : src.length)
  assert.ok(body.includes('trading_arming'), '자른 자리가 해제 함수가 아니다')
  assert.equal(/order|cancel|rvsecncl/i.test(body), false, '해제가 주문을 건드린다')
})

// ── 무장 쓰기 ────────────────────────────────────────────

test('★ 행이 없으면 해제다 — 「모르니까 무장」이 없다', () => {
  const src = readFileSync(join(HERE, 'arming.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function readArming'))
  assert.ok(fn.includes('armed: false'), '행이 없을 때 해제로 안 읽는다')
  assert.ok(fn.includes("disarmReason: 'no_row'"), '왜 해제인지를 안 남긴다')
})

test('★ 무장에 사람 ID 가 필수다 (§15.3 실행 방식)', () => {
  const src = readFileSync(join(HERE, 'arming.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function arm('), src.indexOf('export async function disarm'))
  assert.ok(fn.includes('if (!input.actorUserId)'), '사람 없이 무장된다')
  assert.ok(fn.includes('armed_by: input.actorUserId'), '누가 무장했는지가 안 남는다')
  assert.ok(fn.includes('checkArming('), '관문을 안 지난다')
  // 관문을 지나기 전에 쓰지 않는다
  const gateAt = fn.indexOf('checkArming(')
  const writeAt = fn.indexOf(".from('trading_arming')")
  assert.ok(gateAt < writeAt, '관문보다 먼저 쓴다')
})

test('★ 해제는 사람 없이도 된다 — 장치가 푼다', () => {
  const src = readFileSync(join(HERE, 'arming.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function disarm'))
  assert.equal(/if \(!input\.actorUserId\)/.test(fn.slice(0, fn.indexOf('\n}'))), false,
    '해제가 사람을 요구한다 — 장치가 못 풀면 멈추는 장치가 무용지물이다')
  assert.ok(fn.includes("actorKind: input.actorUserId ? 'human' : 'system'"))
})

test('★ 해제가 만료도 과거로 민다 — 「무장 아님」이 두 겹으로 참이다', () => {
  const src = readFileSync(join(HERE, 'arming.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function disarm'))
  assert.ok(fn.includes('input.now.getTime() - 1000'), '만료를 안 민다')
})

test('★ 무장·해제가 전부 기록에 남는다', () => {
  const src = readFileSync(join(HERE, 'arming.ts'), 'utf8')
  for (const fnName of ['export async function arm(', 'export async function disarm']) {
    const fn = src.slice(src.indexOf(fnName))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    assert.ok(body.includes('logArmingEvent('), `${fnName} 가 기록을 안 남긴다`)
  }
})

test('★ DB 도 「무장은 사람만」을 지킨다 — 코드만으로 안 막는다', () => {
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes('trading_arming_events_only_human_arms'))
  assert.ok(sql.includes("CHECK (action = 'disarm' OR actor_kind = 'human')"))
  assert.ok(sql.includes('trading_arming_armed_has_actor'))
})

test('★ 배포 기본이 해제다 — 마이그레이션이 해제로 심는다', () => {
  const sql = readFileSync(join(MIGRATIONS, '287_trading_order.sql'), 'utf8')
  assert.ok(sql.includes("VALUES ('paper', FALSE, now() - interval '1 day'),"))
  assert.ok(sql.includes("('real',  FALSE, now() - interval '1 day')"))
  assert.ok(sql.includes('armed         BOOLEAN     NOT NULL DEFAULT FALSE'))
})

test('★ 매분 다시 잰다 — 무장할 때 한 번만 재면 하루 종일 멀쩡한 줄 안다', () => {
  const src = readFileSync(join(HERE, 'arming.ts'), 'utf8')
  assert.ok(src.includes('export async function enforceDisarm'), '다시 재는 자리가 없다')
  const fn = src.slice(src.indexOf('export async function enforceDisarm'))
  assert.ok(fn.includes('shouldDisarm(ctx)'))
  assert.ok(fn.includes('await disarm('), '걸려도 안 푼다')
})
