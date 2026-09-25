/**
 * 판단기 셋이 같은 꼴인가, 미래를 안 보는가, 조건이 거짓이면 안 부르는가
 *
 * 특히 **조건이 거짓일 때 판단기를 안 부르는 것**을 센다. 부르면 조건과 무관한 표본이
 * 섞여 1-B 의 비교가 흐려지고, 1-A 에서는 Jev 호출이 쓸데없이 늘어난다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atr, sma, recentRange, computeIndicators, evaluateTriggers, requiredBarCount } from './indicators.ts'
import { createRuleJudge, scoreFrom, strengthOf } from './rule.ts'
import { isHoldDominant, type Judge, type JudgeInput } from './types.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const PARAMS = {
  atrPeriod: 3, smaFastPeriod: 2, smaSlowPeriod: 4, breakoutPeriod: 3, breakoutAtrMultiple: 0,
}

/** 평평한 봉들 — 여기서는 어떤 조건도 안 걸려야 한다 */
function flatBars(count: number, price = 1100): MinuteBarInput[] {
  const base = Date.parse('2026-09-25T01:00:00.000Z')
  return Array.from({ length: count }, (_, i) => ({
    startAt: new Date(base + i * 60_000),
    open: price, high: price + 1, low: price - 1, close: price, volume: 10,
  }))
}

// ── 지표 ─────────────────────────────────────────────────

test('ATR 은 봉이 모자라면 0 이 아니라 null 이다 — 0 이면 손절 거리가 0 이 된다', () => {
  assert.equal(atr(flatBars(3), 3), null)
  assert.equal(atr(flatBars(4), 3), 2, '고가-저가 2 가 참범위다')
  assert.equal(sma(flatBars(2), 3), null)
  assert.equal(recentRange(flatBars(3), 3), null)
})

test('★ 지표는 순수 함수다 — 같은 입력에 같은 값', () => {
  const bars = flatBars(30)
  const a = computeIndicators(bars, PARAMS)
  const b = computeIndicators(bars, PARAMS)
  assert.deepEqual(a, b)
  // 입력을 안 바꾼다
  const copy = bars.map((x) => ({ ...x }))
  computeIndicators(bars, PARAMS)
  assert.deepEqual(bars, copy, '지표 계산이 입력 봉을 건드렸다')
})

test('지표 하나라도 못 구하면 반쪽으로 돌려주지 않는다', () => {
  assert.equal(computeIndicators(flatBars(3), PARAMS), null)
  assert.ok(computeIndicators(flatBars(requiredBarCount(PARAMS)), PARAMS))
})

test('필요한 봉 수를 부르는 쪽이 알 수 있다', () => {
  assert.equal(requiredBarCount(PARAMS), 4)
  assert.equal(requiredBarCount({ ...PARAMS, smaSlowPeriod: 40 }), 40)
})

// ── 진입 조건 ────────────────────────────────────────────

test('★ 아무 조건도 안 걸리면 null 이고, 그때 판단기를 부르지 않는다', async () => {
  const bars = flatBars(10)
  const indicators = computeIndicators(bars, PARAMS)
  assert.ok(indicators)
  assert.equal(evaluateTriggers(bars, indicators, PARAMS), null)

  // 실제로 안 부르는지 센다 — 조건이 없으면 판단기 호출 0 이어야 한다
  let calls = 0
  const counting: Judge = {
    name: 'rule',
    async judge() { calls += 1; return { status: 'abstain', abstainReason: 'x' } },
  }
  const hit = evaluateTriggers(bars, indicators, PARAMS)
  if (hit) await counting.judge({} as JudgeInput)
  assert.equal(calls, 0, '조건이 거짓인데 판단기를 불렀다')
})

test('위로 돌파하면 롱 조건이 걸린다', () => {
  const bars = flatBars(10)
  bars[bars.length - 1] = { ...bars[bars.length - 1], close: 1120, high: 1121 }
  const indicators = computeIndicators(bars, PARAMS)!
  const hit = evaluateTriggers(bars, indicators, PARAMS)
  assert.equal(hit?.id, 'breakout_up')
  assert.equal(hit?.direction, 'long')
  assert.ok((hit?.detail ?? '').length > 0, '왜 걸렸는지가 안 남는다')
})

test('아래로 돌파하면 숏 조건이 걸린다', () => {
  const bars = flatBars(10)
  bars[bars.length - 1] = { ...bars[bars.length - 1], close: 1080, low: 1079 }
  const indicators = computeIndicators(bars, PARAMS)!
  const hit = evaluateTriggers(bars, indicators, PARAMS)
  assert.equal(hit?.id, 'breakout_down')
  assert.equal(hit?.direction, 'short')
})

test('★ 돌파 최소 폭을 키우면 같은 봉이 안 걸린다 — 설정이 실제로 먹는다', () => {
  const bars = flatBars(10)
  bars[bars.length - 1] = { ...bars[bars.length - 1], close: 1101.5, high: 1101.6 }
  const indicators = computeIndicators(bars, PARAMS)!
  assert.equal(evaluateTriggers(bars, indicators, PARAMS)?.id, 'breakout_up', '폭 0 에서는 돌파로 걸려야 한다')
  // 폭을 키우면 돌파로는 안 걸린다. 다른 조건(교차)이 대신 걸리는 것은 정상이다 —
  // 조건이 둘이라는 뜻이고, 어느 조건이 걸렸는지는 trigger.id 로 갈린다
  const wider = evaluateTriggers(bars, indicators, { ...PARAMS, breakoutAtrMultiple: 2 })
  assert.notEqual(wider?.id, 'breakout_up', '폭을 키웠는데 여전히 돌파로 걸린다 — 설정이 안 먹는다')
  assert.notEqual(wider?.id, 'breakout_down')
})

