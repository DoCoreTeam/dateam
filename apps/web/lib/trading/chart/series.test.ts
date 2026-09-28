/**
 * 차트 한 벌 — **없을 때 무엇을 말하는지**를 먼저 묻는다
 *
 * 빈 차트는 「값이 0」으로 읽힌다. 실제로는 봉이 한 줄도 안 들어온 것이고,
 * 둘은 할 일이 완전히 다르다 (실측 2026-09-28 trading_bars 0행 · 신호 0건).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSeries, axisDomain } from './series.ts'
import { readRunReason } from '../operator/run-reason.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'
import { stripComments } from '../../ui/component-scan.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..', '..')

const BARS = [
  { startAt: '2026-09-28T00:01:00.000Z', open: 400, high: 402, low: 399, close: 401, volume: 10 },
  { startAt: '2026-09-28T00:02:00.000Z', open: 401, high: 405, low: 400, close: 404, volume: 12 },
  { startAt: '2026-09-28T00:03:00.000Z', open: 404, high: 406, low: 403, close: 405, volume: 8 },
]

const SIGNAL = {
  id: 'sig-1', direction: 'long' as const, barCloseAt: '2026-09-28T00:02:00.000Z',
  referencePrice: 404, stopPrice: 396, targetPrice: 412, calibratedProb: 0.61,
  netExpectedValueR: 0.32,
}

/* ── 있을 때 ──────────────────────────────────────────── */

test('봉과 신호가 한 벌로 나온다', () => {
  const s = buildSeries({ bars: BARS, signals: [SIGNAL], lastRunReason: null })
  assert.equal(s.bars.length, 3)
  assert.equal(s.marks.length, 1)
  assert.equal(s.blocked, null, '그릴 것이 있는데 막혔다고 말한다')
  assert.equal(s.marks[0].direction, 'long')
  assert.equal(s.marks[0].prob, 0.61)
  // 기대값은 평균표가 정한 값을 그대로 옮긴다 — 여기서 공식으로 짓지 않는다 (§7.5 D-10)
  assert.equal(s.marks[0].evR, 0.32)
  assert.equal(
    buildSeries({ bars: BARS, signals: [{ ...SIGNAL, netExpectedValueR: null }], lastRunReason: null }).marks[0].evR,
    null,
    '못 잰 기대값을 0 으로 채우면 「본전이 기대된다」가 된다',
  )
})

/**
 * **화면이 「지금 무엇을 기다리는지」를 말하려면 이 값이 있어야 한다**
 * (사용자 지적 2026-09-28 「실시간이어야 하는데 30초는 왜? 이게 뭘 하고 있는건지 모르겠네」).
 */
test('★ 마지막 봉 시각을 함께 내려 준다', () => {
  const s = buildSeries({ bars: BARS, signals: [], lastRunReason: null })
  assert.equal(s.lastBarAt, BARS[BARS.length - 1].startAt, '가장 늦은 봉이 아니다')
  // 거꾸로 와도 같은 답이어야 한다
  assert.equal(buildSeries({ bars: [...BARS].reverse(), signals: [], lastRunReason: null }).lastBarAt, s.lastBarAt)
  // 봉이 없으면 없다고 한다 — 지어내지 않는다
  assert.equal(buildSeries({ bars: [], signals: [], lastRunReason: null }).lastBarAt, null)
})

test('봉은 오래된 것부터 선다 — 표에서 거꾸로 와도', () => {
  const s = buildSeries({ bars: [...BARS].reverse(), signals: [], lastRunReason: null })
  assert.deepEqual(s.bars.map((b) => b.at), BARS.map((b) => b.startAt))
})

test('숫자가 아닌 봉은 안 그린다 — 0 으로 채우면 없던 폭락이 생긴다', () => {
  const s = buildSeries({
    bars: [...BARS, { startAt: '2026-09-28T00:04:00.000Z', open: null, high: 1, low: 1, close: 1 }],
    signals: [], lastRunReason: null,
  })
  assert.equal(s.bars.length, 3)
  assert.ok(s.domain !== null && s.domain[0] > 300, `없는 봉이 축을 끌어내렸다: ${s.domain?.[0]}`)
})

test('시각을 못 읽는 봉도 안 그린다', () => {
  const s = buildSeries({
    bars: [{ startAt: 'not-a-time', open: 1, high: 1, low: 1, close: 1 }], signals: [], lastRunReason: null,
  })
  assert.deepEqual(s.bars, [])
})

test('★ 표식이 설 봉을 여기서 한 번만 정한다 — 신호 시각은 봉이 닫힌 때다', () => {
  // 00:02 봉은 00:03 에 닫힌다. 그 신호는 00:02 봉 위에 서야 한다
  const s = buildSeries({
    bars: BARS,
    signals: [{ ...SIGNAL, barCloseAt: '2026-09-28T00:03:00.000Z' }],
    lastRunReason: null,
  })
  assert.equal(s.marks[0].barAt, '2026-09-28T00:03:00.000Z')
  const mid = buildSeries({
    bars: BARS,
    signals: [{ ...SIGNAL, barCloseAt: '2026-09-28T00:02:30.000Z' }],
    lastRunReason: null,
  })
  assert.equal(mid.marks[0].barAt, '2026-09-28T00:02:00.000Z', '봉 안의 시각이 다음 봉으로 튀었다')
  // 정한 자리는 반드시 실재하는 봉이다 — 없는 눈금에 찍으면 표식이 조용히 사라진다
  for (const m of [...s.marks, ...mid.marks]) {
    assert.ok(s.bars.some((b) => b.at === m.barAt), `없는 봉 위에 찍는다: ${m.barAt}`)
  }
})

