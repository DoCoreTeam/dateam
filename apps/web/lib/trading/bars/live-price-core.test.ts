import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLivePriceFresh,
  livePriceAgeThresholds,
  livePricePushSeconds,
  parseLivePricePayload,
  priceFromKis,
  sseEvent,
} from './live-price-core.ts'

test('밀어 주는 간격은 1~10초 안의 정수다', () => {
  assert.equal(livePricePushSeconds(undefined), 1)
  assert.equal(livePricePushSeconds(0), 1)
  assert.equal(livePricePushSeconds(2.9), 2)
  assert.equal(livePricePushSeconds(99), 10)
})

test('1초 가격은 3초부터 나이를 말하고 10초부터 멈춘 값이다', () => {
  assert.deepEqual(livePriceAgeThresholds(1), { fresh: 3, stale: 10 })
  assert.deepEqual(livePriceAgeThresholds(2), { fresh: 6, stale: 20 })
})

test('같은 주기 안의 저장값만 외부 호출을 대신할 수 있다', () => {
  const now = new Date('2026-10-01T01:00:01.000Z')
  assert.equal(isLivePriceFresh({ observedAt: '2026-10-01T01:00:00.100Z' }, now, 1), true)
  assert.equal(isLivePriceFresh({ observedAt: '2026-10-01T01:00:00.000Z' }, now, 1), false)
  assert.equal(isLivePriceFresh({ observedAt: 'broken' }, now, 1), false)
})

test('KIS 값과 브라우저 payload 에 깨진 가격·시각을 들이지 않는다', () => {
  for (const bad of [null, undefined, '', ' ', 0, -1, Number.POSITIVE_INFINITY]) {
    assert.equal(priceFromKis(bad), null)
  }
  assert.equal(priceFromKis('1083.75'), 1083.75)

  const good = { contractCode: ' A05610 ', price: 1083.75, observedAt: '2026-10-01T01:00:00.000Z' }
  assert.deepEqual(parseLivePricePayload(good), { ...good, contractCode: 'A05610' })
  assert.equal(parseLivePricePayload({ ...good, price: '쓰레기' }), null)
  assert.equal(parseLivePricePayload({ ...good, observedAt: '쓰레기' }), null)
})

test('SSE 이벤트는 이름·JSON·빈 줄로 닫힌다', () => {
  assert.equal(sseEvent('price', { price: 1 }), 'event: price\ndata: {"price":1}\n\n')
})
