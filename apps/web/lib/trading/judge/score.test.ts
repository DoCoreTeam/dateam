/**
 * 판단 채점 — **안 끝난 것을 진 것으로 세지 않는다**
 *
 * 정보 서비스의 신뢰는 적중률에서 나오는데, 그 숫자가 조금이라도 유리하게 또는
 * 불리하게 기울면 그 뒤 모든 판단이 그 숫자 위에서 이뤄진다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreJudgment, summarizeScores, isSettled, isHit, type ScoreParams } from './score.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const START = new Date('2026-09-28T00:00:00.000Z')

/** 평평한 봉 위에 원하는 자리에서만 움직임을 주는 판을 만든다 */
function bars(count: number, move: (i: number) => number = () => 0): MinuteBarInput[] {
  return Array.from({ length: count }, (_, i) => {
    const price = 400 + move(i)
    return {
      startAt: new Date(START.getTime() + i * 60_000),
      open: price, high: price + 0.3, low: price - 0.3, close: price, volume: 10,
    }
  })
}

const PARAMS: ScoreParams = {
  indicators: { atrPeriod: 14, smaFastPeriod: 5, smaSlowPeriod: 20, breakoutPeriod: 20 },
  exit: { stopAtrMultiple: 1.2, targetAtrMultiple: 1.5, chaseAtrMultiple: 8, timeExitMinutes: 15 },
  instrument: { multiplier: 250_000, tickSize: 0.05 },
  quantity: 1,
  delayMinutes: 1,
  orderKind: 'market',
  slippagePoints: 0,
  stopSlippagePoints: 0,
  roundTripFeeKrw: 0,
  sessionCloseAt: () => new Date(START.getTime() + 10_000 * 60_000),
}

/** 25번 봉에서 난 판단 하나 */
const AT_25 = {
  id: 'j1', judge: 'jev', direction: 'long' as const,
  barCloseAt: new Date(START.getTime() + 26 * 60_000).toISOString(),
}

test('★ 목표에 닿으면 적중이다', () => {
  // 25번 봉 뒤로 크게 오른다 → 롱 목표에 닿는다
  const all = bars(60, (i) => (i > 26 ? (i - 26) * 0.4 : Math.sin(i) * 0.5))
  const s = scoreJudgment(AT_25, all, PARAMS)
  assert.equal(s.outcome, 'target', `목표에 안 닿았다고 한다: ${s.outcome}/${s.reason}`)
  assert.ok(isHit(s) && isSettled(s))
  assert.ok((s.netPnlR ?? 0) > 0, '목표에 닿았는데 손익이 양수가 아니다')
  // 계획은 그 판단의 봉을 기준으로 선다
  assert.equal(s.barAt, all[25].startAt.toISOString())
  assert.equal(s.referencePrice, all[25].close)
})

test('★ 손절에 닿으면 빗나감이고, 적중률 분모에는 든다', () => {
  const all = bars(60, (i) => (i > 26 ? -(i - 26) * 0.4 : Math.sin(i) * 0.5))
  const s = scoreJudgment(AT_25, all, PARAMS)
  assert.equal(s.outcome, 'stop', `손절에 안 닿았다고 한다: ${s.outcome}/${s.reason}`)
  assert.equal(isHit(s), false)
  assert.ok(isSettled(s), '손절이 분모에서 빠지면 적중률이 100% 가 된다')
  assert.ok((s.netPnlR ?? 0) < 0, '손절인데 손익이 음수가 아니다')
})

/**
 * **이것이 이 파일의 핵심이다.**
 *
 * `replayExecution` 은 구간 끝에 걸린 거래를 마지막 봉 종가로 정리하고 `ran_out_of_bars`
 * 라고 적는다. 백테스트에서는 그 편이 맞다. 그런데 화면 적중률에서는 **방금 낸 판단이
 * 늘 그 자리에 걸리므로**, 그것을 결과로 세면 최근 판단일수록 진 것으로 잡힌다.
 */