test('봉 구간 밖의 신호는 안 찍는다 — 화면 밖의 표식은 거짓말이다', () => {
  const s = buildSeries({
    bars: BARS,
    signals: [SIGNAL, { ...SIGNAL, id: 'old', barCloseAt: '2026-09-27T00:02:00.000Z' }],
    lastRunReason: null,
  })
  assert.deepEqual(s.marks.map((m) => m.signalId), ['sig-1'])
})

test('축은 봉과 신호를 함께 담는다 — 축 밖의 손절가는 없는 손절가와 같아 보인다', () => {
  const s = buildSeries({ bars: BARS, signals: [SIGNAL], lastRunReason: null })
  const [lo, hi] = s.domain as [number, number]
  assert.ok(lo < 396, `손절가 396 이 축 밖으로 밀렸다: ${lo}`)
  assert.ok(hi > 412, `목표가 412 가 축 밖으로 밀렸다: ${hi}`)

  // 신호가 없으면 봉만으로 잡는다 — 축이 늘 넓으면 움직임이 평평해 보인다
  const barsOnly = buildSeries({ bars: BARS, signals: [], lastRunReason: null })
  assert.ok((barsOnly.domain as [number, number])[0] > lo, '신호가 없는데도 축이 그대로다')
})

test('★ 화면이 축을 또 계산하지 않게 여유까지 담아 내려준다', () => {
  const s = buildSeries({ bars: BARS, signals: [], lastRunReason: null })
  assert.deepEqual(s.domain, axisDomain(399, 406), '같은 셈이 두 벌이 된다')
})

test('축에 여유를 둔다 — 봉 하나뿐인 날에도 범위가 0 이 아니다', () => {
  const [lo, hi] = axisDomain(400, 410) as [number, number]
  assert.ok(lo < 400 && hi > 410)
  const [lo2, hi2] = axisDomain(400, 400) as [number, number]
  assert.ok(hi2 > lo2, '값이 하나면 위아래가 같아 선 하나가 된다')
  assert.equal(axisDomain(null, null), null)
})

/* ── 없을 때 ──────────────────────────────────────────── */

test('★ 봉이 0건이면 빈 배열과 막힌 사유가 함께 온다', () => {
  const s = buildSeries({
    bars: [], signals: [SIGNAL],
    lastRunReason: 'bar_not_ready|bar_retry=2/2,still_missing|broker=failed',
  })
  assert.deepEqual(s.bars, [])
  assert.deepEqual(s.marks, [], '그릴 봉이 없는데 표식만 남기면 떠 있는 점이 된다')
  assert.equal(s.domain, null)
  assert.ok(s.blocked, '왜 없는지를 안 말한다')
  assert.equal(s.blocked?.tone, 'blocked')
})

test('★ 막힌 사유는 최근 실행에서 뽑는다 — 화면이 따로 판정하지 않는다', () => {
  const reason = 'bar_not_ready|bar_retry=2/2,still_missing|broker=failed'
  const s = buildSeries({ bars: [], signals: [], lastRunReason: reason })
  // 운영 화면이 쓰는 그 함수의 결과와 **같은 줄**이어야 한다
  const fromOperator = readRunReason(reason).lines.find((l) => l.tone === 'blocked')
  assert.deepEqual(s.blocked, fromOperator)
})

test('★ 한 번도 안 돌았으면 그 사실을 말한다 — 빈 칸을 지어내지 않는다', () => {
  const s = buildSeries({ bars: [], signals: [], lastRunReason: null })
  assert.equal(s.blocked?.text, '아직 한 번도 안 돌았습니다')
  assert.equal(s.blocked?.tone, 'waiting')
})

test('막힌 것이 없는 사유면 그중 앞선 줄을 그대로 쓴다', () => {
  const s = buildSeries({ bars: [], signals: [], lastRunReason: 'not_continuous_trading|watch=off' })
  assert.deepEqual(s.blocked, readRunReason('not_continuous_trading|watch=off').headline)
})

/* ── 배선과 경계 ──────────────────────────────────────── */

