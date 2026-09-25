/**
 * 확정 판정의 네 갈래와, 묶음 봉의 「하나라도 빠지면 안 만든다」
 *
 * 아직 채워지는 중인 값으로 판단하면 몇 초 뒤에 다른 값이 온다. 백테스트는 나중 값을
 * 보므로 실시간과 결과가 갈리고, 그 차이가 그대로 기대값의 거짓말이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideBarConfirmation,
  targetMinuteFor,
  aggregateBars,
  TIMEFRAME_MINUTES,
  type MinuteBarInput,
} from './confirm.ts'

const TARGET = new Date('2026-09-25T01:14:00.000Z') // 서울 10:14
const CLOSE = new Date('2026-09-25T01:15:00.000Z')
const GRACE = 10
const MISSING = 25

const bar = (startAt: Date, over: Partial<MinuteBarInput> = {}): MinuteBarInput => ({
  startAt, open: 1100, high: 1101, low: 1099, close: 1100.5, volume: 120, ...over,
})

const at = (secondsAfterClose: number) => new Date(CLOSE.getTime() + secondsAfterClose * 1000)

test('★ 다음 분 봉이 이미 시작됐으면 여유를 안 기다리고 확정한다', () => {
  const decision = decideBarConfirmation({
    target: TARGET,
    now: at(1),
    bars: [bar(TARGET), bar(CLOSE)],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'confirm')
  assert.equal(decision.kind === 'confirm' && decision.basis, 'next_bar_started')
})

test('★ 다음 봉이 없어도 여유(10초)가 지나면 확정한다 — 거래가 없으면 다음 봉이 안 생긴다', () => {
  const decision = decideBarConfirmation({
    target: TARGET, now: at(GRACE), bars: [bar(TARGET)],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'confirm')
  assert.equal(decision.kind === 'confirm' && decision.basis, 'grace_elapsed')
})

test('★ 봉이 왔어도 여유 전이면 아직 확정하지 않는다 — 채워지는 중일 수 있다', () => {
  const decision = decideBarConfirmation({
    target: TARGET, now: at(GRACE - 1), bars: [bar(TARGET)],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'retry')
})

test('★ 결측 판정(25초)이 지나도 안 오면 결측이다', () => {
  const decision = decideBarConfirmation({
    target: TARGET, now: at(MISSING), bars: [bar(CLOSE)],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'missing')
  assert.equal(decision.kind === 'missing' && decision.reason, 'not_arrived')
})

test('봉이 안 왔고 결측 판정 전이면 다시 본다', () => {
  const decision = decideBarConfirmation({
    target: TARGET, now: at(MISSING - 1), bars: [],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'retry')
})

test('★ 거래량 0 인 분도 확정이다 — 거래가 없었던 것이지 값이 없는 것이 아니다', () => {
  const decision = decideBarConfirmation({
    target: TARGET, now: at(GRACE), bars: [bar(TARGET, { volume: 0 })],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'confirm', '거래량으로 확정을 판단했다')
  assert.equal(decision.kind === 'confirm' && decision.bar.volume, 0)
})

test('봉 순서가 섞여 와도 대상 봉과 다음 봉을 제대로 찾는다', () => {
  const decision = decideBarConfirmation({
    target: TARGET, now: at(1),
    bars: [bar(CLOSE), bar(new Date(TARGET.getTime() - 60_000)), bar(TARGET)],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'confirm')
})

test('앞 봉만 있고 대상 봉이 없으면 「다음 봉이 있다」로 읽지 않는다', () => {
  const decision = decideBarConfirmation({
    target: TARGET, now: at(1),
    bars: [bar(new Date(TARGET.getTime() - 60_000))],
    graceSec: GRACE, missingAfterSec: MISSING,
  })
  assert.equal(decision.kind, 'retry')
})

test('확정 대상은 직전 분이다 — 지금 채워지는 중인 분이 아니다', () => {
  assert.equal(
    targetMinuteFor(new Date('2026-09-25T01:15:05.000Z')).toISOString(),
    '2026-09-25T01:14:00.000Z',
  )
  assert.equal(
    targetMinuteFor(new Date('2026-09-25T01:15:00.000Z')).toISOString(),
    '2026-09-25T01:14:00.000Z',
  )
})

// ── 묶음 봉 ──────────────────────────────────────────────

const minutesFrom = (startIso: string, count: number, skip: number[] = []): MinuteBarInput[] => {
  const base = new Date(startIso).getTime()
  const out: MinuteBarInput[] = []
  for (let i = 0; i < count; i += 1) {
    if (skip.includes(i)) continue
    out.push(bar(new Date(base + i * 60_000), {
      open: 1100 + i, high: 1110 + i, low: 1090 + i, close: 1105 + i, volume: 10 * (i + 1),
    }))
  }
  return out
}

test('★ 5분 봉은 구성 1분 봉이 전부 있어야 만들어진다', () => {
  const full = aggregateBars(minutesFrom('2026-09-25T01:00:00.000Z', 5), '5m')
  assert.equal(full.bars.length, 1)
  assert.equal(full.incomplete, 0)

  // 가운데 한 분이 빠지면 안 만든다. 빼고 묶으면 다른 시장을 요약한 값이 된다
  const holed = aggregateBars(minutesFrom('2026-09-25T01:00:00.000Z', 5, [2]), '5m')
  assert.deepEqual(holed.bars, [], '빠진 분을 빼고 묶었다')
  assert.equal(holed.incomplete, 1, '못 만든 사실이 안 세어졌다')
})

test('묶음 값이 시가·고가·저가·종가·거래량 규칙대로다', () => {
  const { bars } = aggregateBars(minutesFrom('2026-09-25T01:00:00.000Z', 5), '5m')
  const five = bars[0]
  assert.equal(five.startAt.toISOString(), '2026-09-25T01:00:00.000Z')
  assert.equal(five.open, 1100, '첫 분의 시가')
  assert.equal(five.close, 1109, '마지막 분의 종가')
  assert.equal(five.high, 1114, '구간 최고')
  assert.equal(five.low, 1090, '구간 최저')
  assert.equal(five.volume, 10 + 20 + 30 + 40 + 50, '거래량 합')
})

test('구간 경계가 자정 눈금으로 나뉜다 — 09:00·09:05 가 되어 거래소와 맞는다', () => {
  // 01:03 부터 시작해도 01:00 구간과 01:05 구간으로 갈린다
  const { bars, incomplete } = aggregateBars(minutesFrom('2026-09-25T01:03:00.000Z', 10), '5m')
  assert.equal(bars.length, 1, '완성된 구간은 01:05 하나뿐이다')
  assert.equal(bars[0].startAt.toISOString(), '2026-09-25T01:05:00.000Z')
  assert.equal(incomplete, 2, '양끝 조각 둘이 안 세어졌다')
})

test('15분 봉도 같은 규칙이다', () => {
  const full = aggregateBars(minutesFrom('2026-09-25T01:00:00.000Z', 15), '15m')
  assert.equal(full.bars.length, 1)
  const holed = aggregateBars(minutesFrom('2026-09-25T01:00:00.000Z', 15, [14]), '15m')
  assert.equal(holed.bars.length, 0)
})

test('1분은 묶지 않고 순서만 맞춘다', () => {
  const shuffled = [bar(new Date('2026-09-25T01:02:00.000Z')), bar(new Date('2026-09-25T01:00:00.000Z'))]
  const { bars } = aggregateBars(shuffled, '1m')
  assert.deepEqual(bars.map((b) => b.startAt.toISOString()),
    ['2026-09-25T01:00:00.000Z', '2026-09-25T01:02:00.000Z'])
})

test('봉 길이표가 명세와 같다', () => {
  assert.deepEqual(TIMEFRAME_MINUTES, { '1m': 1, '5m': 5, '15m': 15 })
})
