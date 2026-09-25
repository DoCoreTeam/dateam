/**
 * `ml` 기준선 — **Jev 가 이것보다 나은가를 재는 자**
 *
 * 「Jev 가 +0.2R」은 그 자체로 아무 뜻이 없다. 지표 몇 개짜리 모델도 +0.25R 이면
 * Jev 를 쓸 이유가 없다. 그래서 기준선은 **이기기 쉬워야** 뜻이 있고, 복잡하면
 * Jev 가 못 이겨도 그것이 Jev 탓인지 기준선 과적합 탓인지 알 수 없다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { featuresOf, fitMl, predict, scoreFrom, createMlJudge, ML_FEATURE_COUNT } from './ml.ts'
import { createRuleJudge } from './rule.ts'
import type { JudgeInput } from './types.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const T0 = Date.parse('2026-09-25T01:00:00.000Z')

function bars(n: number, price = 1100): MinuteBarInput[] {
  return Array.from({ length: n }, (_, i) => ({
    startAt: new Date(T0 + i * 60_000),
    open: price, high: price + 1, low: price - 1, close: price, volume: 10,
  }))
}

const INPUT: JudgeInput = {
  asOf: new Date(T0 + 60_000),
  contractCode: 'A05610',
  decisionTf: '1m',
  bars: bars(10),
  trigger: { id: 'breakout_up', direction: 'long', detail: '' },
  minutesSinceOpen: 30,
  indicators: { atr: 2, smaFast: 1101, smaSlow: 1099, recentHigh: 1102, recentLow: 1098 },
}

test('지표를 ATR 로 나눈 상대값으로 바꾼다 — 가격 수준이 달라도 같은 자다', () => {
  const f = featuresOf(INPUT)
  assert.ok(f)
  assert.equal(f.length, ML_FEATURE_COUNT)
  for (const v of f) assert.ok(Math.abs(v) < 10, `상대값이 아니라 절대값 같다: ${v}`)
  // 방향이 마지막 자리에 들어간다
  assert.equal(f[ML_FEATURE_COUNT - 1], 1)
  const short = featuresOf({ ...INPUT, trigger: { ...INPUT.trigger, direction: 'short' } })
  assert.equal(short?.[ML_FEATURE_COUNT - 1], -1)
})

test('ATR 이 0 이면 상대값을 못 만든다', () => {
  assert.equal(featuresOf({ ...INPUT, indicators: { ...INPUT.indicators, atr: 0 } }), null)
})

test('★ 표본이 모자라거나 한쪽 답만 있으면 안 맞춘다 — 늘 같은 답을 하는 모델이 나온다', () => {
  assert.equal(fitMl([]), null)
  assert.equal(fitMl([{ features: [1, 0, 0, 0, 1], win: true }]), null)
  const allWin = Array.from({ length: 20 }, () => ({ features: [1, 0, 0, 0, 1], win: true }))
  assert.equal(fitMl(allWin), null)
})

test('★ 배울 것이 있으면 배운다 — 첫 특징이 크면 이기는 자료', () => {
  const samples = Array.from({ length: 200 }, (_, i) => {
    const x = (i % 10) / 5 - 1
    return { features: [x, 0, 0, 0, 1], win: x > 0 }
  })
  const model = fitMl(samples)
  assert.ok(model)
  const high = predict(model, [1, 0, 0, 0, 1])
  const low = predict(model, [-1, 0, 0, 0, 1])
  assert.ok(high > low, `큰 값(${high})이 작은 값(${low})보다 확률이 안 높다 — 경사 방향이 뒤집혔다`)
  assert.ok(high > 0.5 && low < 0.5)
})

test('학습은 결정론적이다 — 같은 자료에 같은 가중치', () => {
  const samples = Array.from({ length: 50 }, (_, i) => ({ features: [(i % 5) - 2, 1, 0, 0, 1], win: i % 2 === 0 }))
  assert.deepEqual(fitMl(samples), fitMl(samples))
})

test('원점수가 확률 꼴이고 한쪽으로 치우치지 않는다', () => {
  for (const p of [0, 0.3, 0.5, 0.8, 1]) {
    for (const d of ['long', 'short'] as const) {
      const score = scoreFrom(d, p)
      const sum = score.p_long + score.p_short + score.p_hold
      assert.ok(Math.abs(sum - 1) < 1e-9, `합이 ${sum}`)
      assert.ok(score.p_long <= 0.8 && score.p_short <= 0.8, '보정 곡선이 꼬리에서 표본을 못 얻는다')
      assert.ok(score.p_long >= 0 && score.p_short >= 0 && score.p_hold >= 0, '음수 확률이 나왔다')
    }
  }
})

test('모델이 없으면 기권하고 사유를 남긴다', async () => {
  const result = await createMlJudge(null).judge(INPUT)
  assert.equal(result.status, 'abstain')
  assert.equal(result.status === 'abstain' && result.abstainReason, 'no_model')
})

test('★ 모델이 안 믿으면 숏이 아니라 관망이 높다 — 아무도 숏이라고 말한 적이 없다', async () => {
  const model = fitMl(Array.from({ length: 200 }, (_, i) => {
    const x = (i % 10) / 5 - 1
    return { features: [x, 0, 0, 0, 1], win: x > 0 }
  }))
  // 이 입력은 첫 특징이 음수라 모델이 롱을 안 믿는다
  const doubted = await createMlJudge(model).judge(INPUT)
  assert.equal(doubted.status, 'completed')
  assert.ok(doubted.status === 'completed')
  const score = doubted.rawScore
  assert.ok(score.p_hold > score.p_short,
    `롱을 안 믿는데 숏(${score.p_short})이 관망(${score.p_hold})보다 높다`)
  assert.ok(score.p_hold > score.p_long, '안 믿는데 롱이 가장 높다')
})

test('모델이 믿으면 조건 방향이 가장 높다', async () => {
  const model = fitMl(Array.from({ length: 200 }, (_, i) => {
    const x = (i % 10) / 5 - 1
    return { features: [x, 0, 0, 0, 1], win: x > 0 }
  }))
  // 종가가 단기 이동평균 위로 올라간 입력
  const believing = await createMlJudge(model).judge({
    ...INPUT,
    bars: bars(10, 1105),
    indicators: { atr: 2, smaFast: 1100, smaSlow: 1098, recentHigh: 1102, recentLow: 1098 },
  })
  assert.ok(believing.status === 'completed')
  assert.ok(believing.rawScore.p_long > believing.rawScore.p_hold,
    '모델이 믿는데 관망이 더 높다')
})

// ── 셋이 같은 꼴인가 (§7.2) ──────────────────────────────

test('★ rule·ml·jev 가 같은 인터페이스다 — 특권 없음', async () => {
  const ml = createMlJudge({ weights: [1, 0, 0, 0, 0], bias: 0 })
  const rule = createRuleJudge()
  for (const judge of [ml, rule]) {
    assert.equal(typeof judge.name, 'string')
    assert.equal(typeof judge.external, 'boolean')
    assert.equal(typeof judge.judge, 'function')
    const result = await judge.judge(INPUT)
    assert.ok(['completed', 'abstain', 'failed'].includes(result.status))
  }
  assert.equal(ml.name, 'ml')
  assert.equal(ml.external, false, 'ml 은 밖으로 안 나간다 — 나간 시각을 적으면 지연 통계가 거짓이 된다')
})

test('★ 판단 계층에 지금 시각을 직접 묻는 코드가 없다 (M5)', () => {
  const src = readFileSync(join(HERE, 'ml.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.doesNotMatch(body, /new Date\(\s*\)/)
  assert.doesNotMatch(body, /Date\.now\(\s*\)/)
})

test('★ 기준선이 단순하다 — 복잡하면 Jev 비교 자체가 뜻을 잃는다', () => {
  const src = readFileSync(join(HERE, 'ml.ts'), 'utf8')
  assert.ok(ML_FEATURE_COUNT <= 8, `특징이 ${ML_FEATURE_COUNT}개다 — 기준선은 이기기 쉬워야 뜻이 있다`)
  assert.match(src, /l2/, '정칙화가 없으면 기준선이 과적합한다')
})