function walk(dir: string): string[] {
  let out: string[] = []
  let names: string[]
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

test('★ 현황이 이 한 벌을 실제로 내려준다', () => {
  const src = stripComments(readFileSync(join(WEB, 'lib', 'trading', 'overview.ts'), 'utf8'))
  assert.match(src, /\bbuildSeries\s*\(/, '만들어 두고 안 부른다')
  assert.match(src, /\bloadBarsAsOf\s*\(/, '봉을 안 읽는다')
  assert.match(src, /chart:\s*await loadChart\(/, '한 벌을 화면에 안 내려준다')
  // 신호와 사유를 같이 넘긴다 — 하나라도 빠지면 표식이나 사유가 조용히 사라진다
  assert.match(src, /loadChart\(contractCode, now, signals, recentRuns\[0\]\?\.reason \?\? null\)/,
    '봉·신호·사유를 함께 안 넘긴다')
})

test('★ 같은 변환을 화면에서 또 적지 않는다', () => {
  const offenders = walk(join(WEB, TRADING_APP_DIR))
    .filter((f) => /bar_start_at|from\('trading_bars'\)/.test(stripComments(readFileSync(f, 'utf8'))))
    .map((f) => f.slice(WEB.length + 1))
  assert.deepEqual(offenders, [], `화면이 봉 표를 직접 읽는다:\n  ${offenders.join('\n  ')}`)
})

test('★ 창구를 새로 안 연다 (S2) — 서버 컴포넌트가 직접 읽는다', () => {
  const routes = walk(join(WEB, 'app', 'api', 'trading'))
    .filter((f) => /chart|series|bars/i.test(f))
  assert.deepEqual(routes, [], `차트용 API 라우트가 생겼다:\n  ${routes.join('\n  ')}`)

  // 현황 화면은 서버 액션이 아니라 서버에서 바로 읽는다
  const page = readFileSync(join(WEB, TRADING_APP_DIR, 'page.tsx'), 'utf8')
  assert.equal(/'use server'/.test(page), false, '현황이 서버 액션을 새로 연다')
  assert.match(stripComments(page), /loadTradingOverview\(/, '현황이 서버에서 직접 안 읽는다')
})

/* ── 화면 ─────────────────────────────────────────────── */

const PANEL = join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx')

test('★ 현황 맨 위가 그림이다', () => {
  const page = stripComments(readFileSync(join(WEB, TRADING_APP_DIR, 'page.tsx'), 'utf8'))
  const at = page.indexOf('<ChartPanel')
  assert.ok(at > 0, '현황이 그림 칸을 안 그린다')
  for (const other of ['<JevPanel', '<SignalPanel', '<PositionPanel', '<NotifyPanel', '<PushPanel']) {
    const o = page.indexOf(other)
    assert.ok(o > at, `${other} 이 그림보다 위에 있다 — 그림을 보려고 표를 지나야 한다`)
  }
  // 봉·신호·사유를 다 넘긴다. 하나라도 빠지면 그 자리가 조용히 빈다
  const props = page.slice(at, page.indexOf('/>', at))
  for (const need of ['chart={overview.chart}', 'signals={overview.signals}', 'emitProgress={overview.emitProgress}']) {
    assert.ok(props.includes(need), `${need} 를 안 넘긴다`)
  }
})

test('★ recharts 는 잘라서 불러온다 — 현황 첫 화면 비용에 안 얹는다', () => {
  const src = stripComments(readFileSync(PANEL, 'utf8'))
  assert.equal(/^\s*import\s[^\n]*from\s*'recharts'/m.test(src), false,
    '맨 위에서 통째로 들여온다 — 봉이 0건인 날에도 차트 묶음이 내려간다')
  assert.match(src, /import\('recharts'\)/, '잘라서 불러오는 자리가 없다')
})

test('★ 봉이 0건이면 빈 차트를 안 그리고 막힌 곳을 말한다', () => {
  const src = stripComments(readFileSync(PANEL, 'utf8'))
  assert.match(src, /chart\.bars\.length === 0/, '봉이 없는 날을 안 가른다')
  assert.match(src, /가격 봉이 아직 없습니다/, '왜 비었는지를 안 말한다')
  assert.match(src, /chart\.blocked/, 'I04 가 준 사유를 안 쓴다')
  // 빈 자리는 공용 부품이 그린다 — 화면마다 자작하면 생김새가 갈린다 (§2-5)
  assert.match(src, /<EmptyState/, '빈 상태를 자작했다')
  // 그림을 그리는 자리는 봉이 있을 때만 닿는다
  const empty = src.indexOf('chart.bars.length === 0')
  assert.ok(src.indexOf('<PriceChart') > empty, '봉이 0건이어도 그림을 그린다')
})

test('★ 없는 값을 0 으로 안 적는다', () => {
  const src = stripComments(readFileSync(PANEL, 'utf8'))
  assert.match(src, /UNKNOWN_TEXT/, '못 잰 기대값을 0 으로 적으면 「본전이 기대된다」가 된다')
  assert.match(src, /아직 판단이 없습니다/, '판단이 없는 날 빈 칸만 남는다')
})

test('★ 순수하다 — 읽기도 시각도 없다', () => {
  // 주석은 뺀다 — 「`server-only` 밖에 있다」고 적은 설명이 위반으로 잡히면 설명을 안 쓰게 된다
  const src = stripComments(readFileSync(join(HERE, 'series.ts'), 'utf8'))
  assert.equal(/createAdminClient|server-only|new Date\(\)|Date\.now\(\)/.test(src), false,
    '순수 모듈이 표를 읽거나 지금 시각을 본다 — 같은 값에 같은 답이 안 나온다')
})
