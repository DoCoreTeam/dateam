import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  marginSignal,
  deviationSignal,
  MARGIN_DANGER_MAX,
  MARGIN_WARN_MAX,
  MARGIN_OK_MAX,
  DEVIATION_CHEAP_MAX,
  DEVIATION_EXPENSIVE_MIN,
} from './price-signal.ts'

// ── marginSignal ──────────────────────────────────────────────────────────────

test('marginSignal — 임계 상수 노출 확인', () => {
  assert.equal(MARGIN_DANGER_MAX, 10)
  assert.equal(MARGIN_WARN_MAX, 15)
  assert.equal(MARGIN_OK_MAX, 25)
})

test('marginSignal — danger: pct < 10', () => {
  assert.equal(marginSignal(0), 'danger')
  assert.equal(marginSignal(9.99), 'danger')
  assert.equal(marginSignal(-5), 'danger')
})

test('marginSignal — warn: 10 ≤ pct < 15', () => {
  assert.equal(marginSignal(10), 'warn')
  assert.equal(marginSignal(12), 'warn')
  assert.equal(marginSignal(14.99), 'warn')
})

test('marginSignal — ok: 15 ≤ pct ≤ 25', () => {
  assert.equal(marginSignal(15), 'ok')
  assert.equal(marginSignal(20), 'ok')
  assert.equal(marginSignal(25), 'ok')
})

test('marginSignal — over: pct > 25', () => {
  assert.equal(marginSignal(25.01), 'over')
  assert.equal(marginSignal(50), 'over')
})

// ── deviationSignal ────────────────────────────────────────────────────────────

test('deviationSignal — 임계 상수 노출 확인', () => {
  assert.equal(DEVIATION_CHEAP_MAX, -10)
  assert.equal(DEVIATION_EXPENSIVE_MIN, 10)
})

test('deviationSignal — expensive: pct > 10', () => {
  assert.equal(deviationSignal(10.01), 'expensive')
  assert.equal(deviationSignal(30), 'expensive')
})

test('deviationSignal — ok: -10 ≤ pct ≤ 10', () => {
  assert.equal(deviationSignal(10), 'ok')
  assert.equal(deviationSignal(0), 'ok')
  assert.equal(deviationSignal(-10), 'ok')
})

test('deviationSignal — cheap: pct < -10', () => {
  assert.equal(deviationSignal(-10.01), 'cheap')
  assert.equal(deviationSignal(-30), 'cheap')
})
