/**
 * 패턴 리포트 — **숫자는 코드가 세고 AI 는 말로 옮기기만 한다**
 *
 * 「승률 62%」를 모델이 쓰면 그 62가 센 값인지 그럴듯한 값인지 화면에서 구별이 안 된다.
 * 그리고 그 숫자를 보고 사람이 설정을 바꾼다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computePatterns, isPatternRejection, metricsToLines, buildPatternPrompt,
  HOUR_BUCKET_MINUTES, type PatternSample,
} from './pattern-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const s = (o: Partial<PatternSample> = {}): PatternSample => ({
  tradeDate: '2026-06-01', minutesSinceOpen: 10, direction: 'long',
  triggerId: 'breakout', netPnlR: 1, ...o,
})

/** n건을 날짜를 바꿔 가며 */
function many(n: number, f: (i: number) => Partial<PatternSample> = () => ({})): PatternSample[] {
  return Array.from({ length: n }, (_, i) => s({
    tradeDate: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`, ...f(i),
  }))
}

test('★ 표본이 모자라면 리포트를 안 만든다 — 세 건으로 「패턴」이라 말하지 않는다', () => {
  const r = computePatterns({ samples: many(3), minSamples: 30, minBucketSamples: 5 })
  assert.ok(isPatternRejection(r))
  assert.match(r.reason, /^not_enough_samples:3<30/)
  assert.match(r.userMessage, /3건.*30건/)
})

test('★ 「표본이 모자라다」와 「패턴이 없다」가 다른 말이다', () => {
  const few = computePatterns({ samples: many(3), minSamples: 30, minBucketSamples: 1 })
  const enough = computePatterns({ samples: many(40), minSamples: 30, minBucketSamples: 1 })
  assert.ok(isPatternRejection(few))
  assert.ok(!isPatternRejection(enough))
  assert.equal(!isPatternRejection(enough) && enough.sampleCount, 40)
})

test('전체 승률과 평균을 센다', () => {
  const rows = [...many(20, () => ({ netPnlR: 2 })), ...many(20, () => ({ netPnlR: -1 }))]
  const m = computePatterns({ samples: rows, minSamples: 10, minBucketSamples: 1 })
  assert.ok(!isPatternRejection(m))
  assert.equal(m.overallWinRate, 0.5)
  assert.equal(m.overallMeanR, 0.5)
})

test('★ 묶음에도 하한이 있다 — 두 건짜리 칸의 승률 100% 는 패턴이 아니다', () => {
  const rows = [
    ...many(30, () => ({ triggerId: 'breakout' })),
    ...many(2, () => ({ triggerId: 'rare', netPnlR: 5 })),
  ]
  const m = computePatterns({ samples: rows, minSamples: 10, minBucketSamples: 5 })
  assert.ok(!isPatternRejection(m))
  assert.deepEqual(m.byTrigger.map((b) => b.key), ['breakout'])
  // 하한을 낮추면 보인다. 「안 보이는 것」과 「없는 것」을 설정이 가른다
  const loose = computePatterns({ samples: rows, minSamples: 10, minBucketSamples: 1 })
  assert.ok(!isPatternRejection(loose))
  assert.equal(loose.byTrigger.length, 2)
})

test('시간대를 30분 칸으로 묶는다', () => {
  assert.equal(HOUR_BUCKET_MINUTES, 30)
  const rows = [
    ...many(10, () => ({ minutesSinceOpen: 5 })),
    ...many(10, () => ({ minutesSinceOpen: 35 })),
    ...many(10, () => ({ minutesSinceOpen: 59 })),
  ]
  const m = computePatterns({ samples: rows, minSamples: 10, minBucketSamples: 1 })
  assert.ok(!isPatternRejection(m))
  assert.deepEqual(m.byHour.map((b) => b.count), [10, 20])
  assert.ok(m.byHour[0].label.includes('0~30분'))
})

test('구간과 거래일 수가 기록된다 — 무엇을 보고 만들었는지 없으면 못 믿는다', () => {
  const m = computePatterns({
    samples: [s({ tradeDate: '2026-06-01' }), s({ tradeDate: '2026-06-20' }), s({ tradeDate: '2026-06-10' })],
    minSamples: 1, minBucketSamples: 1,
  })
  assert.ok(!isPatternRejection(m))
  assert.equal(m.windowFrom, '2026-06-01')
  assert.equal(m.windowTo, '2026-06-20')
  assert.equal(m.dayCount, 3)
})

test('빈 묶음에서 0 으로 안 나눈다', () => {
  const m = computePatterns({ samples: many(10), minSamples: 1, minBucketSamples: 1 })
  assert.ok(!isPatternRejection(m))
  for (const b of [...m.byHour, ...m.byTrigger, ...m.byDirection]) {
    assert.ok(Number.isFinite(b.winRate) && Number.isFinite(b.meanR), `${b.key} 가 NaN 이다`)
  }
})

// ── AI 는 말만 한다 ──────────────────────────────────────

test('★ AI 에게 원자료가 아니라 이미 센 줄을 준다', () => {
  const m = computePatterns({ samples: many(20), minSamples: 1, minBucketSamples: 1 })
  assert.ok(!isPatternRejection(m))
  const lines = metricsToLines(m)
  assert.ok(lines[0].includes('거래일'))
  assert.ok(lines.some((l) => l.includes('승률')))
  const prompt = buildPatternPrompt(lines)
  assert.ok(prompt.includes('있는 숫자만'))
  assert.ok(prompt.includes('새로 계산하지 않는다'))
  assert.ok(prompt.includes('예측하지 않는다'))
  assert.ok(prompt.includes('설정을 바꾸라고 말하지 않는다'))
})

test('★ 셈이 AI 를 안 부른다 — 숫자가 모델을 지나면 확인할 수 없다', () => {
  const src = readFileSync(join(HERE, 'pattern-core.ts'), 'utf8')
  assert.equal(/callKnowledge|callGemini|fetch\(/.test(src), false,
    '셈 하는 자리가 AI 를 부른다 — 그 숫자가 센 값인지 아무도 확인 못 한다')
})

test('★ 숫자는 AI 응답 밖에서 온다 — 저장하는 metrics 가 코드가 센 값이다', () => {
  const src = readFileSync(join(HERE, 'pattern.ts'), 'utf8')
  const insertAt = src.indexOf('.insert({')
  const body = src.slice(insertAt, src.indexOf('.select', insertAt))
  assert.ok(body.includes('metrics,'), 'metrics 를 안 적는다')
  assert.ok(body.includes('narrative: call.ok ? call.text : null'),
    '문장을 숫자 자리에 넣는다')
  // AI 응답이 숫자 칸으로 가는 길이 없다
  assert.equal(/sample_count:\s*call|window_\w+:\s*call/.test(body), false,
    'AI 응답이 숫자 칸에 들어간다')
})

test('★ AI 가 죽어도 숫자는 남는다', () => {
  const src = readFileSync(join(HERE, 'pattern.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function makeReport'))
  // 호출 실패로 일찍 돌아가지 않는다
  const afterCall = fn.slice(fn.indexOf('const call = await callKnowledge'))
  const beforeInsert = afterCall.slice(0, afterCall.indexOf('.insert({'))
  assert.equal(/if \(!call\.ok\) return/.test(beforeInsert), false,
    'AI 가 실패하면 리포트를 통째로 버린다 — 숫자가 본체다')
})

test('★ 리포트가 설정을 안 바꾼다', () => {
  for (const f of ['pattern-core.ts', 'pattern.ts']) {
    const src = readFileSync(join(HERE, f), 'utf8')
    assert.equal(/saveTradingSetting|trading_settings/.test(src), false,
      `${f} 가 설정을 만진다 — 바꾸려면 스펙 후보를 지나야 한다`)
  }
})

test('★ 건너뛴 신호를 0R 로 세지 않는다 — 안 한 일이 진 일로 기록된다', () => {
  const src = readFileSync(join(HERE, 'pattern.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function loadSamples'))
  assert.ok(fn.includes("result === 'skipped'"), '건너뛴 신호를 안 거른다')
  assert.ok(fn.includes("result === 'expired'"), '만료된 신호를 안 거른다')
  assert.ok(fn.includes(".not('result', 'is', null)"), '결과가 안 난 신호까지 센다')
})
