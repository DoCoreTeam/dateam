import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarize } from './weather.ts'

test('기온 구간을 사람 말로 바꾼다', () => {
  assert.ok(summarize(30, 0).includes('무더움'))
  assert.ok(summarize(25, 0).includes('더움'))
  assert.ok(summarize(19, 0).includes('선선함'))
  assert.ok(summarize(10, 0).includes('쌀쌀함'))
  assert.ok(summarize(3, 0).includes('추움'))
  assert.ok(summarize(-5, 0).includes('한파'))
})

test('강수를 구간으로 말한다', () => {
  assert.ok(summarize(20, 50).includes('많은 비'))
  assert.ok(summarize(20, 10).includes('비'))
  assert.ok(summarize(20, 0.4).includes('약간의 비'))
  assert.ok(summarize(20, 0).includes('강수 없음'))
})

test('값이 없으면 없다고 말한다 — 지어내지 않는다', () => {
  assert.equal(summarize(null, null), '날씨 정보 없음')
  assert.ok(summarize(null, 12).includes('비'))
  assert.ok(!summarize(null, 12).includes('℃'))
})
