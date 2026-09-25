/**
 * 체결 재현 — **사람이 따라 했다면**
 *
 * 신호 시점 가격으로 재면 사람이 없는 세계의 성적이 나온다. 지연·슬리피지·진입 한계
 * 셋을 빼고 남는 것이 진짜 기대값이다.
 *
 * 특히 **한 봉 안에서 손절과 목표가 모두 닿은 경우**를 본다. 1분 봉은 순서를 안 알려 준다 —
 * 유리한 쪽을 고르면 백테스트만 잘 나오고 실전에서 그만큼 빠진다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replayExecution, ambiguousRatio, type ReplayParams, type ExitPlan } from './execution.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

const T0 = Date.parse('2026-09-25T01:00:00.000Z')
const MIN = 60_000
const at = (m: number) => new Date(T0 + m * MIN)

const bar = (m: number, o: number, h: number, l: number, c: number): MinuteBarInput =>
  ({ startAt: at(m), open: o, high: h, low: l, close: c, volume: 10 })

const PLAN: ExitPlan = {
  stopPrice: 1098,
  targetPrice: 1103,
  chaseLimitPrice: 1100.6,
  timeExitMinutes: 15,
  sessionCloseAt: at(300),
}

const BASE: ReplayParams = {
  direction: 'long',
  signalPrice: 1100,
  signalAt: at(0),
  plan: PLAN,
  delayMinutes: 2,
  orderKind: 'market',
  slippagePoints: 0.04,
  stopSlippagePoints: 0.04,
  contractValue: 50_000,
  roundTripFeeKrw: 0,
}

test('지연 후 첫 봉의 시가로 들어간다 — 종가를 쓰면 그 1분을 미리 안 것이다', () => {
  const r = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1100.0, 1100.3),
    bar(3, 1100.3, 1103.5, 1100.2, 1103.2),
  ])
  assert.equal(r.filled, true)
  assert.equal(r.entryPrice, 1100.24, '시가 1100.2 + 슬리피지 0.04')
  assert.equal(r.entryAt?.getTime(), at(2).getTime())
})

test('★ 지연 후 가격이 진입 한계를 넘으면 안 따라간다', () => {
  const r = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.9, 1101.5, 1100.8, 1101.2), // 한계 1100.6 을 넘음
  ])
  assert.equal(r.filled, false)
  assert.equal(r.reason, 'beyond_chase_limit')
  assert.equal(r.netPnlKrw, 0)
})

test('★ 숏은 아래쪽이 한계다 — 방향을 안 따지면 숏이 늘 통과한다', () => {
  const short: ReplayParams = {
    ...BASE, direction: 'short', signalPrice: 1100,
    plan: { ...PLAN, stopPrice: 1102, targetPrice: 1097, chaseLimitPrice: 1099.4 },
  }
  // 지연 후 1099.0 → 숏 한계 1099.4 보다 아래라 안 따라간다
  const blocked = replayExecution(short, [bar(1, 1100, 1100.1, 1099.9, 1100), bar(2, 1099.0, 1099.2, 1098.8, 1099)])
  assert.equal(blocked.filled, false, '숏에서 아래쪽 한계를 안 봤다')
  assert.equal(blocked.reason, 'beyond_chase_limit')

  // 1099.5 는 한계 안이다
  const ok = replayExecution(short, [
    bar(1, 1100, 1100.1, 1099.9, 1100),
    bar(2, 1099.5, 1099.6, 1099.4, 1099.5),
    bar(3, 1099.4, 1099.5, 1096.5, 1096.8),
  ])
  assert.equal(ok.filled, true)
})

test('★ 슬리피지로 한계를 넘어도 안 따라간다', () => {
  const r = replayExecution({ ...BASE, slippagePoints: 1.0 }, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.5, 1100.7, 1100.4, 1100.6), // 시가는 한계 안, 슬리피지 얹으면 1101.5
  ])
  assert.equal(r.filled, false)
  assert.equal(r.reason, 'slipped_beyond_chase_limit')
})

// ── 청산 ─────────────────────────────────────────────────

test('목표가에 닿으면 목표가로 나간다 — 지정가라 슬리피지가 없다', () => {
  const r = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1100.0, 1100.3),
    bar(3, 1100.3, 1103.5, 1100.2, 1103.2),
  ])
  assert.equal(r.exitKind, 'target')
  assert.equal(r.exitPrice, 1103)
  assert.equal(r.netPnlKrw, Math.round((1103 - 1100.24) * 50_000))
})

test('손절가에 닿으면 손절가에서 더 밀려 나간다', () => {
  const r = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1100.0, 1100.3),
    bar(3, 1100.3, 1100.4, 1097.5, 1097.8),
  ])
  assert.equal(r.exitKind, 'stop')
  assert.equal(r.exitPrice, 1097.96, '손절 1098 에서 0.04 더 밀림')
  assert.ok(r.netPnlKrw < 0)
})

test('★ 한 봉 안에서 둘 다 닿으면 불리한 쪽(손절)으로 센다', () => {
  const r = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1100.0, 1100.3),
    // 고가가 목표를 넘고 저가가 손절을 뚫었다 — 순서를 모른다
    bar(3, 1100.3, 1103.5, 1097.5, 1101),
  ])
  assert.equal(r.exitKind, 'stop', '유리한 쪽을 골랐다 — 실전에서 그만큼 빠진다')
  assert.equal(r.ambiguousBar, true, '애매한 봉이었다는 사실이 안 남았다')
  assert.equal(r.reason, 'both_touched_same_bar')
})

test('★ 애매한 봉 비율을 셀 수 있다 — 높으면 그 성적 자체를 의심해야 한다', () => {
  const clean = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1), bar(2, 1100.2, 1100.4, 1100, 1100.3),
    bar(3, 1100.3, 1103.5, 1100.2, 1103.2),
  ])
  const dirty = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1), bar(2, 1100.2, 1100.4, 1100, 1100.3),
    bar(3, 1100.3, 1103.5, 1097.5, 1101),
  ])
  assert.equal(ambiguousRatio([clean, dirty]), 0.5)
  assert.equal(ambiguousRatio([]), 0)
})

test('시간 청산은 진입 후 N분이 지나면 시장가로 나간다', () => {
  const bars = [bar(1, 1100, 1100.2, 1099.8, 1100.1), bar(2, 1100.2, 1100.4, 1100, 1100.3)]
  for (let m = 3; m <= 20; m += 1) bars.push(bar(m, 1100.3, 1100.5, 1100.1, 1100.3))
  const r = replayExecution(BASE, bars)
  assert.equal(r.exitKind, 'time')
  assert.equal(r.exitAt?.getTime(), at(17).getTime(), '진입 2분 + 15분')
  assert.equal(r.exitPrice, 1100.26, '시가 1100.3 에서 슬리피지 0.04 밀림')
})

test('당일 청산 시각이 오면 시간 청산보다 먼저 나간다', () => {
  const plan = { ...PLAN, sessionCloseAt: at(5), timeExitMinutes: 60 }
  const bars = [bar(1, 1100, 1100.2, 1099.8, 1100.1), bar(2, 1100.2, 1100.4, 1100, 1100.3)]
  for (let m = 3; m <= 10; m += 1) bars.push(bar(m, 1100.3, 1100.5, 1100.1, 1100.3))
  const r = replayExecution({ ...BASE, plan }, bars)
  assert.equal(r.exitKind, 'session_close')
  assert.equal(r.exitAt?.getTime(), at(5).getTime())
})

test('★ 봉이 떨어지면 0원으로 때우지 않고 마지막 종가로 청산한다', () => {
  const r = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1100, 1100.3),
    bar(3, 1100.3, 1100.5, 1100.2, 1100.4),
  ])
  assert.equal(r.filled, true)
  assert.equal(r.reason, 'ran_out_of_bars', '구간 끝 거래를 조용히 버리면 성적이 좋아진다')
  assert.equal(r.exitKind, 'session_close')
})

// ── 지정가 ───────────────────────────────────────────────

test('지정가는 가격이 신호가로 돌아온 경우만 체결된다', () => {
  const limit: ReplayParams = { ...BASE, orderKind: 'limit' }
  // 지연 후 봉의 저가가 1100 이하로 안 내려왔다
  const missed = replayExecution(limit, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.5, 1100.6, 1100.3, 1100.5),
  ])
  assert.equal(missed.filled, false)
  assert.equal(missed.reason, 'limit_not_touched')

  const touched = replayExecution(limit, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.3, 1100.4, 1099.9, 1100.2),
    bar(3, 1100.2, 1103.5, 1100.1, 1103.2),
  ])
  assert.equal(touched.filled, true)
  assert.equal(touched.entryPrice, 1100, '지정가는 신호가 그대로다')
})

// ── 미래 참조 금지 (M5) ──────────────────────────────────

test('★ 뒤에 무슨 봉이 오든 앞의 청산 결과가 안 바뀐다', () => {
  const head = [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1100, 1100.3),
    bar(3, 1100.3, 1103.5, 1100.2, 1103.2), // 여기서 목표 체결
  ]
  const a = replayExecution(BASE, head)
  const b = replayExecution(BASE, [...head, bar(4, 1103, 1103.2, 1090, 1091)])
  assert.deepEqual(
    { k: a.exitKind, p: a.exitPrice, n: a.netPnlKrw },
    { k: b.exitKind, p: b.exitPrice, n: b.netPnlKrw },
    '나중 봉이 앞의 청산을 바꿨다 — 미래를 봤다는 뜻이다',
  )
})

test('★ 진입한 봉 안의 움직임으로 청산하지 않는다 — 같은 봉의 순서를 모른다', () => {
  // 진입 봉의 저가가 손절을 뚫었지만, 그 봉에서는 청산하지 않는다
  const r = replayExecution(BASE, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1097.0, 1100.3), // 진입 봉인데 저가가 손절 아래
    bar(3, 1100.3, 1103.5, 1100.2, 1103.2),
  ])
  assert.equal(r.exitKind, 'target', '진입한 봉 안에서 손절시켰다 — 들어가기 전 저가일 수도 있다')
})

test('수수료가 순손익에서 빠진다', () => {
  const r = replayExecution({ ...BASE, roundTripFeeKrw: 3_000 }, [
    bar(1, 1100, 1100.2, 1099.8, 1100.1),
    bar(2, 1100.2, 1100.4, 1100, 1100.3),
    bar(3, 1100.3, 1103.5, 1100.2, 1103.2),
  ])
  assert.equal(r.costKrw, 3_000)
  assert.equal(r.netPnlKrw, Math.round((1103 - 1100.24) * 50_000) - 3_000)
})
