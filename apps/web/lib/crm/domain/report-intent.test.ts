// lib/crm/domain/report-intent.test.ts — 도우미가 「모델 없이도」 알아듣는지
//
// **이 가드가 막는 것**: 도우미를 모델 한 번에 전부 맡기는 설계.
// 회사 보강 37건이 전부 할당량 초과로 죽은 적이 있다(마지막 2026-08-24).
// 규칙이 흔한 말을 풀지 못하면, 할당량이 막힌 날 도우미는 통째로 없는 기능이 된다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseReportAsk, parsePeriod, parseMetric, parseAxes, parseHints, describeIntent,
} from './report-intent.ts'
import { formatPeriodKey } from './target.ts'

const TODAY = '2026-09-09'

test('★ 흔한 물음을 모델 없이 푼다', () => {
  const i = parseReportAsk('이번 분기 파이프라인별 수주 얼마야?', TODAY)
  assert.equal(i.metric, 'bookings')
  assert.equal(i.rows, 'pipeline')
  assert.equal(formatPeriodKey(i.period!), 'QUARTER:2026:3')
  assert.deepEqual(i.unresolved, [], '규칙이 다 풀었으면 못 알아들은 것이 없어야 한다')
})

test('숫자가 상대말을 이긴다 — 「2026년 3분기」는 그 분기다', () => {
  assert.equal(formatPeriodKey(parsePeriod('2026년 3분기 실적', TODAY)!), 'QUARTER:2026:3')
  assert.equal(formatPeriodKey(parsePeriod('작년 상반기', TODAY)!), 'HALF:2026:1',
    '연도 없이 상반기면 올해다 — 「작년」은 종류가 반기라 숫자에 진다')
})

test('상대말 — 이번·지난·다음이 기간을 옮긴다', () => {
  assert.equal(formatPeriodKey(parsePeriod('이번 달', TODAY)!), 'MONTH:2026:9')
  assert.equal(formatPeriodKey(parsePeriod('지난달 수주', TODAY)!), 'MONTH:2026:8')
  assert.equal(formatPeriodKey(parsePeriod('지난 분기', TODAY)!), 'QUARTER:2026:2')
})

test('★ 해 경계를 넘는다 — 1분기의 지난 분기는 작년 4분기다', () => {
  assert.equal(formatPeriodKey(parsePeriod('지난 분기', '2026-02-01')!), 'QUARTER:2025:4')
  assert.equal(formatPeriodKey(parsePeriod('지난달', '2026-01-05')!), 'MONTH:2025:12')
})

test('기간을 안 말하면 null 이다 — 아무 기간이나 고르지 않는다', () => {
  assert.equal(parsePeriod('수주 얼마야', TODAY), null)
  const i = parseReportAsk('수주 얼마야', TODAY)
  assert.ok(i.unresolved.includes('어느 기간을 볼지'))
})

test('★ 지표 이름을 선언에서 읽는다 — 긴 이름이 먼저 걸린다', () => {
  assert.equal(parseMetric('성사 건수 알려줘'), 'won_count')
  assert.equal(parseMetric('수주 알려줘'), 'bookings')
  assert.equal(parseMetric('가중 예상'), 'weighted')
  assert.equal(parseMetric('기한 지난 딜'), 'overdue')
  assert.equal(parseMetric('오늘 날씨'), null, '모르는 말에 지표를 지어내지 않는다')
})

test('축 두 개면 먼저 말한 것이 행이다', () => {
  const a = parseAxes('담당자별 분기별로 보여줘')
  assert.equal(a.rows, 'owner')
  assert.equal(a.cols, 'quarter')
  const b = parseAxes('분기별 담당자별')
  assert.equal(b.rows, 'quarter')
  assert.equal(b.cols, 'owner')
})

test('축을 안 말하면 둘 다 null 이다', () => {
  assert.deepEqual(parseAxes('이번 분기 수주'), { rows: null, cols: null })
})

/**
 * P-1 — **값을 코드에 적지 않는다.**
 *
 * 「공공」이 파이프라인 이름인지 산업 이름인지는 데이터만 안다.
 * 파서는 낱말만 넘기고 판정은 서버가 실제 축 값과 맞춰서 한다.
 */
test('★ 값은 판정하지 않고 힌트로만 남긴다', () => {
  const i = parseReportAsk('이번 분기 공공 파이프라인별 수주', TODAY)
  assert.ok(i.hints.includes('공공'), '모르는 낱말은 힌트로 넘겨야 서버가 찾을 수 있다')
  assert.equal(i.metric, 'bookings')
})

test('★ 파서에 값이 박혀 있지 않다', () => {
  const src = readFileSync(new URL('./report-intent.ts', import.meta.url), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const v of ['B2B', 'B2G', '공공', '대학', '제조', '금융', '서울', 'KDC']) {
    assert.ok(!body.includes(v), `파서에 값 「${v}」이 박혀 있다 — 데이터에서 와야 한다(P-1)`)
  }
})

test('지표 이름을 손으로 나열하지 않는다 — 선언에서 읽는다', () => {
  const src = readFileSync(new URL('./report-intent.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('METRICS') && src.includes('DIMENSIONS'),
    '선언을 안 읽으면 지표를 더해도 도우미가 못 알아듣는다')
})

test('읽어주기 — 실행 전에 무엇으로 이해했는지 사람 말로 준다', () => {
  const i = parseReportAsk('이번 분기 담당자별 수주', TODAY)
  const line = describeIntent(i, (k, key) => (k === 'metric' ? '수주' : '담당자'), () => '2026년 3분기')
  assert.match(line, /2026년 3분기/)
  assert.match(line, /수주/)
  assert.match(line, /담당자/)
})

test('빈 말에는 아무것도 하지 않는다', () => {
  const i = parseReportAsk('   ', TODAY)
  assert.equal(i.metric, null)
  assert.equal(i.period, null)
  assert.deepEqual(i.hints, [])
})

test('파서는 순수하다 — DB 도 모델도 모른다', () => {
  const src = readFileSync(new URL('./report-intent.ts', import.meta.url), 'utf8')
  for (const banned of ['@prisma/client', 'getCrmDb', 'fetch(', 'gemini', 'runAi']) {
    assert.ok(!src.includes(banned), `파서가 ${banned} 를 안다 — 할당량이 막히면 같이 죽는다`)
  }
})

test('힌트에서 지표·축·기간 말은 빠진다 — 그건 이미 풀린 것이다', () => {
  const h = parseHints('이번 분기 파이프라인별 수주', { metric: 'bookings', rows: 'pipeline', cols: null })
  assert.deepEqual(h, [], '이미 푼 말이 힌트로 남으면 서버가 엉뚱한 조건을 건다')
})
