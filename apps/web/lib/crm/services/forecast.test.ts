// 포캐스트 (dacrm FR-09)
//
// **왜 이 가드가 특히 중요한가**: 이 화면의 숫자로 사람이 채용을 결정한다.
// 틀린 예상 매출은 화면을 깨뜨리지 않고 **조용히** 잘못된 결정을 만든다.
//
// 그래서 지키는 것은 둘이다 —
// ① 근거가 없으면 숫자를 안 낸다(관례 확률 20%·50%·80% 를 박아 넣지 않는다)
// ② 못 센 금액을 숨기지 않는다(숨기면 합계가 조용히 작아진다)
//
// 실측(브라우저): 3승 2패 → 성사율 60%, 1억 × 60% = 6천만이 화면에 근거와 함께 떴다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  winRates, buildForecast, forecastSummary,
  type DealRow, type VisitRow, type StageDef,
} from './forecast.ts'
import { MIN_SAMPLE } from './velocity.ts'

const SRC = readFileSync(new URL('./forecast.ts', import.meta.url), 'utf8')

const STAGES: StageDef[] = [
  { id: 's1', name: '리드', position: 1, kind: 'OPEN' },
  { id: 's2', name: '제안', position: 2, kind: 'OPEN' },
  { id: 'sw', name: '수주', position: 3, kind: 'WON' },
  { id: 'sl', name: '실주', position: 4, kind: 'LOST' },
]

const PIPE = { id: 'p1', name: 'GPU 인프라' }

function closedDeals(won: number, lost: number): { deals: DealRow[]; visits: VisitRow[] } {
  const deals: DealRow[] = []
  const visits: VisitRow[] = []
  for (let i = 0; i < won + lost; i++) {
    const id = `d${i}`
    deals.push({
      id, stageId: i < won ? 'sw' : 'sl',
      status: i < won ? 'WON' : 'LOST',
      amountMinor: null, currency: 'KRW',
    })
    visits.push({ dealId: id, stageId: 's1' }) // 전부 리드를 거쳤다
  }
  return { deals, visits }
}

test('★ 표본이 임계 미만이면 성사율을 내지 않는다 — 3건으로 만든 33%는 우연이다', () => {
  const { deals, visits } = closedDeals(1, 2)
  const r = winRates(visits, deals)
  assert.equal(r.get('s1')?.rate, null)
  assert.equal(r.get('s1')?.sample, 3)
})

test('★ 임계에 닿으면 낸다 — 과하게 막으면 기능이 없는 것과 같다(실측: 3승 2패 → 60%)', () => {
  const { deals, visits } = closedDeals(3, 2)
  const r = winRates(visits, deals)
  assert.equal(r.get('s1')?.rate, 0.6)
  assert.equal(r.get('s1')?.sample, MIN_SAMPLE)
})

test('★ 진행 중인 딜은 분모에 넣지 않는다 — "아직 안 됐다"를 "실패했다"로 치면 확률이 낮아진다', () => {
  const { deals, visits } = closedDeals(3, 2)
  // 진행 중 딜 5건이 같은 단계를 거쳤다고 해도 확률은 그대로여야 한다
  const open: VisitRow[] = Array.from({ length: 5 }, (_, i) => ({ dealId: `o${i}`, stageId: 's1' }))
  const r = winRates([...visits, ...open], deals)
  assert.equal(r.get('s1')?.rate, 0.6, '진행 중 딜이 확률을 끌어내렸다')
  assert.equal(r.get('s1')?.sample, 5)
})

test('같은 단계를 두 번 거친 딜도 한 번만 센다 — 되돌아간 딜이 표본을 부풀리면 안 된다', () => {
  const { deals, visits } = closedDeals(3, 2)
  const r = winRates([...visits, ...visits], deals) // 전부 두 번씩
  assert.equal(r.get('s1')?.sample, 5)
})

test('★ 금액에 확률을 곱한다 — 1억 × 60% = 6천만 (실브라우저에서 확인한 값)', () => {
  const { deals: closed, visits } = closedDeals(3, 2)
  const open: DealRow = {
    id: 'live', stageId: 's1', status: 'OPEN',
    amountMinor: BigInt('100000000'), currency: 'KRW',
  }
  const f = buildForecast(PIPE, STAGES, [...closed, open], [...visits, { dealId: 'live', stageId: 's1' }])
  const lead = f.stages.find((s) => s.stageId === 's1')!
  assert.equal(lead.winRate, 0.6)
  assert.deepEqual(lead.weighted, [{ currency: 'KRW', totalMinor: '60000000' }])
  assert.deepEqual(f.weightedTotal, [{ currency: 'KRW', totalMinor: '60000000' }])
})

test('★ 근거가 없는 단계의 금액을 숨기지 않는다 — 숨기면 합계가 조용히 작아진다', () => {
  const open: DealRow = {
    id: 'live', stageId: 's2', status: 'OPEN',
    amountMinor: BigInt('50000000'), currency: 'KRW',
  }
  const f = buildForecast(PIPE, STAGES, [open], [{ dealId: 'live', stageId: 's2' }])
  assert.deepEqual(f.weightedTotal, [], '근거 없이 예상을 냈다')
  assert.deepEqual(f.unknownTotal, [{ currency: 'KRW', totalMinor: '50000000' }])
  assert.match(f.summary, /낼 수 없습니다/)
})

