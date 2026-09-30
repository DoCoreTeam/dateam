import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replayLines, breakEvenHitRate, whyNegativeLine } from './accuracy-note.ts'

/** 실측 2026-09-30 설정값 */
const RULE = {
  delayMinutes: 2,
  orderKind: 'market' as const,
  stopAtrMultiple: 1.2,
  targetAtrMultiple: 1.5,
  timeExitMinutes: 15,
  feeIncluded: true,
}

test('어떻게 셈했는지를 설정값 그대로 적는다', () => {
  const lines = replayLines(RULE)
  assert.equal(lines.length, 4)
  assert.match(lines[0], /2분 뒤에 시장가로 들어갑니다/)
  assert.match(lines[1], /1\.2배.*1\.5배/)
  assert.match(lines[2], /15분/)
  assert.match(lines[3], /수수료와 미끄러짐을 뺀 값/)
})

test('수수료가 0이면 안 뺐다고 말한다 — 안 말하면 실제 수익으로 읽는다', () => {
  assert.match(replayLines({ ...RULE, feeIncluded: false })[3], /안 빠져 있습니다/)
})

test('지정가면 지정가라고 적는다', () => {
  assert.match(replayLines({ ...RULE, orderKind: 'limit' })[0], /지정가로 들어갑니다/)
})

test('본전 적중률은 손절과 목표 폭이 정한다', () => {
  // 1.2 / (1.2 + 1.5) = 0.4444...
  const r = breakEvenHitRate(1.2, 1.5)
  assert.ok(r !== null)
  assert.ok(Math.abs(r - 0.4444) < 0.001, `${r}`)
  // 목표가 손절의 두 배면 본전선은 3분의 1이다
  assert.ok(Math.abs((breakEvenHitRate(1, 2) ?? 0) - 1 / 3) < 0.001)
})

test('폭을 모르면 본전선도 없다 — 0으로 나누지 않는다', () => {
  for (const [s, t] of [[0, 1.5], [1.2, 0], [-1, 1.5], [Number.NaN, 1.5]] as const) {
    assert.equal(breakEvenHitRate(s, t), null, `${s} ${t}`)
  }
})

test('본전선에 못 미치면 왜 마이너스인지 말한다', () => {
  // 실측 2026-09-30: 적중 19% (36/190)
  const line = whyNegativeLine({ hitRate: 0.19, stopAtrMultiple: 1.2, targetAtrMultiple: 1.5 })
  assert.ok(line)
  assert.match(line, /44%는 맞아야 본전인데 19%입니다/)
  assert.match(line, /검증 관문/)
})

test('본전선을 넘었으면 아무 말도 안 한다 — 늘 뜨는 설명은 안 읽힌다', () => {
  assert.equal(whyNegativeLine({ hitRate: 0.5, stopAtrMultiple: 1.2, targetAtrMultiple: 1.5 }), null)
  // 딱 본전선도 이 설명의 대상이 아니다
  assert.equal(whyNegativeLine({ hitRate: 1.2 / 2.7, stopAtrMultiple: 1.2, targetAtrMultiple: 1.5 }), null)
})

test('안 잰 것을 나쁘다고 하지 않는다', () => {
  assert.equal(whyNegativeLine({ hitRate: null, stopAtrMultiple: 1.2, targetAtrMultiple: 1.5 }), null)
  assert.equal(whyNegativeLine({ hitRate: 0.19, stopAtrMultiple: 0, targetAtrMultiple: 1.5 }), null)
})
