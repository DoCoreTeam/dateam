import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRoll } from './roll.ts'
import type { OpenDay } from '../calendar/trading-days.ts'

const contract = (code: string, month: string, last: string, isFront = false) => ({
  code, root: 'MINI_KOSPI200' as const, expiryMonth: month, isFront, lastTradingDay: last,
})

const CONTRACTS = [
  contract('101W10', '2026-10-01', '2026-10-08', true),
  contract('101W11', '2026-11-01', '2026-11-12'),
]

/** 2026-09-25 부터 2026-11-30 까지, 주말만 휴장 */
const openDays: OpenDay[] = []
for (let d = new Date(Date.UTC(2026, 8, 25)); d <= new Date(Date.UTC(2026, 10, 30)); d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10)
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
  openDays.push({ date, open: dow !== 0 && dow !== 6 })
}

const base = {
  today: '2026-09-25',
  contracts: CONTRACTS,
  frontCode: '101W10',
  openDays,
  daysBefore: 3,
}

test('차근월물이 아직 가벼우면 안 갈아탄다', async () => {
  const r = await decideRoll({ ...base, volumeOf: async (c) => (c === '101W10' ? 200_000 : 40_000) })
  assert.deepEqual(r, { rolled: false, reason: 'front_still_heavier', frontCode: '101W10' })
})

test('★ 차근월물 거래량이 넘으면 그날 갈아탄다', async () => {
  const r = await decideRoll({ ...base, volumeOf: async (c) => (c === '101W10' ? 40_000 : 200_000) })
  assert.deepEqual(r,
    { rolled: true, reason: 'next_volume_exceeded', frontCode: '101W11', fromCode: '101W10' })
})

test('★ 기한이 오면 거래량과 무관하게 갈아탄다 — 거래량이 안 뒤집히는 달이 실제로 있다', async () => {
  // 10-08 이 최종거래일. 10-05(월)이면 남은 개장일은 06·07·08 사흘
  const r = await decideRoll({
    ...base, today: '2026-10-05',
    volumeOf: async (c) => (c === '101W10' ? 900_000 : 1),
  })
  assert.equal(r.rolled, true)
  assert.equal(r.reason, 'deadline_reached')
})

test('★ 거래량을 못 읽으면 안 갈아탄다 — 근거 없이 월물을 바꾸면 지표가 안 이어진다', async () => {
  const r = await decideRoll({ ...base, volumeOf: async () => null })
  assert.deepEqual(r, { rolled: false, reason: 'unknown_volume', frontCode: '101W10' })
})

test('★ 거래량을 못 읽어도 기한은 본다 — 답이 늦는 날이 만기와 겹칠 수 있다', async () => {
  const r = await decideRoll({ ...base, today: '2026-10-05', volumeOf: async () => null })
  assert.equal(r.rolled, true)
  assert.equal(r.reason, 'deadline_reached')
})

test('★ 휴장일 표가 구간을 못 덮으면 안 갈아탄다', async () => {
  const r = await decideRoll({ ...base, openDays: [], volumeOf: async () => 1 })
  assert.deepEqual(r, { rolled: false, reason: 'unknown_days', frontCode: '101W10' })
})

test('차근월물이 없으면 갈아탈 데가 없다', async () => {
  const r = await decideRoll({
    ...base, contracts: [CONTRACTS[0]], volumeOf: async () => 1,
  })
  assert.deepEqual(r, { rolled: false, reason: 'no_next', frontCode: '101W10' })
})

test('갈아탄 뒤에는 어디서 왔는지가 남는다 — 실행 기록이 그 줄을 싣는다', async () => {
  const r = await decideRoll({ ...base, volumeOf: async (c) => (c === '101W10' ? 1 : 2) })
  assert.equal(r.rolled && r.fromCode, '101W10')
})
