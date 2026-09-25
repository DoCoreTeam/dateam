/**
 * 지연과 손익 — **못 잰 것은 0 이 아니다**
 *
 * 0 으로 채우면 중앙값이 내려가고 「우리는 빠르다」가 된다.
 * 실제로는 열람 시각을 못 받은 판이 절반이었을 뿐인데.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LATENCY_SEGMENTS, SEGMENT_LABEL, segmentSeconds, allSegments, summarizeSegment,
  percentile, latencyReport, SIGNAL_RESULTS, decideResult,
  realizedPnlKrw, dayPnl, pnlForLimits, toR,
  type SignalTimes, type RealizedTrade,
} from './pnl.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = new Date('2026-09-25T04:00:00Z')
const at = (s: number) => new Date(T0.getTime() + s * 1000)

const FULL: SignalTimes = {
  barCloseAt: T0, notifySentAt: at(3), openedAt: at(63), orderAt: at(120), fillAt: at(122),
}

test('★ 네 구간이 명세 그대로다', () => {
  assert.deepEqual([...LATENCY_SEGMENTS], ['server', 'to_open', 'to_order', 'to_fill'])
  for (const s of LATENCY_SEGMENTS) assert.ok(SEGMENT_LABEL[s].length > 0)
})

test('구간을 초로 잰다', () => {
  assert.deepEqual(allSegments(FULL), { server: 3, to_open: 60, to_order: 57, to_fill: 2 })
})

test('★ 시각이 비면 그 구간은 못 잰 것이다 — 0 이 아니다', () => {
  const noOpen: SignalTimes = { ...FULL, openedAt: null }
  assert.equal(segmentSeconds(noOpen, 'to_open'), null)
  assert.equal(segmentSeconds(noOpen, 'to_order'), null)
  // 앞뒤가 멀쩡한 구간은 그대로 잰다
  assert.equal(segmentSeconds(noOpen, 'server'), 3)
  assert.equal(segmentSeconds(noOpen, 'to_fill'), 2)
})

test('★ 못 잰 것이 0 으로 안 세어진다 — 요약이 건수를 따로 준다', () => {
  const stats = summarizeSegment([10, null, 20, null])
  assert.equal(stats.measured, 2)
  assert.equal(stats.unmeasured, 2)
  assert.equal(stats.medianSeconds, 10)
  // 0 이 섞였다면 중앙값이 5 였을 것이다
  assert.notEqual(stats.medianSeconds, 5)
})

test('아무것도 못 쟀으면 값이 null 이다 — 0 이라고 말하지 않는다', () => {
  assert.deepEqual(summarizeSegment([null, null]), {
    measured: 0, unmeasured: 2, medianSeconds: null, p90Seconds: null, p95Seconds: null,
  })
})

test('중앙값·90%·95% 를 낸다 (가장 가까운 순위)', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(percentile(sorted, 0.5), 5)
  assert.equal(percentile(sorted, 0.9), 9)
  assert.equal(percentile(sorted, 0.95), 10)
  assert.equal(percentile([], 0.5), null)
  // 표본 하나면 셋이 같다 — 보간해서 없는 값을 만들지 않는다
  assert.equal(percentile([7], 0.95), 7)
})

test('네 구간 보고서가 구간마다 따로 센다', () => {
  const rows: SignalTimes[] = [
    FULL,
    { ...FULL, openedAt: null, orderAt: null },
    { barCloseAt: T0, notifySentAt: at(9), openedAt: at(100), orderAt: at(200), fillAt: null },
  ]
  const report = latencyReport(rows)
  assert.equal(report.server.measured, 3)
  assert.equal(report.to_open.measured, 2)
  assert.equal(report.to_order.measured, 2)
  assert.equal(report.to_fill.measured, 1)
  assert.equal(report.to_fill.unmeasured, 2)
})

test('★ 시계가 뒤집힌 값을 0 으로 눕히지 않는다 — 어긋난 사실이 남아야 한다', () => {
  const weird: SignalTimes = { ...FULL, notifySentAt: new Date(T0.getTime() - 5000) }
  assert.equal(segmentSeconds(weird, 'server'), -5)
})

// ── 신호 결과 ────────────────────────────────────────────

test('★ 유효 시간 안에 체결되면 따른 것, 지나서면 늦은 것', () => {
  const base = { times: FULL, validMinutes: 10, skipped: false, now: at(1200) }
  assert.equal(decideResult(base), 'followed')
  assert.equal(decideResult({ ...base, times: { ...FULL, fillAt: at(601) } }), 'late')
  // 경계는 포함이다 — 10분 0초는 따른 것
  assert.equal(decideResult({ ...base, times: { ...FULL, fillAt: at(600) } }), 'followed')
})

test('★ 사람이 건너뛴다고 말했으면 추론보다 그 말이 앞선다', () => {
  assert.equal(decideResult({ times: FULL, validMinutes: 10, skipped: true, now: at(1200) }), 'skipped')
})

test('체결이 없고 유효 시간이 지나면 만료', () => {
  const noFill: SignalTimes = { ...FULL, orderAt: null, fillAt: null }
  assert.equal(decideResult({ times: noFill, validMinutes: 10, skipped: false, now: at(601) }), 'expired')
})

test('★ 아직 유효 시간 안이면 결과가 없다 — 「건너뜀」으로 미리 적지 않는다', () => {
  const noFill: SignalTimes = { ...FULL, orderAt: null, fillAt: null }
  assert.equal(decideResult({ times: noFill, validMinutes: 10, skipped: false, now: at(300) }), null)
})

test('결과 넷이 명세 그대로다', () => {
  assert.deepEqual([...SIGNAL_RESULTS], ['followed', 'late', 'skipped', 'expired'])
})

// ── 손익 ────────────────────────────────────────────────

const SPEC = { multiplier: 250000, tickSize: 0.05 }
const TRADE: RealizedTrade = {
  direction: 'long', entryPrice: 300, exitPrice: 301, quantity: 1, instrument: SPEC, feeKrw: 5000,
}

test('실현 손익은 포인트 × 승수 − 수수료', () => {
  assert.equal(realizedPnlKrw(TRADE), 245000)
  assert.equal(realizedPnlKrw({ ...TRADE, direction: 'short' }), -255000)
})

test('★ 원 단위로 떨어진다 — 부동소수 찌꺼기가 안 남는다', () => {
  const p = realizedPnlKrw({ ...TRADE, entryPrice: 300.05, exitPrice: 300.45, feeKrw: 0 })
  assert.equal(p, 100000)
  assert.equal(Number.isInteger(p), true)
})

test('★ 실현과 평가가 안 섞인다', () => {
  const d = dayPnl([TRADE, { ...TRADE, exitPrice: 299 }], 1234567)
  assert.equal(d.realizedKrw, 245000 + (-250000 - 5000))
  assert.equal(d.tradeCount, 2)
  assert.equal(d.unrealizedKrw, 1234567)
  // 한도가 보는 값은 실현뿐이다
  assert.equal(pnlForLimits(d), d.realizedKrw)
  assert.notEqual(pnlForLimits(d), d.realizedKrw + 1234567)
})

test('★ 평가 손익을 한도 계산에 넣는 통로가 아예 없다 (가드)', () => {
  const src = readFileSync(join(HERE, 'pnl.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export function pnlForLimits'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.equal(/unrealized/.test(body), false, '한도 계산이 평가 손익을 본다')
})

test('평가 손익을 모르면 null 이다 — 0 이면 「평가익이 0원」이 된다', () => {
  assert.equal(dayPnl([], null).unrealizedKrw, null)
  assert.equal(dayPnl([], null).realizedKrw, 0)
})

test('R 배수. 1회 위험이 0 이면 못 잰다', () => {
  assert.equal(toR(245000, 245000), 1)
  assert.equal(toR(-122500, 245000), -0.5)
  assert.equal(toR(100, 0), null)
  assert.equal(toR(100, Number.NaN), null)
})
