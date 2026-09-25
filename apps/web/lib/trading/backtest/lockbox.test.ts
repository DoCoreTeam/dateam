/**
 * Lockbox — **한 번만 연다**
 *
 * 최종 검증 구간을 여러 번 보면 그 구간도 개발 구간이 된다. 「이번엔 안 좋으니
 * 조건을 조금 고쳐서 다시」를 세 번만 해도 그 성적은 그 자료에 맞춰진 것이고,
 * 마지막 확인이라는 뜻을 잃는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canOpenLockbox, canReadLockbox, windowMatches, type LockboxRecord,
} from './lockbox-policy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HUMAN = { kind: 'human' as const, userId: '11111111-1111-4111-8111-111111111111' }
const AI = { kind: 'ai' as const, agent: 'trading-operator' }
const REASON = '관문 판정 직전 마지막 확인'

const opened: LockboxRecord = {
  name: 'release-1b', windowFrom: '2026-08-01', windowTo: '2026-09-30',
  openedAt: '2026-09-20T05:00:00.000Z', openedBy: HUMAN.userId, reason: REASON,
}

test('사람이 사유를 적으면 열 수 있다', () => {
  assert.deepEqual(canOpenLockbox(HUMAN, null, REASON), { allowed: true })
})

test('★ AI 는 못 연다 — 되돌릴 수 없는 결정이다 (§15.3)', () => {
  const decision = canOpenLockbox(AI, null, REASON)
  assert.equal(decision.allowed, false)
  assert.match(decision.allowed === false ? decision.reason : '', /^not_human:/)
  assert.ok(decision.allowed === false && decision.userMessage.includes('사람만'))
})

test('★ 두 번째 열기는 거부하고 언제 열었는지를 말한다', () => {
  const decision = canOpenLockbox(HUMAN, opened, REASON)
  assert.equal(decision.allowed, false)
  assert.equal(decision.allowed === false && decision.reason, `already_opened:${opened.openedAt}`)
  assert.ok(decision.allowed === false && decision.userMessage.includes(opened.openedAt),
    '언제 열었는지가 문장에 없으면 찾으러 가야 한다')
})

test('사유가 없으면 안 연다 — 한 번뿐인 결정에 이유가 없을 수 없다', () => {
  assert.equal(canOpenLockbox(HUMAN, null, '').allowed, false)
  assert.equal(canOpenLockbox(HUMAN, null, '   ').allowed, false)
  assert.equal(canOpenLockbox(HUMAN, null, '확인').allowed, false)
})

test('★ 열기 전에는 못 읽는다 — 살짝만 보고가 가능하면 규칙은 말뿐이다', () => {
  const blocked = canReadLockbox(null)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.allowed === false && blocked.reason, 'not_opened')
  assert.deepEqual(canReadLockbox(opened), { allowed: true })
})

test('★ 연 뒤에 구간을 바꾸면 그것은 마지막 확인이 아니다', () => {
  assert.equal(windowMatches(opened, '2026-08-01', '2026-09-30'), true)
  assert.equal(windowMatches(opened, '2026-07-01', '2026-09-30'), false)
  assert.equal(windowMatches(opened, '2026-08-01', '2026-10-31'), false)
})

test('★ 「한 번만」이 코드가 아니라 DB 유일 키로 지켜진다', () => {
  const migration = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '281_trading_validation.sql'),
    'utf8',
  )
  assert.match(migration, /trading_lockbox_opens[\s\S]*name\s+TEXT\s+PRIMARY KEY/,
    '이름이 유일 키가 아니면 두 번째 INSERT 가 들어간다')
  // 여는 사람이 반드시 있어야 한다
  assert.match(migration, /opened_by\s+UUID\s+NOT NULL/, '누가 열었는지 없이도 열린다')
})

test('★ 서버 배선이 정책을 지난다 — 우회하는 길이 없다', () => {
  const src = readFileSync(join(HERE, 'lockbox.ts'), 'utf8')
  assert.match(src, /canOpenLockbox\(/, '열기가 정책을 안 지난다')
  assert.match(src, /canReadLockbox\(/, '읽기가 정책을 안 지난다')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.doesNotMatch(body, /\.upsert\(/, 'upsert 는 이미 열린 기록을 덮는다')
  assert.doesNotMatch(body, /\.delete\(/, '연 기록을 지울 수 있으면 한 번만이 아니다')
})
