import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lossStreakFrom, rolloverVerdict, type TimedTrade } from './context-core.ts'

const spec = { multiplier: 50_000, tickSize: 0.02 }
const NOW = new Date('2026-09-25T06:00:00Z')

/** 롱 왕복 하나. 나간 가격이 낮으면 손실이다 */
const trade = (exitDelta: number, minutesAgo: number, fee = 0): TimedTrade => ({
  direction: 'long', entryPrice: 400, exitPrice: 400 + exitDelta,
  quantity: 1, instrument: spec, feeKrw: fee,
  closedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
})

test('거래가 없으면 연속 0 이고 시각은 모름이다', () => {
  assert.deepEqual(lossStreakFrom([], NOW), { consecutiveLosses: 0, minutesSinceLastLoss: null })
})

test('마지막이 이익이면 연속 0 이다 — 앞에 손실이 있어도', () => {
  const r = lossStreakFrom([trade(-1, 60), trade(-1, 40), trade(+1, 10)], NOW)
  assert.equal(r.consecutiveLosses, 0)
  assert.equal(r.minutesSinceLastLoss, null)
})

test('★ 뒤에서부터 센다 — 「오늘 몇 번 졌나」가 아니라 「지금 연속 몇 번째인가」', () => {
  const r = lossStreakFrom([trade(-1, 90), trade(+2, 60), trade(-1, 30), trade(-1, 10)], NOW)
  assert.equal(r.consecutiveLosses, 2, '이익에서 끊겨야 한다')
  assert.equal(r.minutesSinceLastLoss, 10)
})

test('들어온 순서가 섞여 있어도 닫힌 시각으로 줄 세운다', () => {
  const r = lossStreakFrom([trade(-1, 10), trade(+2, 60), trade(-1, 30)], NOW)
  assert.equal(r.consecutiveLosses, 2)
  assert.equal(r.minutesSinceLastLoss, 10)
})

test('★ 본전은 손실이 아니다 — 무승부가 쿨다운을 걸면 안 된다', () => {
  assert.equal(lossStreakFrom([trade(0, 10)], NOW).consecutiveLosses, 0)
})

test('수수료 때문에 마이너스면 손실이다', () => {
  assert.equal(lossStreakFrom([trade(0, 10, 5_000)], NOW).consecutiveLosses, 1)
})

test('닫힌 시각이 망가진 줄이면 연속은 세되 지난 분은 모름이다', () => {
  const broken = { ...trade(-1, 10), closedAt: 'not-a-time' }
  const r = lossStreakFrom([broken], NOW)
  assert.equal(r.consecutiveLosses, 1)
  assert.equal(r.minutesSinceLastLoss, null)
})

// ── SR-04 교체일·최종거래일 (§6.3) ────────────────────────

const base = {
  today: '2026-09-25',
  frontLastTradingDay: '2026-10-08',
  previousFrontCode: '101W10',
  frontCode: '101W10',
}

test('평범한 날은 안 막는다', () => {
  assert.deepEqual(rolloverVerdict(base), { blocked: false })
})

test('오늘이 최종거래일이면 신규 금지다', () => {
  assert.deepEqual(rolloverVerdict({ ...base, frontLastTradingDay: '2026-09-25' }),
    { blocked: true, reason: 'expiry_today' })
})

test('어제와 근월물이 다르면 오늘 교체한 것이다', () => {
  assert.deepEqual(rolloverVerdict({ ...base, previousFrontCode: '101W09' }),
    { blocked: true, reason: 'rolled_today' })
})

test('어제 기록이 없으면 교체로 보지 않는다 — 첫 거래일마다 막히면 안 된다', () => {
  assert.deepEqual(rolloverVerdict({ ...base, previousFrontCode: null }), { blocked: false })
})

test('★ 최종거래일을 모르면 막는다 — 종목 정보가 낡은 날 만기 당일에 새로 들어가지 않게', () => {
  assert.deepEqual(rolloverVerdict({ ...base, frontLastTradingDay: null }),
    { blocked: true, reason: 'last_trading_day_unknown' })
})
