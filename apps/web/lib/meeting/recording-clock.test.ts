// lib/meeting/recording-clock.test.ts — 멈춘 시간을 빼고 세는가
//
// 이 뺄셈이 틀려도 화면은 멀쩡해 보인다. 타이머가 조금 빨리 가고,
// 10분 구간이 7분에서 끊길 뿐이다 — 둘 다 회의가 끝난 뒤에야 드러난다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pausedMsAt, elapsedSecAt, remainingMs, partDurationSec, type PauseClock,
} from './recording-clock.ts'

const T0 = 1_700_000_000_000

test('돌고 있으면 경과는 벽시계와 같다', () => {
  const clock: PauseClock = { startedAtMs: T0, pausedTotalMs: 0, pausedAtMs: null }
  assert.equal(elapsedSecAt(clock, T0 + 65_000), 65)
})

test('★ 멈춰 있는 동안 경과가 그 자리에 선다 — 멈췄다면서 숫자가 돌면 거짓말이다', () => {
  // 30초 녹음하고 멈췄다
  const clock: PauseClock = { startedAtMs: T0, pausedTotalMs: 0, pausedAtMs: T0 + 30_000 }
  assert.equal(elapsedSecAt(clock, T0 + 30_000), 30)
  assert.equal(elapsedSecAt(clock, T0 + 90_000), 30, '1분을 더 멈춰 있어도 30초다')
  assert.equal(elapsedSecAt(clock, T0 + 600_000), 30)
})

test('이어한 뒤에는 멈춘 만큼을 뺀 시간이 이어진다', () => {
  // 30초 녹음 → 60초 멈춤 → 다시 돈다
  const clock: PauseClock = { startedAtMs: T0, pausedTotalMs: 60_000, pausedAtMs: null }
  assert.equal(elapsedSecAt(clock, T0 + 90_000), 30, '멈춤이 끝난 그 순간은 멈출 때 값 그대로')
  assert.equal(elapsedSecAt(clock, T0 + 100_000), 40)
})

test('멈춤이 여러 번이어도 합으로 센다', () => {
  const clock: PauseClock = { startedAtMs: T0, pausedTotalMs: 20_000 + 35_000, pausedAtMs: T0 + 200_000 }
  // 200초 지점에서 다시 멈췄고, 그 전까지 55초를 멈춰 있었다
  assert.equal(elapsedSecAt(clock, T0 + 200_000), 145)
  assert.equal(elapsedSecAt(clock, T0 + 500_000), 145)
})

test('경과는 음수로 내려가지 않는다 — 시계가 뒤로 가도 화면은 0 이다', () => {
  const clock: PauseClock = { startedAtMs: T0, pausedTotalMs: 0, pausedAtMs: null }
  assert.equal(elapsedSecAt(clock, T0 - 5_000), 0)
})

test('멈춘 시간 합산은 진행 중인 멈춤까지 더한다', () => {
  const clock: PauseClock = { startedAtMs: T0, pausedTotalMs: 10_000, pausedAtMs: T0 + 50_000 }
  assert.equal(pausedMsAt(clock, T0 + 50_000), 10_000)
  assert.equal(pausedMsAt(clock, T0 + 53_000), 13_000)
})

test('★ 회전까지 남은 시간은 0 아래로 안 간다 — 음수를 setTimeout 에 넣으면 즉시 끊긴다', () => {
  assert.equal(remainingMs(T0 + 600_000, T0), 600_000)
  assert.equal(remainingMs(T0 + 600_000, T0 + 590_000), 10_000)
  assert.equal(remainingMs(T0 + 600_000, T0 + 700_000), 0)
})

test('★ 구간 길이에서 멈춘 시간이 빠진다 — 안 빼면 뒤 구간 자막이 통째로 밀린다', () => {
  // 구간이 10분 벽시계 동안 열려 있었지만 3분은 멈춰 있었다
  assert.equal(partDurationSec(T0, 180_000, T0 + 600_000), 420)
  assert.equal(partDurationSec(T0, 0, T0 + 600_000), 600)
})
