/**
 * 알림 아웃박스 — **실패해도 안 사라진다**
 *
 * 발송 실패로 행을 지우면 「알림이 안 왔다」와 「알림이 없었다」가 똑같아지고,
 * 사람은 신호가 없었다고 믿고 넘어간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NOTIFY_KINDS, KIND_PRIORITY, MAX_ATTEMPTS, backoffSecondsFor,
  decideSend, pickOrder, patchAfterSend, patchAfterFailure, failureStreak,
  type OutboxRow, type NotifyKind,
} from './outbox-policy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = new Date('2026-09-25T04:00:00Z')

function row(p: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'n1', kind: 'signal', status: 'pending', attempts: 0,
    queuedAt: T0, lastAttemptAt: null, ...p,
  }
}
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

test('★ 이미 보낸 것은 다시 안 보낸다 (§14.3)', () => {
  assert.deepEqual(decideSend(row({ status: 'sent' }), T0), { send: false, reason: 'already_sent' })
})

test('한 번도 안 보낸 것은 바로 보낸다', () => {
  assert.deepEqual(decideSend(row(), T0), { send: true })
})

test('★ 실패한 것도 다시 집는다 — 재시도는 sent 아닌 것만', () => {
  const failed = row({ status: 'failed', attempts: 1, lastAttemptAt: T0 })
  assert.equal(decideSend(failed, at(5)).send, true)
})

test('★ 매분 도는 크론이 상한 다섯을 5분에 안 태운다', () => {
  // 1회 실패 직후 = 30초 기다려야 한다
  const once = row({ status: 'failed', attempts: 1, lastAttemptAt: T0 })
  assert.deepEqual(decideSend(once, new Date(T0.getTime() + 10_000)), { send: false, reason: 'backing_off' })
  assert.equal(decideSend(once, new Date(T0.getTime() + 31_000)).send, true)

  // 4회 실패 뒤엔 30분을 기다린다 — 1분 크론이 여덟 번 지나가도 안 보낸다
  const four = row({ status: 'failed', attempts: 4, lastAttemptAt: T0 })
  assert.equal(decideSend(four, at(8)).send, false)
  assert.equal(decideSend(four, at(31)).send, true)
})

test('간격이 시도마다 늘고 마지막 값에서 멈춘다', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoffSecondsFor), [0, 30, 120, 600, 1800, 1800, 1800])
})

test('★ 상한을 넘으면 그만 보내되 **행은 남는다**', () => {
  const dead = row({ status: 'failed', attempts: MAX_ATTEMPTS, lastAttemptAt: T0 })
  assert.deepEqual(decideSend(dead, at(600)), { send: false, reason: 'too_many_attempts' })
  // 지우라는 신호가 아니다 — 정책에 삭제가 없다
  const src = readFileSync(join(HERE, 'outbox-policy.ts'), 'utf8')
  assert.equal(/\bdelete\b|\bdrop\b|\bpurge\b/i.test(src), false, '정책에 지우는 말이 있다')
})

// ── 순서 ────────────────────────────────────────────────

test('★ 손절가를 지난 알림이 신호 알림보다 먼저 나간다', () => {
  assert.ok(KIND_PRIORITY.protection_breached < KIND_PRIORITY.signal)
  const rows = [
    row({ id: 'sig', kind: 'signal', queuedAt: T0 }),
    row({ id: 'brk', kind: 'protection_breached', queuedAt: at(5) }),
    row({ id: 'safe', kind: 'safety', queuedAt: at(9) }),
  ]
  assert.deepEqual(pickOrder(rows, at(10)).map((r) => r.id), ['brk', 'safe', 'sig'])
})

test('같은 급이면 오래된 것 먼저 — 순서가 뒤집히면 읽는 사람이 헷갈린다', () => {
  const rows = [
    row({ id: 'new', kind: 'exit', queuedAt: at(5) }),
    row({ id: 'old', kind: 'exit', queuedAt: T0 }),
  ]
  assert.deepEqual(pickOrder(rows, at(10)).map((r) => r.id), ['old', 'new'])
})

test('집어 갈 목록에서 보낸 것과 쉬는 것이 빠진다', () => {
  const rows = [
    row({ id: 'sent', status: 'sent' }),
    row({ id: 'wait', status: 'failed', attempts: 3, lastAttemptAt: at(9) }),
    row({ id: 'go' }),
  ]
  assert.deepEqual(pickOrder(rows, at(10)).map((r) => r.id), ['go'])
})

test('모든 종류에 급이 있다 — 빠지면 정렬이 조용히 어긋난다', () => {
  for (const kind of NOTIFY_KINDS) {
    assert.equal(typeof KIND_PRIORITY[kind], 'number', `${kind} 에 급이 없다`)
  }
  assert.equal(new Set(Object.values(KIND_PRIORITY)).size, NOTIFY_KINDS.length, '급이 겹친다')
})

// ── 결과 적기 ────────────────────────────────────────────

test('보낸 뒤에 sent 와 시각 둘이 찍힌다', () => {
  const p = patchAfterSend(row({ attempts: 2 }), at(1))
  assert.equal(p.status, 'sent')
  assert.equal(p.attempts, 3)
  assert.deepEqual(p.sentAt, at(1))
  assert.deepEqual(p.lastAttemptAt, at(1))
  assert.equal(p.reason, null)
})

test('★ 못 보낸 뒤에 **사유가 남는다** — 조용히 안 지나간다', () => {
  const p = patchAfterFailure(row({ attempts: 1 }), 'push_endpoint_410', at(1))
  assert.equal(p.status, 'failed')
  assert.equal(p.attempts, 2)
  assert.equal(p.sentAt, null, '실패했는데 보낸 시각이 찍혔다')
  assert.deepEqual(p.lastAttemptAt, at(1))
  assert.match(p.reason ?? '', /push_endpoint_410/)
  assert.ok((p.userMessage ?? '').length > 0, '사람이 읽을 문장이 없다')
})

test('★ 상한을 채운 실패는 사람에게 다르게 말한다 — 「잠시 뒤 다시」는 거짓말이 된다', () => {
  const p = patchAfterFailure(row({ attempts: MAX_ATTEMPTS - 1 }), 'timeout', at(1))
  assert.match(p.reason ?? '', /재시도 상한/)
  assert.match(p.userMessage ?? '', /직접 확인/)
  assert.equal(/잠시 뒤 다시/.test(p.userMessage ?? ''), false)
})

test('연속 실패를 센다 (SG-06), sent 를 만나면 멈춘다', () => {
  assert.equal(failureStreak([
    row({ status: 'failed', attempts: 2 }),
    row({ status: 'failed', attempts: 1 }),
    row({ status: 'sent', attempts: 1 }),
    row({ status: 'failed', attempts: 3 }),
  ]), 2)
  // 아직 한 번도 안 보내 본 것은 실패가 아니다
  assert.equal(failureStreak([row({ status: 'pending', attempts: 0 })]), 0)
})

// ── 곁가지가 본 일을 죽이지 않는다 ─────────────────────────

test('★ 대기 표 넣기가 실패해도 던지지 않는다 — 신호 기록이 같이 죽는다', () => {
  const src = readFileSync(join(HERE, 'outbox.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function queueNotification'), src.indexOf('interface RawRow'))
  assert.ok(fn.includes('try {') && fn.includes('} catch'), 'queueNotification 이 감싸져 있지 않다')
  assert.equal(/\bthrow\b/.test(fn), false, 'queueNotification 이 던진다 — 신호 저장까지 실패로 만든다')
  assert.ok(fn.includes("reason: 'already_queued'"), '유일 키 충돌을 오류로 다룬다')
})

test('★ 대기 목록이 sent 를 아예 안 읽는다', () => {
  const src = readFileSync(join(HERE, 'outbox.ts'), 'utf8')
  assert.ok(src.includes(".neq('status', 'sent')"), '보낸 것을 걸러내는 질의가 없다')
})

test('종류 목록이 DB 검사 제약과 같다', () => {
  const sql = readFileSync(join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '282_trading_signals.sql'), 'utf8')
  for (const kind of NOTIFY_KINDS) {
    assert.ok(sql.includes(`'${kind}'`), `DB 제약에 ${kind} 가 없다`)
  }
  const inDb = (sql.match(/kind\s+TEXT\s+NOT NULL CHECK \(kind IN \(([\s\S]*?)\)\)/)?.[1] ?? '')
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  assert.deepEqual([...inDb].sort(), [...NOTIFY_KINDS].sort() as NotifyKind[])
})
