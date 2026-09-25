/**
 * 백테스트 — **실시간과 같은 함수를 쓰는가**, **미래를 안 보는가**
 *
 * 백테스트용으로 진입 조건을 따로 적으면 고칠 때 한쪽만 고치는 날이 온다.
 * 그날부터 백테스트는 실제로 안 도는 전략의 성적을 말하고, 그 성적으로 관문을 통과한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBacktest, buildExitPlan, type BacktestParams } from './run.ts'
import { createRuleJudge } from '../judge/rule.ts'
import type { Judge, JudgeResult } from '../judge/types.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = Date.parse('2026-09-25T00:00:00.000Z')
const MIN = 60_000
const at = (m: number) => new Date(T0 + m * MIN)

const PARAMS: BacktestParams = {
  triggers: {
    atrPeriod: 3, smaFastPeriod: 2, smaSlowPeriod: 4,
    breakoutPeriod: 3, breakoutAtrMultiple: 0,
  },
  exit: { stopAtrMultiple: 1.2, targetAtrMultiple: 1.5, chaseAtrMultiple: 0.3, timeExitMinutes: 15 },
  instrument: { multiplier: 50_000, tickSize: 0.02 },
  quantity: 1,
  delayMinutes: 1,
  orderKind: 'market',
  slippageTicks: 1,
  stopSlippageTicks: 2,
  roundTripFeeKrw: 0,
  sessionCloseAt: () => at(10_000),
  isDecidable: () => true,
  minutesSinceOpen: (d) => Math.round((d.getTime() - T0) / MIN),
}

/** 계단식으로 오르다 급등하는 봉들 — 돌파 조건이 걸린다 */
function risingBars(count: number): MinuteBarInput[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 1100 + i * 0.1
    const jump = i === 20 ? 3 : 0
    return {
      startAt: at(i),
      open: base, high: base + 0.5 + jump, low: base - 0.5, close: base + jump, volume: 10,
    }
  })
}

test('청산 계획이 방향에 따라 부호를 바꾼다 (§8)', () => {
  const long = buildExitPlan('long', 1100, 2, PARAMS.exit, at(500))
  assert.equal(long.stopPrice, 1100 - 2.4)
  assert.equal(long.targetPrice, 1100 + 3)
  assert.equal(long.chaseLimitPrice, 1100 + 0.6)

  const short = buildExitPlan('short', 1100, 2, PARAMS.exit, at(500))
  assert.equal(short.stopPrice, 1100 + 2.4)
  assert.equal(short.targetPrice, 1100 - 3)
  assert.equal(short.chaseLimitPrice, 1100 - 0.6)
})

test('과거 봉을 돌리면 거래가 나온다', async () => {
  const summary = await runBacktest(risingBars(60), createRuleJudge(), PARAMS)
  assert.ok(summary.trades.length > 0, '조건이 하나도 안 걸렸다 — 봉이나 조건이 잘못됐다')
  for (const t of summary.trades) {
    assert.ok(t.riskPerTradeKrw > 0, '1회 위험이 0 이면 R 을 못 낸다')
    assert.ok(t.rawScore.p_long + t.rawScore.p_short + t.rawScore.p_hold > 0.99)
  }
})

test('★ 같은 구간을 두 번 돌리면 같은 결과다 — 무작위가 없다', async () => {
  const bars = risingBars(60)
  const a = await runBacktest(bars, createRuleJudge(), PARAMS)
  const b = await runBacktest(bars, createRuleJudge(), PARAMS)
  assert.deepEqual(
    a.trades.map((t) => [t.barCloseAt.toISOString(), t.direction, t.replay.netPnlKrw]),
    b.trades.map((t) => [t.barCloseAt.toISOString(), t.direction, t.replay.netPnlKrw]),
  )
})

/**
 * **이름이 아니라 값이 가는지를 본다.**
 *
 * 처음에는 `computeIndicators(bars,` 라는 글자를 찾았다. 그런데 자르는 줄을
 * `const seen = bars` 로 바꾸면 글자는 그대로라 통과했다 — 변수 이름만 보고 있었던 것이다.
 * 그래서 **잘린 개수**를 실제로 센다.
 */