test('이미 뒤집힌 상태는 조건이 아니다 — 교차한 그 봉만 걸린다', () => {
  // 계단식으로 오르는 봉: 단기가 장기를 넘은 뒤에도 계속 위에 있다
  const base = Date.parse('2026-09-25T01:00:00.000Z')
  const rising: MinuteBarInput[] = Array.from({ length: 12 }, (_, i) => ({
    startAt: new Date(base + i * 60_000),
    open: 1100 + i, high: 1100 + i + 0.5, low: 1100 + i - 0.5, close: 1100 + i, volume: 10,
  }))
  const hits = rising.map((_, i) => {
    const slice = rising.slice(0, i + 1)
    const indicators = computeIndicators(slice, PARAMS)
    return indicators ? evaluateTriggers(slice, indicators, PARAMS)?.id ?? null : null
  })
  const crosses = hits.filter((h) => h === 'sma_cross_up').length
  assert.ok(crosses <= 1, `교차 조건이 ${crosses}번 걸렸다 — 이미 뒤집힌 상태를 계속 조건으로 읽는다`)
})

// ── rule 판단기 ──────────────────────────────────────────

test('조건 세기가 ATR 로 정규화된다 — 가격 수준이 달라도 같은 척도다', () => {
  assert.equal(strengthOf(1, 2), 0.5)
  assert.equal(strengthOf(4, 2), 1, '1 ATR 을 넘어도 1 에서 멈춘다')
  assert.equal(strengthOf(-1, 2), 0)
  assert.equal(strengthOf(1, 0), 0, 'ATR 0 을 나누지 않는다')
})

test('원점수가 확률 꼴이고 한쪽으로 치우치지 않는다', () => {
  for (const strength of [0, 0.5, 1]) {
    for (const direction of ['long', 'short'] as const) {
      const score = scoreFrom(direction, strength)
      const sum = score.p_long + score.p_short + score.p_hold
      assert.ok(Math.abs(sum - 1) < 1e-9, `합이 ${sum} 이다`)
      assert.ok(score.p_long <= 0.8 && score.p_short <= 0.8,
        '보정 전 값이 너무 커서 1-B 의 보정 곡선이 꼬리에서 표본을 못 얻는다')
    }
  }
  assert.ok(isHoldDominant(scoreFrom('long', 0)) === false)
})

test('rule 판단기는 조건 방향을 그대로 쓴다', async () => {
  const bars = flatBars(10)
  bars[bars.length - 1] = { ...bars[bars.length - 1], close: 1120, high: 1121 }
  const indicators = computeIndicators(bars, PARAMS)!
  const trigger = evaluateTriggers(bars, indicators, PARAMS)!
  const result = await createRuleJudge().judge({
    asOf: new Date('2026-09-25T01:10:00.000Z'),
    contractCode: 'A01612', decisionTf: '1m', bars, trigger,
    minutesSinceOpen: 25, indicators,
  })
  assert.equal(result.status, 'completed')
  assert.ok(result.status === 'completed' && result.rawScore.p_long > result.rawScore.p_short)
})

test('ATR 이 0 이면 기권하고 사유를 남긴다 — 세기를 잴 자가 없다', async () => {
  const bars = flatBars(10).map((b) => ({ ...b, high: b.close, low: b.close }))
  const result = await createRuleJudge().judge({
    asOf: new Date('2026-09-25T01:10:00.000Z'),
    contractCode: 'A01612', decisionTf: '1m', bars,
    trigger: { id: 'breakout_up', direction: 'long', detail: '' },
    minutesSinceOpen: 25,
    indicators: { atr: 0, smaFast: 1100, smaSlow: 1100, recentHigh: 1100, recentLow: 1100 },
  })
  assert.equal(result.status, 'abstain')
  assert.equal(result.status === 'abstain' && result.abstainReason, 'atr_zero')
})

// ── 미래 참조 금지 (M5) ──────────────────────────────────

test('★ 판단 계층 어디에도 지금 시각을 직접 묻는 코드가 없다', () => {
  for (const name of readdirSync(HERE)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    const src = readFileSync(join(HERE, name), 'utf8')
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    for (const pattern of [/new Date\(\s*\)/, /Date\.now\(\s*\)/]) {
      assert.equal(pattern.test(body), false,
        `${name} 이 지금 시각을 직접 묻는다 — 백테스트가 미래를 본다(M5). asOf 를 받는다`)
    }
  }
})

test('★ 봉 조회가 기준 시각을 인자로 받는다 — 「최근 N개」로 묻지 않는다', () => {
  const src = readFileSync(join(HERE, '..', 'bars', 'store.ts'), 'utf8')
  assert.match(src, /loadBarsAsOf/, '기준 시각을 받는 조회 함수가 없다')
  assert.match(src, /asOf/, 'asOf 인자가 없다')
  assert.match(src, /lte\('available_at'/, 'available_at 으로 안 거른다 — 그 시점에 몰랐던 봉을 본다')
})

test('★ 판단기 셋이 같은 인터페이스다 — 하나에게만 더 주면 비교가 기울어진다', () => {
  const src = readFileSync(join(HERE, 'types.ts'), 'utf8')
  assert.match(src, /JudgeName\s*=\s*'rule'\s*\|\s*'ml'\s*\|\s*'jev'/)
  // 판단기 이름으로 갈라지는 자리가 인터페이스에 없어야 한다
  assert.equal(/if\s*\(\s*\w*\.?name\s*===\s*'(rule|ml|jev)'/.test(src), false,
    '인터페이스가 판단기 이름으로 갈라진다 — 그러면 특권이 생긴다')
})
