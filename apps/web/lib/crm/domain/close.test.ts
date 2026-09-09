// lib/crm/domain/close.test.ts — 마감 가드
//
// **막는 것**: 「보고한 숫자」와 「지금 화면의 숫자」가 말없이 달라지는 일.
// 딜은 계속 움직이므로 9월 수주를 10월에 다시 조회하면 다른 값이 나온다.
// 마감이 없으면 어느 쪽이 맞는지 아무도 모른다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canMove, isLive, isClosable, closeBlockedReason,
  validateClose, validateCloses, findClose, moveClose, CloseError, MAX_CLOSES,
} from './close.ts'
import type { Period } from './target.ts'

const AUG: Period = { kind: 'MONTH', year: 2026, index: 8 }
const SEP: Period = { kind: 'MONTH', year: 2026, index: 9 }
const TODAY = '2026-09-09'

test('★ 끝나지 않은 기간은 못 닫는다 — 남은 날의 수주가 영원히 빠진다', () => {
  assert.equal(isClosable(SEP, TODAY), false)
  assert.equal(isClosable(AUG, TODAY), true)
  assert.match(closeBlockedReason(SEP, TODAY) ?? '', /끝나야 마감할 수 있어요/)
  assert.equal(closeBlockedReason(AUG, TODAY), null)
})

test('★ 확정에서는 아무 데도 못 간다 — 되돌리기는 기록을 지운다', () => {
  assert.equal(canMove('draft', 'reviewing'), true)
  assert.equal(canMove('reviewing', 'confirmed'), true)
  assert.equal(canMove('reviewing', 'draft'), true, '검토를 물리는 것은 잃는 것이 없다')
  assert.equal(canMove('confirmed', 'draft'), false)
  assert.equal(canMove('confirmed', 'reviewing'), false)
  assert.equal(canMove('draft', 'confirmed'), false, '사람이 보지 않고 바로 확정하지 않는다')
})

test('확정 전에는 숫자가 살아 있다', () => {
  assert.equal(isLive('draft'), true)
  assert.equal(isLive('reviewing'), true)
  assert.equal(isLive('confirmed'), false)
})

test('★ 확정할 때만 숫자를 박는다', () => {
  const at = '2026-09-01T00:00:00.000Z'
  const r = moveClose(null, 'reviewing', { snapshot: { bookings: '100' }, at, by: 'mb', periodKey: 'MONTH:2026:8' })
  assert.deepEqual(r.snapshot, {}, '검토 중에는 박지 않는다 — 아직 움직이는 값이다')
  const c = moveClose(r, 'confirmed', { snapshot: { bookings: '100' }, at, by: 'mb', periodKey: 'MONTH:2026:8' })
  assert.deepEqual(c.snapshot, { bookings: '100' })
  assert.equal(c.confirmedAt, at)
  assert.equal(c.state, 'confirmed')
})

test('★ 확정을 덮어쓰지 않는다 — 다시 확정하면 수정본 번호가 오른다', () => {
  const at = '2026-09-01T00:00:00.000Z'
  const c1 = moveClose(null, 'reviewing', { snapshot: {}, at, by: null, periodKey: 'MONTH:2026:8' })
  const c2 = moveClose(c1, 'confirmed', { snapshot: { bookings: '100' }, at, by: null, periodKey: 'MONTH:2026:8' })
  assert.equal(c2.revision, 0)
  const c3 = moveClose(c2, 'confirmed', { snapshot: { bookings: '120' }, at, by: null, periodKey: 'MONTH:2026:8' })
  assert.equal(c3.revision, 1, '몇 번째 판인지 남아야 한다')
  assert.deepEqual(c3.snapshot, { bookings: '120' })
})

test('갈 수 없는 곳으로 옮기면 막는다', () => {
  const at = '2026-09-01T00:00:00.000Z'
  const c = moveClose(null, 'reviewing', { snapshot: {}, at, by: null, periodKey: 'MONTH:2026:8' })
  const done = moveClose(c, 'confirmed', { snapshot: {}, at, by: null, periodKey: 'MONTH:2026:8' })
  assert.throws(() => moveClose(done, 'draft', { snapshot: {}, at, by: null, periodKey: 'MONTH:2026:8' }), CloseError)
})

test('숫자가 아닌 값은 스냅샷에 넣지 않는다 — 나중에 계산이 깨진다', () => {
  const r = validateClose({ periodKey: 'MONTH:2026:8', state: 'confirmed', snapshot: { a: '10', b: 'abc', c: 5 } })
  assert.deepEqual(r.snapshot, { a: '10' })
})

test('모르는 상태·빈 기간은 막는다', () => {
  assert.throws(() => validateClose({ periodKey: 'x', state: '마감함' }), CloseError)
  assert.throws(() => validateClose({ periodKey: '', state: 'draft' }), CloseError)
  assert.throws(() => validateClose('문자열'), CloseError)
})

test('같은 기간이 두 번 있으면 막는다 — 어느 쪽이 진짜인지 알 수 없다', () => {
  const one = { periodKey: 'MONTH:2026:8', state: 'draft' }
  assert.equal(validateCloses([one]).length, 1)
  assert.throws(() => validateCloses([one, { ...one }]), CloseError)
})

test('상한을 넘으면 막는다', () => {
  const many = Array.from({ length: MAX_CLOSES + 1 }, (_, i) => ({ periodKey: `MONTH:2026:${i}`, state: 'draft' }))
  assert.throws(() => validateCloses(many), CloseError)
})

test('찾기 — 없으면 null 이다', () => {
  const list = validateCloses([{ periodKey: 'MONTH:2026:8', state: 'draft' }])
  assert.ok(findClose(list, 'MONTH:2026:8'))
  assert.equal(findClose(list, 'MONTH:2026:7'), null)
})

test('마감은 순수하다 — DB 도 화면도 모른다', () => {
  const src = readFileSync(new URL('./close.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'getCrmDb', 'findMany', 'react']) {
    assert.ok(!src.includes(banned), `마감이 ${banned} 를 안다`)
  }
})
