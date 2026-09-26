import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blackoutEventAt, inEventBlackout, windowFor, type MarketEvent } from './events-core.ts'

const FOMC: MarketEvent = { name: 'FOMC', occursAt: '2026-09-25T03:00:00.000Z' }
const at = (iso: string) => new Date(iso)
const ctx = (now: string, events: MarketEvent[] = [FOMC]) =>
  ({ events, at: at(now), beforeMinutes: 30, afterMinutes: 15 })

test('이벤트가 없으면 안 막는다', () => {
  assert.equal(inEventBlackout(ctx('2026-09-25T03:00:00.000Z', [])), false)
})

test('이벤트 한참 전이면 안 막는다', () => {
  assert.equal(inEventBlackout(ctx('2026-09-25T02:00:00.000Z')), false)
})

test('★ 경계는 양끝을 포함한다 — 한쪽만 열면 그 1분의 신호를 설명할 수 없다', () => {
  assert.equal(inEventBlackout(ctx('2026-09-25T02:30:00.000Z')), true, '30분 전 정각')
  assert.equal(inEventBlackout(ctx('2026-09-25T03:15:00.000Z')), true, '15분 후 정각')
  assert.equal(inEventBlackout(ctx('2026-09-25T02:29:59.000Z')), false)
  assert.equal(inEventBlackout(ctx('2026-09-25T03:15:01.000Z')), false)
})

test('구간 안이면 어떤 이벤트인지 말해 준다 — 사유에 이름이 실린다', () => {
  assert.equal(blackoutEventAt(ctx('2026-09-25T03:00:00.000Z'))?.name, 'FOMC')
})

test('★ 시각이 망가진 줄은 건너뛰고 나머지는 판정한다', () => {
  const events = [{ name: '깨진 줄', occursAt: 'not-a-time' }, FOMC]
  assert.equal(blackoutEventAt(ctx('2026-09-25T03:00:00.000Z', events))?.name, 'FOMC')
  assert.equal(inEventBlackout(ctx('2026-09-25T01:00:00.000Z', events)), false)
})

test('전후 분이 0 이면 그 순간만 막는다', () => {
  const zero = { events: [FOMC], at: at('2026-09-25T03:00:00.000Z'), beforeMinutes: 0, afterMinutes: 0 }
  assert.equal(inEventBlackout(zero), true)
  assert.equal(inEventBlackout({ ...zero, at: at('2026-09-25T03:00:01.000Z') }), false)
})

test('음수 설정은 0 으로 본다 — 뒤집힌 구간을 만들지 않는다', () => {
  const negative = { events: [FOMC], at: at('2026-09-25T03:00:00.000Z'), beforeMinutes: -30, afterMinutes: -15 }
  assert.equal(inEventBlackout(negative), true)
  assert.equal(inEventBlackout({ ...negative, at: at('2026-09-25T02:59:00.000Z') }), false)
})

test('읽을 구간은 경계에 걸친 이벤트까지 넉넉히 잡는다', () => {
  const w = windowFor(at('2026-09-25T03:00:00.000Z'), 30, 15)
  assert.equal(w.from.toISOString(), '2026-09-25T02:45:00.000Z')
  assert.equal(w.until.toISOString(), '2026-09-25T03:30:00.000Z')
})
