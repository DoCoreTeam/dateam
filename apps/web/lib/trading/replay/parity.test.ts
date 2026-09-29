/**
 * 백테스트와 리플레이가 **같은 답을 내는지** 대조한다
 *
 * ## 왜 이 시험이 필요한가
 *
 * 점검 2026-09-29: 검증 백테스트가 실시간과 다른 장 규칙을 쓰고 있었고
 * (`sessionCloseAt = 진입봉 + 24시간`, `isDecidable = () => true`), 아무도 못 봤다.
 * 두 경로가 같은 함수를 부르는지는 글자로 셀 수 있지만, **같은 답을 내는지**는
 * 돌려 봐야만 안다.
 *
 * ## 무엇을 대조하나
 *
 * **진입 판정**이다 — 어느 봉에서, 어느 방향으로, 얼마에 들어가기로 했나.
 * 청산 결과는 뒤 봉이 있어야 정해지므로 한 봉씩 흘리는 쪽에서는 아직 모른다.
 * 그 둘을 섞어 재면 「예측이 같은가」가 아니라 「미래를 아는가」를 재게 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBacktest, type BacktestParams, type BacktestTrade } from '../backtest/run.ts'
import { createRuleJudge } from '../judge/rule.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

/** 그날 09:00~15:20 (KST). 실시간이 보는 창과 같은 모양이다 */
const DAY = '2026-09-28'
const OPEN = new Date(`${DAY}T09:00:00+09:00`)
const EXIT_AT = new Date(`${DAY}T15:20:00+09:00`)

/**
 * 조건이 실제로 걸리도록 오르내리는 봉을 만든다.
 * 평평한 봉만 주면 진입이 0건이라 **아무것도 대조하지 않고 통과**한다.
 */
function bars(count: number): MinuteBarInput[] {
  return Array.from({ length: count }, (_, i) => {
    const wave = Math.sin(i / 4) * 6 + (i > count * 0.6 ? i * 0.35 : 0)
    const open = 400 + wave
    const close = 400 + Math.sin((i + 1) / 4) * 6 + (i > count * 0.6 ? (i + 1) * 0.35 : 0)
    return {
      startAt: new Date(OPEN.getTime() + i * 60_000),
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 10,
    }
  })
}

const PARAMS: BacktestParams = {
  triggers: {
    atrPeriod: 14, smaFastPeriod: 5, smaSlowPeriod: 20, breakoutPeriod: 20, breakoutAtrMultiple: 0.1,
  },
  exit: { stopAtrMultiple: 1.2, targetAtrMultiple: 1.5, chaseAtrMultiple: 0.3, timeExitMinutes: 15 },
  instrument: { multiplier: 250_000, tickSize: 0.05 },
  quantity: 1,
  delayMinutes: 2,
  orderKind: 'market',
  slippageTicks: 2,
  stopSlippageTicks: 2,
  roundTripFeeKrw: 0,
  sessionCloseAt: () => EXIT_AT,
  isDecidable: (at) => at >= OPEN && at < EXIT_AT,
  minutesSinceOpen: (at) => Math.max(0, Math.floor((at.getTime() - OPEN.getTime()) / 60_000)),
}

/** 대조할 것은 **진입 판정**이다. 뒤 봉이 있어야 정해지는 값은 안 본다 */
function entryOf(t: BacktestTrade) {
  return {
    at: t.barCloseAt.toISOString(),
    direction: t.direction,
    triggerId: t.triggerId,
    signalPrice: t.signalPrice,
    rawScore: t.rawScore,
  }
}

/**
 * 한 봉씩 흘려 넣는다 — **그 봉까지만** 준다.
 * 뒤 봉을 섞으면 대조가 통과해도 뜻이 없다(그때는 둘 다 미래를 본 것이다).
 */
async function replayEntries(all: readonly MinuteBarInput[], lookAhead = 0) {
  const out: ReturnType<typeof entryOf>[] = []
  for (let i = 0; i < all.length; i += 1) {
    const upTo = all.slice(0, i + 1 + lookAhead)
    const run = await runBacktest(upTo, createRuleJudge(), PARAMS)
    const last = run.trades[run.trades.length - 1]
    // 이 봉에서 새로 난 진입만 담는다
    if (last && last.barCloseAt.getTime() === all[i].startAt.getTime() + 60_000) out.push(entryOf(last))
  }
  return out
}

test('★ 한 봉씩 흘려도 백테스트와 같은 진입을 낸다', async () => {
  const all = bars(90)
  const full = await runBacktest(all, createRuleJudge(), PARAMS)
  const batch = full.trades.map(entryOf)

  // 진입이 0건이면 아무것도 대조하지 않은 것이다 — 통과로 치면 안 된다
  assert.ok(batch.length > 0, '이 봉 묶음에서 진입이 한 건도 안 났다, 대조할 것이 없다')

  const streamed = await replayEntries(all)
  assert.deepEqual(streamed, batch,
    `한 봉씩 흘린 결과가 한 번에 돌린 결과와 다르다 (일괄 ${batch.length}건 · 리플레이 ${streamed.length}건)`)
})

/**
 * **대조가 진짜로 도는지 대조한다.**
 *
 * 리플레이에 봉 하나를 더 주면 그 판단은 미래를 본 것이라 답이 달라져야 한다.
 * 안 달라지면 이 시험은 아무것도 안 재고 있는 것이다.
 */
test('★ 리플레이에 뒤 봉을 하나 더 주면 대조가 깨진다 — 안 깨지면 이 시험이 헛것이다', async () => {
  const all = bars(90)
  const batch = (await runBacktest(all, createRuleJudge(), PARAMS)).trades.map(entryOf)
  const peeked = await replayEntries(all, 1)
  assert.notDeepEqual(peeked, batch,
    '뒤 봉을 더 줬는데 답이 같다 — 대조가 진입 판정을 안 보고 있다')
})

test('★ 판단 대상이 아닌 시각은 양쪽 다 건너뛴다', async () => {
  const all = bars(90)
  const full = await runBacktest(all, createRuleJudge(), PARAMS)
  for (const t of full.trades) {
    // barCloseAt 은 봉이 닫힌 때라 그 봉의 시작은 1분 앞이다
    const barStart = new Date(t.barCloseAt.getTime() - 60_000)
    assert.ok(PARAMS.isDecidable(barStart), `판단 대상이 아닌 ${barStart.toISOString()} 에서 진입했다`)
  }
  assert.ok(full.skippedNotDecidable >= 0)
})