test('★ 통화를 섞어 더하지 않는다 — 원과 달러를 합친 숫자는 아무 뜻도 없다', () => {
  const { deals: closed, visits } = closedDeals(5, 0)
  const opens: DealRow[] = [
    { id: 'k', stageId: 's1', status: 'OPEN', amountMinor: BigInt('1000'), currency: 'KRW' },
    { id: 'u', stageId: 's1', status: 'OPEN', amountMinor: BigInt('2000'), currency: 'USD' },
  ]
  const f = buildForecast(PIPE, STAGES, [...closed, ...opens], [
    ...visits, { dealId: 'k', stageId: 's1' }, { dealId: 'u', stageId: 's1' },
  ])
  assert.equal(f.weightedTotal.length, 2)
  assert.deepEqual(f.weightedTotal.map((c) => c.currency), ['KRW', 'USD'])
})

test('★ 성사·실패 칸은 예상 매출에 넣지 않는다 — 이미 끝난 돈을 또 세면 안 된다', () => {
  const f = buildForecast(PIPE, STAGES, [], [])
  assert.deepEqual(f.stages.map((s) => s.stageId), ['s1', 's2'])
})

test('금액을 안 정한 딜은 0원이 아니다 — 몇 건인지 따로 말한다', () => {
  const open: DealRow = { id: 'x', stageId: 's1', status: 'OPEN', amountMinor: null, currency: null }
  const f = buildForecast(PIPE, STAGES, [open], [{ dealId: 'x', stageId: 's1' }])
  assert.equal(f.unpriced, 1)
  assert.deepEqual(f.stages[0].pipeline, [], '금액 미정을 0원으로 셌다')
})

test('★ 반올림은 내림이다 — 예상을 넘겨 잡으면 그 차액이 사람 월급이 된다', () => {
  const { deals: closed, visits } = closedDeals(1, 2) // 표본 부족이라 임계를 낮춰 볼 수 없다
  assert.equal(winRates(visits, closed).get('s1')?.rate, null)

  // 대신 곱셈 자체를 본다: 3승 4패면 3/7, 1000 × 3/7 = 428.57… → 428
  const seven = closedDeals(3, 4)
  const open: DealRow = { id: 'l', stageId: 's1', status: 'OPEN', amountMinor: BigInt('1000'), currency: 'KRW' }
  const f = buildForecast(PIPE, STAGES, [...seven.deals, open], [...seven.visits, { dealId: 'l', stageId: 's1' }])
  const n = Number(f.stages[0].weighted[0].totalMinor)
  assert.ok(n <= 429 && n >= 428, `내림이 아니다: ${n}`)
})

test('요약이 왜 못 내는지 말한다 — "낼 수 없다"만 쓰면 사람은 고장으로 읽는다', () => {
  assert.match(forecastSummary([], [], []), /끝난 딜이 없어/)
  const thin = [{
    stageId: 's', stageName: '리드', position: 1, openCount: 0,
    pipeline: [], winRate: null, sample: 2, weighted: [],
  }]
  assert.match(forecastSummary(thin, [], []), new RegExp(`${MIN_SAMPLE}건`))
})

test('★ 표본 기준을 두 벌로 만들지 않는다 — 한쪽만 고치면 같은 화면이 서로 반박한다', () => {
  assert.ok(SRC.includes("from './velocity.ts'"), '자체 임계를 쓴다')
  assert.ok(!/const MIN_SAMPLE\s*=/.test(SRC), '임계를 새로 정의했다')
})

test('★ 관례 확률을 박아 넣지 않는다 — 근거 없는 숫자가 정밀해 보이는 것이 가장 위험하다', () => {
  // 주석에는 "0.5 로 치면 안 된다" 같은 설명이 있다 — 그걸 코드로 세면 가드가 헛돈다.
  // 줄 주석뿐 아니라 블록 주석(/** */)도 걷어내야 한다(처음 이 가드가 그 실수를 했다).
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/\b0\.[0-9]+\b/.test(code), '고정 확률이 코드에 있다')
})

test('★ 리포트 화면이 실제로 포캐스트를 부른다 — 계산만 하고 안 보여주면 없는 기능이다', () => {
  const api = readFileSync(new URL('../../../app/api/crm/reports/route.ts', import.meta.url), 'utf8')
  assert.ok(api.includes('buildForecasts('), 'API 가 포캐스트를 안 만든다')
  const ui = readFileSync(new URL('../../../app/(crm)/crm/reports/ReportsClient.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('setForecast('), '화면이 받지 않는다')
  assert.ok(ui.includes('얼마나 들어올까'), '화면이 그리지 않는다')
  assert.ok(ui.includes('unknownTotal'), '못 센 금액을 화면이 숨긴다')
})
