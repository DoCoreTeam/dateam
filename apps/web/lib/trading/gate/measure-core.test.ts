import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marginTightFrom, minutesSince, foldMeasurement, measurementNote } from './measure-core.ts'

test('추가 증거금이 붙으면 유지율을 볼 것도 없이 빡빡하다', () => {
  assert.equal(marginTightFrom({
    additionalMarginKrw: 1, maintenanceRate: 500, tightRatePercent: 100,
  }), true)
})

test('유지율이 기준 밑이면 빡빡하다', () => {
  assert.equal(marginTightFrom({
    additionalMarginKrw: 0, maintenanceRate: 90, tightRatePercent: 100,
  }), true)
  assert.equal(marginTightFrom({
    additionalMarginKrw: 0, maintenanceRate: 120, tightRatePercent: 100,
  }), false)
})

test('둘 다 못 읽으면 모름이다 — 「여유 있음」이 아니다', () => {
  assert.equal(marginTightFrom({
    additionalMarginKrw: null, maintenanceRate: null, tightRatePercent: 100,
  }), null)
  // NaN 도 못 읽은 것이다
  assert.equal(marginTightFrom({
    additionalMarginKrw: Number.NaN, maintenanceRate: Number.NaN, tightRatePercent: 100,
  }), null)
})

test('한쪽만 읽혀도 그것으로 답한다', () => {
  assert.equal(marginTightFrom({
    additionalMarginKrw: null, maintenanceRate: 90, tightRatePercent: 100,
  }), true)
  assert.equal(marginTightFrom({
    additionalMarginKrw: 0, maintenanceRate: null, tightRatePercent: 100,
  }), false)
})

test('실행 기록이 없으면 지난 분은 모름이다 — 0 이 아니다', () => {
  assert.equal(minutesSince(null, new Date('2026-09-26T00:30:00Z')), null)
  assert.equal(
    minutesSince(new Date('2026-09-26T00:25:00Z'), new Date('2026-09-26T00:30:00Z')), 5,
  )
})

test('앞선 시각이 미래여도 음수를 안 낸다', () => {
  assert.equal(
    minutesSince(new Date('2026-09-26T00:40:00Z'), new Date('2026-09-26T00:30:00Z')), 0,
  )
})

test('못 잰 값은 false 로 넘기되 못 쟀다고 남긴다 — 조용히 통과하지 않는다', () => {
  const m = foldMeasurement({
    brokerFailureStreak: 0,
    minutesSinceLastRun: null,
    hasCalibration: null,
    hasActiveSpec: true,
    marginTight: null,
    aiBudgetExhausted: false,
  })
  assert.equal(m.hasCalibration, false)
  assert.equal(m.marginTight, false)
  assert.deepEqual(m.unmeasured, ['minutesSinceLastRun', 'hasCalibration', 'marginTight'])
})

test('다 쟀으면 못 잰 목록이 비어 있다', () => {
  const m = foldMeasurement({
    brokerFailureStreak: 2,
    minutesSinceLastRun: 1,
    hasCalibration: true,
    hasActiveSpec: true,
    marginTight: false,
    aiBudgetExhausted: false,
  })
  assert.deepEqual(m.unmeasured, [])
  assert.equal(m.brokerFailureStreak, 2)
})

test('실행 기록 한 줄에 여섯이 다 보인다', () => {
  const note = measurementNote(foldMeasurement({
    brokerFailureStreak: 3,
    minutesSinceLastRun: null,
    hasCalibration: null,
    hasActiveSpec: false,
    marginTight: true,
    aiBudgetExhausted: true,
  }))
  assert.match(note, /broker_fail=3/)
  // 모르는 것은 0 이 아니라 unknown 으로 보인다
  assert.match(note, /since_run=unknown/)
  assert.match(note, /margin_tight=true/)
  assert.match(note, /ai_budget_out=true/)
  assert.match(note, /unmeasured=minutesSinceLastRun\+hasCalibration/)
})

test('못 잰 것이 없으면 unmeasured 가 줄에 안 뜬다', () => {
  const note = measurementNote(foldMeasurement({
    brokerFailureStreak: 0, minutesSinceLastRun: 1,
    hasCalibration: true, hasActiveSpec: true, marginTight: false, aiBudgetExhausted: false,
  }))
  assert.doesNotMatch(note, /unmeasured/)
})
