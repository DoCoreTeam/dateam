import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expectedBarCount } from './ops-core.ts'

test('접속매매 구간의 분 수를 센다 — 시작 포함, 종료 제외', () => {
  // 09:00 ~ 15:30 = 390분
  const start = new Date('2026-09-25T00:00:00Z')
  const end = new Date('2026-09-25T06:30:00Z')
  assert.equal(expectedBarCount(start, end), 390)
})

test('★ 종료를 포함하면 멀쩡한 날마다 한 줄 결측이라고 말하게 된다', () => {
  const start = new Date('2026-09-25T00:00:00Z')
  const end = new Date('2026-09-25T00:10:00Z')
  assert.equal(expectedBarCount(start, end), 10, '11 이면 종료를 포함한 것이다')
})

test('★ 구간을 모르거나 뒤집혔으면 null 이다 — 0 이면 「봉이 없어야 한다」가 된다', () => {
  const at = new Date('2026-09-25T00:00:00Z')
  assert.equal(expectedBarCount(at, at), null)
  assert.equal(expectedBarCount(new Date('2026-09-25T06:30:00Z'), at), null)
  assert.equal(expectedBarCount(new Date('nope'), at), null)
})
