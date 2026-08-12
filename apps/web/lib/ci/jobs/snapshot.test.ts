import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  snapshotIntervalSec, contentAgeHours, planNextCapture,
  SNAPSHOT_STOP_AFTER_DAYS,
} from './snapshot-policy.ts'

const NOW = new Date('2026-08-12T00:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

test('간격 — 갓 올라온 것은 촘촘히, 늙으면 성글게', () => {
  assert.equal(snapshotIntervalSec('standard', 1), 6 * 3600)
  assert.equal(snapshotIntervalSec('standard', 48), 12 * 3600)
  assert.equal(snapshotIntervalSec('standard', 24 * 10), 24 * 3600)
})

test('간격 — 프리셋이 정밀할수록 촘촘하다', () => {
  const young = 1
  const eco = snapshotIntervalSec('economy', young)!
  const std = snapshotIntervalSec('standard', young)!
  const pre = snapshotIntervalSec('precise', young)!
  assert.ok(pre < std && std < eco, `${pre} < ${std} < ${eco}`)
})

test('간격 — 추적 종료 나이를 넘기면 찍지 않는다(0이 아니라 null)', () => {
  const past = SNAPSHOT_STOP_AFTER_DAYS * 24 + 1
  assert.equal(snapshotIntervalSec('standard', past), null)
  assert.equal(snapshotIntervalSec('precise', past), null)
  assert.equal(snapshotIntervalSec('economy', past), null)
})

test('간격 — 경계에서 다음 단으로 넘어간다', () => {
  assert.equal(snapshotIntervalSec('standard', 23.9), 6 * 3600)
  assert.equal(snapshotIntervalSec('standard', 24), 12 * 3600)
})

test('간격 — 말이 안 되는 나이는 거부한다', () => {
  assert.equal(snapshotIntervalSec('standard', -1), null)
  assert.equal(snapshotIntervalSec('standard', Number.NaN), null)
})

test('나이 — 게시 시각이 있으면 그것으로, 없으면 수집 시각으로', () => {
  assert.equal(contentAgeHours(hoursAgo(5), hoursAgo(100), NOW), 5)
  assert.equal(contentAgeHours(null, hoursAgo(30), NOW), 30)
})

test('나이 — 미래 게시 시각도 음수로 만들지 않는다', () => {
  const future = new Date(NOW.getTime() + 3600_000).toISOString()
  assert.equal(contentAgeHours(future, hoursAgo(1), NOW), 0)
})

test('나이 — 시각이 깨져 있으면 null', () => {
  assert.equal(contentAgeHours('x', 'y', NOW), null)
})

test('계획 — 다음 촬영과 종료 시각을 함께 못 박는다', () => {
  const plan = planNextCapture({
    preset: 'standard', publishedAt: hoursAgo(2), firstSeenAt: hoursAgo(1), now: NOW,
  })!
  assert.equal(plan.intervalSec, 6 * 3600)
  assert.equal(plan.nextCaptureAt, new Date(NOW.getTime() + 6 * 3600_000).toISOString())
  // 종료는 "지금"이 아니라 게시 시점 기준이다
  const expectedStop = new Date(
    Date.parse(hoursAgo(2)) + SNAPSHOT_STOP_AFTER_DAYS * 86_400_000,
  ).toISOString()
  assert.equal(plan.stopAfter, expectedStop)
})

test('계획 — 추적 종료 대상이면 계획을 만들지 않는다', () => {
  assert.equal(planNextCapture({
    preset: 'standard',
    publishedAt: hoursAgo(SNAPSHOT_STOP_AFTER_DAYS * 24 + 10),
    firstSeenAt: hoursAgo(1),
    now: NOW,
  }), null)
})
