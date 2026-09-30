// lib/trading/price-comma.test.ts — 트레이딩 화면의 숫자는 쉼표를 단다
//
// **왜 생겼나**(사용자 지적 2026-09-30): 「모든 숫자에 콤마찍는건 기본 아닌가」 —
// 현황의 지금 가격이 「1086.44」였다. 코스피200 선물은 1000 을 넘으므로 이 화면의 값은
// 전부 네 자리 이상이고, 자릿수를 세어야 읽히는 숫자는 바뀌는 화면에서 안 읽힌다.
//
// **글자가 아니라 값을 본다.** 「fmtNum 을 import 했나」가 아니라 **1000 넘는 값을 넣어**
// 쉼표가 나오는지 묻는다. 갈아 끼우고 안 넘기는 실수는 그래야 잡힌다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatIndexPrice } from './signal-labels.ts'
import { priceText } from './position-labels.ts'
import { evaluateTriggers } from './judge/indicators.ts'
import { factLines } from './knowledge/explain-policy.ts'
import { buildLineage } from './judge/lineage.ts'

test('가격 한 줄은 두 포맷터 모두 쉼표를 단다', () => {
  assert.equal(formatIndexPrice(1086.44), '1,086.44')
  assert.equal(priceText(1086.44), '1,086.44')
  // 없는 값은 여전히 말로 답한다 — 쉼표를 붙이려고 0 을 지어내지 않는다
  assert.equal(formatIndexPrice(null), '값 없음')
})

test('진입 조건 설명의 종가·고가·저가도 쉼표를 단다', () => {
  const bar = (close: number) => ({
    startAt: new Date('2026-09-30T00:00:00Z'),
    open: close, high: close, low: close, close,
    volume: 1, observedAt: new Date('2026-09-30T00:01:04Z'),
  })
  const hit = evaluateTriggers(
    [bar(1080), bar(1090.5)],
    { atr: 1, smaFast: 1085, smaSlow: 1084, recentHigh: 1085.25, recentLow: 1070 },
    { atrPeriod: 14, smaFastPeriod: 5, smaSlowPeriod: 20, breakoutPeriod: 20, breakoutAtrMultiple: 1 },
  )
  assert.equal(hit?.id, 'breakout_up')
  assert.match(hit!.detail!, /1,090\.50/, '종가가 맨몸으로 나갔습니다')
  assert.match(hit!.detail!, /1,085\.25/, '최근 고가가 맨몸으로 나갔습니다')
})

test('신호 사실 줄의 기준·손절·목표도 쉼표를 단다', () => {
  const lines = factLines({
    direction: 'long',
    referencePrice: 1086.44,
    stopPrice: 1083.86,
    targetPrice: 1090.12,
    calibratedProb: 0.61,
    netExpectedValueR: 0.32,
    riskPerTradeKrw: 51000,
    triggerId: 'breakout_up',
  } as Parameters<typeof factLines>[0])
  const priceLine = lines.find((l) => l.startsWith('기준가'))
  assert.ok(priceLine, '기준가 줄이 없습니다')
  assert.match(priceLine!, /1,086\.44/)
  assert.match(priceLine!, /1,083\.86/)
})

test('판단 계보의 지표 숫자도 쉼표를 단다', () => {
  const at = new Date('2026-09-30T00:00:00Z')
  const bars = Array.from({ length: 30 }, (_, i) => ({
    startAt: new Date(at.getTime() + i * 60_000),
    open: 1080 + i, high: 1081 + i, low: 1079 + i, close: 1080 + i,
    volume: 1, observedAt: new Date(at.getTime() + i * 60_000 + 64_000),
  }))
  // 판단 봉은 25번째 — 계보는 「그 봉이 닫힌 시각」으로 봉을 찾는다(시작 + 1분)
  const barCloseAt = new Date(bars[25]!.startAt.getTime() + 60_000).toISOString()
  const lineage = buildLineage({
    bars,
    jev: {
      id: 'j1', barCloseAt, direction: 'long', prob: 0.61, status: 'ok',
      rawScore: null, abstainReason: null, modelVersion: 'jev-1', promptVersion: 'p1',
      requestAt: barCloseAt, responseAt: barCloseAt,
    },
    rule: null,
    params: { atrPeriod: 14, smaFastPeriod: 5, smaSlowPeriod: 20, breakoutPeriod: 20, breakoutAtrMultiple: 1 },
    sessionOpenAt: at.toISOString(),
    configuredModel: 'jev-1',
    reasoningEffort: 'medium',
    timeoutMs: 10_000,
    blocked: null,
    shown: null,
  })
  assert.ok(!lineage.unavailable, `계보를 못 세웠습니다: ${lineage.unavailable}`)
  const step = lineage.steps.find((s) => s.name === '지표 계산')
  assert.ok(step?.produced, '지표 계산 줄이 없습니다')
  assert.match(step!.produced!, /1,0\d\d\.\d\d/, `계보의 지표가 맨몸으로 나갔습니다: ${step!.produced}`)
})