test('★ 지표가 그 시점까지의 봉만 본다 — 개수로 확인한다', async () => {
  const bars = risingBars(60)
  const seenLengths: number[] = []
  const spy: Judge = {
    name: 'rule', external: false,
    async judge(input): Promise<JudgeResult> {
      seenLengths.push(input.bars.length)
      return { status: 'abstain', abstainReason: 'spy' }
    },
  }
  await runBacktest(bars, spy, PARAMS)

  assert.ok(seenLengths.length > 0, '판단기가 한 번도 안 불렸다 — 이 시험은 아무것도 안 본다')
  for (const len of seenLengths) {
    assert.ok(len < bars.length,
      `판단기가 봉 ${len}개를 봤다 — 전체 ${bars.length}개를 넘겼다는 뜻이고 그것이 미래 참조다`)
  }
})

test('★ 뒤쪽 봉을 바꿔도 앞쪽 거래의 판단이 안 바뀐다', async () => {
  const head = risingBars(40)
  const a = await runBacktest(head, createRuleJudge(), PARAMS)
  const tail = [...head, ...Array.from({ length: 10 }, (_, i) => ({
    startAt: at(40 + i), open: 900, high: 901, low: 899, close: 900, volume: 10,
  }))]
  const b = await runBacktest(tail, createRuleJudge(), PARAMS)

  // 앞쪽에서 난 신호의 **판단**(방향·조건·원점수)은 같아야 한다
  const headSignals = a.trades.map((t) => [t.barCloseAt.toISOString(), t.direction, t.triggerId].join('|'))
  const tailSignals = b.trades
    .filter((t) => t.barCloseAt.getTime() <= at(40).getTime())
    .map((t) => [t.barCloseAt.toISOString(), t.direction, t.triggerId].join('|'))

  /**
   * **비어 있으면 이 시험은 아무것도 안 본다.** 전체 배열을 지표에 넘기는 버그를 넣었더니
   * 조건이 아예 안 걸려 거래가 0건이 됐고, `deepEqual([], [])` 가 조용히 통과했다(실측).
   * 빈 결과를 같다고 말하지 않게 개수를 먼저 못 박는다.
   */
  assert.ok(headSignals.length > 0, '앞 구간에서 신호가 0건이다 — 이 비교는 아무것도 안 본다')
  assert.deepEqual(tailSignals, headSignals, '뒤 봉이 앞 판단을 바꿨다 — 미래를 봤다')
})

test('판단 대상이 아닌 봉은 건너뛰고 그 수가 남는다', async () => {
  const summary = await runBacktest(risingBars(60), createRuleJudge(), {
    ...PARAMS, isDecidable: (d) => d.getTime() < at(30).getTime(),
  })
  assert.ok(summary.skippedNotDecidable > 0)
  assert.ok(summary.trades.every((t) => t.barCloseAt.getTime() <= at(30).getTime()))
})

test('기권한 판단은 거래가 안 되고 수만 센다', async () => {
  const abstaining: Judge = {
    name: 'rule', external: false,
    async judge(): Promise<JudgeResult> { return { status: 'abstain', abstainReason: 'x' } },
  }
  const summary = await runBacktest(risingBars(60), abstaining, PARAMS)
  assert.equal(summary.trades.length, 0)
  assert.ok(summary.abstained > 0, '기권 수를 안 세면 조건이 안 걸린 것과 구분이 안 된다')
})

test('지표가 모자란 앞쪽 봉은 건너뛰고 그 수가 남는다', async () => {
  const summary = await runBacktest(risingBars(6), createRuleJudge(), PARAMS)
  assert.ok(summary.skippedForIndicators > 0)
})

// ── M4: 같은 함수를 쓰는가 ───────────────────────────────

test('★ 백테스트가 지표·조건·판단기를 새로 안 만든다 (M4)', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  const src = files.map((f) => readFileSync(join(HERE, f), 'utf8')).join('\n')

  // 실시간 쪽에서 들여온다
  assert.match(src, /from '\.\.\/judge\/indicators\.ts'/, '지표를 실시간 쪽에서 안 들여온다')
  assert.match(src, /from '\.\.\/replay\/execution\.ts'/, '체결 재현을 안 들여온다')
  assert.match(src, /from '\.\.\/risk\/arithmetic\.ts'/, '리스크 산술을 안 들여온다')

  // 복사본을 만들지 않는다
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const name of ['function computeIndicators', 'function evaluateTriggers', 'function atr(', 'function sma(']) {
    assert.equal(body.includes(name), false,
      `백테스트에 ${name} 복사본이 있다 — 고칠 때 한쪽만 고치는 날이 온다(M4)`)
  }
})
