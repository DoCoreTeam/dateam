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
  const r = await decideRoll({ ...base, lastSessionVolumeOf: async (c) => (c === '101W10' ? 200_000 : 40_000) })
  assert.deepEqual(r, { rolled: false, reason: 'front_still_heavier', frontCode: '101W10' })
})

test('★ 차근월물 거래량이 넘으면 그날 갈아탄다', async () => {
  const r = await decideRoll({ ...base, lastSessionVolumeOf: async (c) => (c === '101W10' ? 40_000 : 200_000) })
  assert.deepEqual(r,
    { rolled: true, reason: 'next_volume_exceeded', frontCode: '101W11', fromCode: '101W10' })
})

test('★ 기한이 오면 거래량과 무관하게 갈아탄다 — 거래량이 안 뒤집히는 달이 실제로 있다', async () => {
  // 10-08 이 최종거래일. 10-05(월)이면 남은 개장일은 06·07·08 사흘
  const r = await decideRoll({
    ...base, today: '2026-10-05',
    lastSessionVolumeOf: async (c) => (c === '101W10' ? 900_000 : 500_000),
  })
  assert.equal(r.rolled, true)
  assert.equal(r.reason, 'deadline_reached')
})

/**
 * 실측 2026-10-05 가 이 모양이었다. 근월물 121,719 대 차월물 913 인데 기한에 걸려 갈아탔고,
 * 이틀 동안 거래량 22분의 1 짜리 월물을 화면과 판단이 봤다(10-07 실측 112,701 대 5,036).
 * 갈아타는 것 자체는 만기 때문에 못 막는다. 못 막으면 **사유로 남긴다.**
 */
test('★ 기한으로 갈아타는데 차월물이 아직 얇으면 그 사실이 사유에 남는다', async () => {
  const r = await decideRoll({
    ...base, today: '2026-10-05',
    lastSessionVolumeOf: async (c) => (c === '101W10' ? 121_719 : 913),
  })
  assert.equal(r.rolled, true)
  assert.equal(r.reason, 'deadline_reached_while_thin')
})

test('★ 거래량을 못 읽으면 안 갈아탄다 — 근거 없이 월물을 바꾸면 지표가 안 이어진다', async () => {
  const r = await decideRoll({ ...base, lastSessionVolumeOf: async () => null })
  assert.deepEqual(r, { rolled: false, reason: 'unknown_volume', frontCode: '101W10' })
})

test('★ 거래량을 못 읽어도 기한은 본다 — 답이 늦는 날이 만기와 겹칠 수 있다', async () => {
  const r = await decideRoll({ ...base, today: '2026-10-05', lastSessionVolumeOf: async () => null })
  assert.equal(r.rolled, true)
  assert.equal(r.reason, 'deadline_reached')
})

test('★ 휴장일 표가 구간을 못 덮으면 안 갈아탄다', async () => {
  const r = await decideRoll({ ...base, openDays: [], lastSessionVolumeOf: async () => 50_000 })
  assert.deepEqual(r, { rolled: false, reason: 'unknown_days', frontCode: '101W10' })
})

test('차근월물이 없으면 갈아탈 데가 없다', async () => {
  const r = await decideRoll({
    ...base, contracts: [CONTRACTS[0]], lastSessionVolumeOf: async () => 50_000,
  })
  assert.deepEqual(r, { rolled: false, reason: 'no_next', frontCode: '101W10' })
})

test('갈아탄 뒤에는 어디서 왔는지가 남는다 — 실행 기록이 그 줄을 싣는다', async () => {
  const r = await decideRoll({
    ...base, lastSessionVolumeOf: async (c) => (c === '101W10' ? 40_000 : 200_000),
  })
  assert.equal(r.rolled && r.fromCode, '101W10')
})

// ── 자정의 동전 던지기를 막는다 (실측 2026-10-02) ──────────────────

test('★ 둘 다 거의 안 움직인 날로는 안 갈아탄다 — 한 계약 차이는 정보가 아니다', async () => {
  /*
    실측: 굳히는 때가 자정이라 두 월물의 「오늘 누적 거래량」이 둘 다 0 근처였고,
    0 대 1 이 `next_volume_exceeded` 가 되어 만기 엿새 전 근월물을 버렸다.
  */
  const r = await decideRoll({ ...base, lastSessionVolumeOf: async (c) => (c === '101W10' ? 0 : 1) })
  assert.deepEqual(r, { rolled: false, reason: 'unknown_volume', frontCode: '101W10' })
})

test('★ 거의 안 움직인 날이어도 기한은 그대로 걸린다', async () => {
  const r = await decideRoll({
    ...base, today: '2026-10-05', lastSessionVolumeOf: async (c) => (c === '101W10' ? 0 : 1),
  })
  assert.equal(r.rolled, true)
  assert.equal(r.reason, 'deadline_reached')
})

test('★ 실측값으로 판정한다 — 어제 근월물 84,206 대 차근월물 957 이면 안 갈아탄다', async () => {
  // 2026-10-02 에 실제로 갈아탔던 그 상황. 고친 뒤에는 근월물이 그대로 남아야 한다
  const r = await decideRoll({
    ...base, lastSessionVolumeOf: async (c) => (c === '101W10' ? 84_206 : 957),
  })
  assert.deepEqual(r, { rolled: false, reason: 'front_still_heavier', frontCode: '101W10' })
})

test('★ 문턱은 설정으로 내릴 수 있다 — 상품이 바뀌면 거래량 단위도 바뀐다', async () => {
  const r = await decideRoll({
    ...base, minVolume: 1, lastSessionVolumeOf: async (c) => (c === '101W10' ? 0 : 1),
  })
  assert.equal(r.rolled, true)
  assert.equal(r.reason, 'next_volume_exceeded')
})
