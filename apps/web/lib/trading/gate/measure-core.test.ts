import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  marginTightFrom, minutesSince, foldMeasurement, measurementNote,
  spreadOf, medianSpread, spreadAbnormalFrom, barMissingOrLateFrom, foldMarket,
  MIN_SPREAD_SAMPLES,
} from './measure-core.ts'

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

// ── SG-01 스프레드 (§10.1) ────────────────────────────────

/** 같은 폭짜리 표본을 n 개. 기준선을 만들 만큼만 채운다 */
const flat = (spread: number, n = MIN_SPREAD_SAMPLES) =>
  Array.from({ length: n }, () => ({ bestBid: 400, bestAsk: 400 + spread }))

test('매도호가가 매수호가보다 낮은 줄은 없는 것으로 친다 — 0 으로 접으면 중앙값이 내려간다', () => {
  assert.equal(spreadOf({ bestBid: 400.1, bestAsk: 400 }), null)
  assert.equal(spreadOf({ bestBid: null, bestAsk: 400 }), null)
  assert.equal(spreadOf({ bestBid: Number.NaN, bestAsk: 400 }), null)
  assert.equal(spreadOf({ bestBid: 400, bestAsk: 400.5 }), 0.5)
})

test('표본이 모자라면 기준선이 없다 — 모르는 것을 평소라고 부르지 않는다', () => {
  assert.equal(medianSpread(flat(0.5, MIN_SPREAD_SAMPLES - 1)), null)
  assert.equal(medianSpread(flat(0.5, MIN_SPREAD_SAMPLES)), 0.5)
})

test('평소 폭이 0 이면 기준선이 없다 — 0 의 세 배도 0 이라 무엇이든 이상이 된다', () => {
  assert.equal(medianSpread(flat(0)), null)
})

test('기준선은 중앙값이라 한 분이 스무 배로 벌어져도 끌려가지 않는다', () => {
  const samples = [...flat(0.5, MIN_SPREAD_SAMPLES), { bestBid: 400, bestAsk: 420 }]
  const median = medianSpread(samples)
  assert.ok(median !== null && median <= 0.5, `중앙값이 ${median} 로 끌려갔다`)
})

test('★ 기준선이 없으면 스프레드 판정은 null 이다 — false 면 화면에 「호가 정상」이 뜬다', () => {
  assert.equal(spreadAbnormalFrom({
    now: { bestBid: 400, bestAsk: 410 }, baseline: null, multiple: 3,
  }), null)
  // 지금 호가를 못 읽어도 모르는 것이다
  assert.equal(spreadAbnormalFrom({
    now: { bestBid: null, bestAsk: 410 }, baseline: 0.5, multiple: 3,
  }), null)
})

test('평소의 배수를 넘으면 이상, 안 넘으면 정상', () => {
  assert.equal(spreadAbnormalFrom({
    now: { bestBid: 400, bestAsk: 402 }, baseline: 0.5, multiple: 3,
  }), true)
  assert.equal(spreadAbnormalFrom({
    now: { bestBid: 400, bestAsk: 401 }, baseline: 0.5, multiple: 3,
  }), false)
  // 딱 배수면 아직 이상이 아니다. 경계에서 매분 깜빡이면 아무도 안 본다
  assert.equal(spreadAbnormalFrom({
    now: { bestBid: 400, bestAsk: 401.5 }, baseline: 0.5, multiple: 3,
  }), false)
})

// ── SG-01 봉 결측 (§10.1) ─────────────────────────────────

test('★ 봉이 하나도 없으면 null 이다 — 수집이 한 번도 안 돈 것과 방금 돈 것은 다르다', () => {
  assert.equal(barMissingOrLateFrom({
    lastBarStartAt: null, now: new Date('2026-09-26T05:00:00Z'), lateMinutes: 2,
  }), null)
})

test('마지막 봉이 기준보다 오래됐으면 늦은 것이다', () => {
  const now = new Date('2026-09-26T05:00:00Z')
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000)
  assert.equal(barMissingOrLateFrom({ lastBarStartAt: at(1), now, lateMinutes: 2 }), false)
  assert.equal(barMissingOrLateFrom({ lastBarStartAt: at(2), now, lateMinutes: 2 }), false)
  assert.equal(barMissingOrLateFrom({ lastBarStartAt: at(3), now, lateMinutes: 2 }), true)
})

test('★ 못 잰 둘은 false 로 가되 못 쟀다는 사실이 남는다', () => {
  const folded = foldMarket({ barMissingOrLate: null, spreadAbnormal: null })
  assert.equal(folded.barMissingOrLate, false)
  assert.equal(folded.spreadAbnormal, false)
  assert.deepEqual(folded.unmeasured, ['barMissingOrLate', 'spreadAbnormal'])
})

test('실행 기록 한 줄에 SG-01 값 둘과 못 잰 것이 함께 실린다', () => {
  const gate = foldMeasurement({
    brokerFailureStreak: 0, minutesSinceLastRun: 1,
    hasCalibration: true, hasActiveSpec: true, marginTight: false, aiBudgetExhausted: false,
  })
  const note = measurementNote(gate, foldMarket({ barMissingOrLate: true, spreadAbnormal: null }))
  assert.ok(note.includes('bar_late=true'), note)
  assert.ok(note.includes('spread_wide=false'), note)
  assert.ok(note.includes('unmeasured=spreadAbnormal'), note)
  // 시장 값을 안 주면 옛 줄 그대로다 — 부르는 자리가 늘어나도 기존 기록이 안 바뀐다
  assert.equal(measurementNote(gate).includes('bar_late'), false)
})
