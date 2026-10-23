import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gateLogin, normalizeLoginEmail, EMAIL_LIMIT, ORIGIN_LIMIT, UNAVAILABLE_RETRY_SECONDS,
  type HitRecorder, type HitResult,
} from './login-gate.ts'

const NOW = 1_800_000_000_000

/** 바구니별 횟수를 메모리로 센다 */
function counter(): { record: HitRecorder; seen: string[] } {
  const hits = new Map<string, number>()
  const seen: string[] = []
  const record: HitRecorder = async (key, identifier) => {
    const k = `${key}:${identifier}`
    seen.push(k)
    hits.set(k, (hits.get(k) ?? 0) + 1)
    return { ok: true, hits: hits.get(k)!, windowStartMs: NOW }
  }
  return { record, seen }
}

test('한도 안이면 통과한다', async () => {
  const { record } = counter()
  assert.deepEqual(await gateLogin(record, '1.1.1.1', 'a@x.com', NOW), { allowed: true })
})

test('보낸 곳 한도를 넘으면 막는다', async () => {
  const { record } = counter()
  for (let i = 0; i < ORIGIN_LIMIT.limit; i++) {
    assert.equal((await gateLogin(record, '1.1.1.1', `u${i}@x.com`, NOW)).allowed, true)
  }
  const g = await gateLogin(record, '1.1.1.1', 'next@x.com', NOW)
  assert.equal(g.allowed, false)
  assert.equal(!g.allowed && g.reason, 'rate_limited')
  assert.equal(!g.allowed && g.retryAfterSeconds, ORIGIN_LIMIT.windowSeconds)
})

test('보낸 곳을 바꿔도 한 계정에 1시간 20회를 넘으면 막는다', async () => {
  // 한도를 상수로만 비교하면 숫자를 늘려도 초록이다, 값 자체를 박는다
  assert.deepEqual({ ...EMAIL_LIMIT }, { limit: 20, windowSeconds: 3600 })
  assert.deepEqual({ ...ORIGIN_LIMIT }, { limit: 10, windowSeconds: 600 })
  const { record } = counter()
  for (let i = 0; i < EMAIL_LIMIT.limit; i++) {
    assert.equal((await gateLogin(record, `10.0.0.${i}`, 'victim@x.com', NOW)).allowed, true)
  }
  const g = await gateLogin(record, '9.9.9.9', ' Victim@X.com ', NOW)
  assert.equal(g.allowed, false)
  assert.equal(!g.allowed && g.retryAfterSeconds, EMAIL_LIMIT.windowSeconds)
})

test('이메일은 대소문자와 공백을 무시하고 센다', () => {
  assert.equal(normalizeLoginEmail('  A@X.Com '), 'a@x.com')
})

test('세기가 실패하면 거절한다 (닫힘)', async () => {
  const failing = (which: 'origin' | 'email'): HitRecorder => async (key) =>
    key === which ? { ok: false } : ({ ok: true, hits: 1, windowStartMs: NOW } as HitResult)
  for (const which of ['origin', 'email'] as const) {
    const g = await gateLogin(failing(which), '1.1.1.1', 'a@x.com', NOW)
    assert.deepEqual(g, { allowed: false, reason: 'unavailable', retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS }, which)
  }
  const throwing: HitRecorder = async () => { throw new Error('db down') }
  assert.equal((await gateLogin(throwing, '1.1.1.1', 'a@x.com', NOW)).allowed, false)
})