test('★ 뒤 봉이 모자라면 「아직」이지 「빗나감」이 아니다', () => {
  // 판단 직후에 봉이 끊긴다 — 아직 아무것도 안 닿았다
  const all = bars(29, (i) => Math.sin(i) * 0.5)
  const s = scoreJudgment(AT_25, all, PARAMS)
  assert.equal(s.outcome, 'pending', `안 끝난 것을 ${s.outcome} 으로 센다`)
  assert.equal(isSettled(s), false, '안 끝난 것이 적중률 분모에 든다')
  assert.equal(s.netPnlR, null, '안 끝났는데 손익을 적는다 — 0 이 아니라 모름이다')
  assert.equal(s.netPnlKrw, null)
  // 계획은 세워졌으므로 얼마에 들어가고 끊는지는 말할 수 있다
  assert.ok(s.stopPrice !== null && s.targetPrice !== null)
})

test('★ 지표가 모자라면 계획을 안 세운다 — 지어낸 값으로 채점하지 않는다', () => {
  const all = bars(60, (i) => Math.sin(i) * 0.5)
  const early = { ...AT_25, barCloseAt: new Date(START.getTime() + 3 * 60_000).toISOString() }
  const s = scoreJudgment(early, all, PARAMS)
  assert.equal(s.outcome, 'no_plan')
  assert.match(s.reason, /not_enough_bars/)
  assert.equal(s.referencePrice, null)
  assert.equal(isSettled(s), false)
})

test('★ 차트에 없는 봉이면 지어내지 않는다', () => {
  const all = bars(60)
  const ghost = { ...AT_25, barCloseAt: '2020-01-01T00:00:00.000Z' }
  assert.equal(scoreJudgment(ghost, all, PARAMS).reason, 'bar_not_found')
  assert.equal(scoreJudgment({ ...AT_25, barCloseAt: '언제인지 모름' }, all, PARAMS).reason,
    'bar_close_at_unreadable')
})

/* ── 요약은 돈으로 말한다 ── */

/**
 * 사용자 지시 2026-09-29: 「결국 돈 버는게 핵심이야 수익 관점에서 다 움직여야 하는거야」.
 * **적중률이 높아도 평균 손익이 음수면 그 예측은 돈을 잃는다** — 작게 여러 번 이기고
 * 크게 한 번 지는 판이 그렇다. 그래서 요약은 둘을 같이 낸다.
 */
test('★ 요약이 적중률과 손익을 같이 낸다 — 적중률만으로는 돈이 되는지 모른다', () => {
  const up = bars(60, (i) => (i > 26 ? (i - 26) * 0.4 : Math.sin(i) * 0.5))
  const down = bars(60, (i) => (i > 26 ? -(i - 26) * 0.4 : Math.sin(i) * 0.5))
  const scores = [
    scoreJudgment(AT_25, up, PARAMS),
    scoreJudgment({ ...AT_25, id: 'j2' }, down, PARAMS),
    scoreJudgment({ ...AT_25, id: 'j3' }, bars(29), PARAMS),
  ]
  const sum = summarizeScores(scores)
  assert.equal(sum.settled, 2, '결판난 건수가 틀렸다')
  assert.equal(sum.hit, 1)
  assert.equal(sum.pending, 1, '안 끝난 것을 안 센다')
  assert.equal(sum.hitRate, 0.5)
  assert.ok(sum.totalR !== null && sum.averageR !== null, '손익을 안 낸다 — 적중률만으로는 돈이 되는지 모른다')
  assert.ok(sum.netKrw !== null, '원 손익을 안 낸다')
})

test('★ 결판난 것이 0건이면 적중률은 0% 가 아니라 모름이다', () => {
  const sum = summarizeScores([scoreJudgment(AT_25, bars(29), PARAMS)])
  assert.equal(sum.settled, 0)
  assert.equal(sum.hitRate, null, '0% 로 적으면 「다 틀렸다」는 사실이 된다')
  assert.equal(sum.averageR, null)
  assert.equal(sum.pending, 1)
})

test('★ 채점이 체결 재현을 새로 안 적는다 (M4)', () => {
  const src = readFileSync(join(HERE, 'score.ts'), 'utf8')
  assert.match(src, /replayExecution\(/, '백테스트가 쓰는 함수를 안 쓴다')
  assert.match(src, /buildExitPlan\(/, '청산 계획을 여기서 새로 짓는다')
  // 목표·손절 판정을 이 파일에서 다시 적으면 화면과 검증이 갈린다
  assert.equal(/bar\.high\s*>=|bar\.low\s*<=/.test(src), false,
    '닿았는지를 이 파일에서 또 판정한다 — 화면 적중률과 검증 성적이 갈린다')
})
