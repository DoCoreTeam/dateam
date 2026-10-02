import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nowPriceLine, gapFromNow, NOW_PRICE_LABEL } from './now-price.ts'
import { livePriceAgeThresholds } from '../bars/live-price-core.ts'

/* 문턱의 유일한 출처. 화면 기본 간격(1초)으로 잰다 */
const THRESHOLD = livePriceAgeThresholds(1)

const AT = '2026-09-30T04:27:40.000Z' // 오후 01:27:40 서울
const now = (plusSeconds: number) => new Date(Date.parse(AT) + plusSeconds * 1000)

test('현재가를 못 받았으면 0 을 안 그리고 못 받았다고 말한다', () => {
  const line = nowPriceLine(null, now(0))
  assert.equal(line.price, null)
  assert.equal(line.missing, NOW_PRICE_LABEL.missing)
  // 「0」이 글자 어디에도 없어야 한다 — 0 은 「값이 0」으로 읽힌다
  assert.equal(line.missing?.includes('0'), false)
})

test('값이 있으면 값과 받은 시각을 초까지 말한다', () => {
  const line = nowPriceLine({ price: 1085.7, observedAt: AT }, now(3))
  assert.equal(line.price, '1,085.70')
  assert.equal(line.missing, null)
  assert.match(line.at ?? '', /01:27:40/)
})

test('갓 받은 값에는 나이를 안 붙인다', () => {
  const line = nowPriceLine({ price: 1085.7, observedAt: AT }, now(THRESHOLD.fresh))
  assert.equal(line.age, null)
  assert.equal(line.stale, false)
})

test('오래되면 몇 초 전인지 붙고, 더 오래되면 멈춘 값이라고 말한다', () => {
  const old = nowPriceLine({ price: 1085.7, observedAt: AT }, now(THRESHOLD.fresh + 1))
  assert.equal(old.age, `${THRESHOLD.fresh + 1}초 전`)
  assert.equal(old.stale, false)

  const stale = nowPriceLine({ price: 1085.7, observedAt: AT }, now(THRESHOLD.stale + 1))
  assert.equal(stale.stale, true)
  assert.equal(stale.age, `${THRESHOLD.stale + 1}초 전`)
})

test('신선도 문턱은 현재가 설정 간격을 따른다', () => {
  const fresh = nowPriceLine({ price: 1085.7, observedAt: AT }, now(6), 2)
  assert.equal(fresh.age, null)
  assert.equal(fresh.stale, false)
  const aged = nowPriceLine({ price: 1085.7, observedAt: AT }, now(7), 2)
  assert.equal(aged.age, '7초 전')
  const stale = nowPriceLine({ price: 1085.7, observedAt: AT }, now(21), 2)
  assert.equal(stale.stale, true)
})

test('시각이 깨졌어도 값은 버리지 않고 시각만 비운다', () => {
  const line = nowPriceLine({ price: 1085.7, observedAt: 'not-a-time' }, now(0))
  assert.equal(line.price, '1,085.70')
  assert.equal(line.at, null)
  assert.equal(line.missing, null)
})

test('거리는 부호를 살려 위인지 아래인지까지 말한다', () => {
  assert.equal(gapFromNow(1085.7, 1088.29), '지금보다 2.59점 위')
  assert.equal(gapFromNow(1085.7, 1084.22), '지금보다 1.48점 아래')
  assert.equal(gapFromNow(1085.7, 1085.7), '지금 가격과 같습니다')
  assert.equal(gapFromNow(null, 1084.22), null)
  assert.equal(gapFromNow(1085.7, null), null)
})

test('시계가 없으면(서버 렌더) 값과 시각만 말하고 나이는 안 적는다', () => {
  const line = nowPriceLine({ price: 1085.7, observedAt: AT }, null)
  assert.equal(line.price, '1,085.70')
  assert.match(line.at ?? '', /01:27:40/)
  assert.equal(line.age, null)
  assert.equal(line.stale, false)
})
