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
import { buildSeries, axisDomain, pickNowCall, callAgeLabel, isOtherDay, chartTitle, planForCall, defaultWindow, dayBreaksOf, planBaseAt } from './series.ts'
import { deadlineLeftText } from '../signal-labels.ts'
import type { PlanParams } from './series.ts'
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
  /*
    신호와 사유를 같이 넘긴다 — 하나라도 빠지면 표식이나 사유가 조용히 사라진다.

    **글자 한 벌을 통째로 맞추지 않는다.** 전에는 한 줄짜리 호출을 그대로 찾았고,
    인자가 하나 늘어 줄이 나뉘자 규칙은 그대로인데 가드가 빨개졌다.
  */
  for (const name of ['contractCode', 'now', 'signals', 'judgments', 'recentRuns[0]?.reason']) {
    assert.ok(loadChartArgs(src).includes(name), `${name} 을 함께 안 넘긴다`)
  }
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

/* ── 판단도 보여 준다 (사용자 지적 2026-09-28) ────────── */

const JUDGMENTS = [
  {
    id: 'j-ai', barCloseAt: '2026-09-28T00:02:00.000Z', judge: 'jev', status: 'completed',
    rawScore: { p_long: 0.05, p_short: 0.9, p_hold: 0.05 },
  },
  {
    id: 'j-rule', barCloseAt: '2026-09-28T00:02:00.000Z', judge: 'rule', status: 'completed',
    rawScore: { p_long: 0.2, p_short: 0.6, p_hold: 0.2 },
  },
]

/**
 * **실측 2026-09-28**: 판단 88건 · 신호 0건인데 화면은
 * 「아직 판단이 없습니다 · 판단이 한 번도 안 돌았습니다」라고 말했다.
 * 신호만 보고 판단을 안 봤기 때문이다 — 화면이 거짓말을 한 것이다.
 */
test('★ 신호가 0건이어도 판단을 봉 위에 찍는다', () => {
  const s = buildSeries({ bars: BARS, signals: [], judgments: JUDGMENTS, lastRunReason: null })
  assert.deepEqual(s.marks, [], '신호는 없다')
  assert.equal(s.calls.length, 2, '판단을 안 찍는다')
  assert.equal(s.calls[0].direction, 'short')
  assert.ok(s.calls.every((c) => s.bars.some((b) => b.at === c.barAt)), '없는 봉 위에 찍는다')
})

test('★ 안 끝난 판단과 구간 밖 판단은 안 찍는다', () => {
  const s = buildSeries({
    bars: BARS, signals: [],
    judgments: [
      ...JUDGMENTS,
      /**
       * **점수가 있는 실패 줄**로 센다. 점수를 null 로 두면 그 줄은 다른 이유(점수 없음)로도
       * 떨어져서, 상태를 안 보게 고쳐도 시험이 안 운다 — 일부러 깨 보고 알았다
       */
      { id: 'x', barCloseAt: '2026-09-28T00:02:00.000Z', judge: 'jev', status: 'failed', rawScore: { p_short: 0.99 } },
      { id: 'y', barCloseAt: '2026-09-27T00:02:00.000Z', judge: 'jev', status: 'completed', rawScore: { p_short: 1 } },
    ],
    lastRunReason: null,
  })
  assert.deepEqual(s.calls.map((c) => c.judgmentId).sort(), ['j-ai', 'j-rule'])
})

test('★ 신호가 없으면 가장 최근 판단이 「지금 예측」이 된다', () => {
  const s = buildSeries({ bars: BARS, signals: [], judgments: JUDGMENTS, lastRunReason: null })
  const call = pickNowCall({ signals: [], calls: s.calls })
  assert.equal(call?.from, 'judgment')
  assert.equal(call?.direction, 'short')
  assert.equal(call?.prob, 0.9, '같은 봉에 둘이면 AI 쪽을 앞세운다')
  assert.equal(call?.judge, 'jev')
  // 판단에는 기준가·손절·목표가 없다 — 지어내지 않는다
  assert.equal(call?.referencePrice, null)
  assert.equal(call?.evR, null)
})

test('★ 신호가 있으면 신호가 이긴다 — 관문을 다 지난 것이다', () => {
  const s = buildSeries({ bars: BARS, signals: [SIGNAL], judgments: JUDGMENTS, lastRunReason: null })
  const call = pickNowCall({ signals: [SIGNAL], calls: s.calls })
  assert.equal(call?.from, 'signal')
  assert.equal(call?.direction, 'long')
  assert.equal(call?.evR, 0.32, '신호의 기대값을 안 쓴다')
})

test('★ 둘 다 없을 때만 없다고 한다', () => {
  assert.equal(pickNowCall({ signals: [], calls: [] }), null)
})

/* ── 화면 ─────────────────────────────────────────────── */

const PANEL = join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx')

test('★ 현황 맨 위가 그림이다', () => {
  const page = stripComments(readFileSync(join(WEB, TRADING_APP_DIR, 'page.tsx'), 'utf8'))
  const at = page.indexOf('<ChartPanel')
  assert.ok(at > 0, '현황이 그림 칸을 안 그린다')
  /*
    **화면에 있는 칸을 세지, 목록을 외우지 않는다.**

    전에는 칸 이름 다섯을 손으로 적어 두었다. `PushPanel` 을 설정 화면으로 옮기자
    `indexOf` 가 -1 이 되어 「그림보다 위에 있다」로 빨개졌다 — 규칙은 지켜졌는데
    가드가 옛 목록을 보고 있었던 것이다.
  */
  const others = [...page.matchAll(/<([A-Z][A-Za-z0-9]*Panel)\b/g)]
    .filter((m) => m[1] !== 'ChartPanel')
  assert.ok(others.length >= 3, `현황에서 칸을 ${others.length}개밖에 못 찾았다 — 규칙이 헛돈다`)
  for (const m of others) {
    assert.ok(m.index! > at, `<${m[1]} 이 그림보다 위에 있다 — 그림을 보려고 표를 지나야 한다`)
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

test('★ 현황 화면이 판단을 실제로 그린다', () => {
  const panel = readFileSync(join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx'), 'utf8')
  assert.match(panel, /pickNowCall\(\{ signals, calls: chart\.calls \}\)/, '판단을 안 본다')
  assert.match(panel, /chart\.calls\.filter/, '판단 표식을 안 찍는다')
  // 판단은 아직 신호가 아니라는 사실을 같은 자리에서 말한다
  assert.match(panel, /NOT_A_SIGNAL/, '판단을 신호처럼 보여 준다')
  // 「판단이 한 번도 안 돌았습니다」는 정말 없을 때만 나와야 한다
  const at = panel.indexOf('아직 판단이 없습니다')
  assert.ok(at > panel.indexOf('call\n'), '없다는 말이 있는 것보다 앞에 있다')
})

test('★ 현황이 판단을 창구에서 받아 온다', () => {
  const overview = readFileSync(join(WEB, 'lib', 'trading', 'overview.ts'), 'utf8')
  assert.ok(loadChartArgs(overview).includes('judgments'), '판단을 안 넘긴다')
  // 여기도 인자 차례가 아니라 **값이 가는지**를 본다
  const at = overview.indexOf('buildSeries({')
  assert.ok(at > 0, '한 벌을 안 만든다')
  const args = overview.slice(at, overview.indexOf('})', at))
  for (const name of ['bars', 'signals', 'judgments', 'lastRunReason', 'plan']) {
    assert.ok(args.includes(name), `buildSeries 에 ${name} 을 안 넘긴다`)
  }
})

/* ── 차트 도움말 (사용자 지적 2026-09-28 「이거 설명도 없고」) ── */

/**
 * recharts 기본 도움말은 `dataKey` 를 그대로 찍는다 — 실측 화면에
 * `band : 1092.28,1093.3` 이 떠 있었다. 읽는 사람은 그것이 무엇인지 알 길이 없다.
 */
test('★ 봉 도움말이 기계 이름을 안 찍는다', () => {
  const panel = readFileSync(join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx'), 'utf8')
  // 기본 도움말을 그대로 쓰면 dataKey 가 샌다
  assert.equal(/<R\.Tooltip\s*\n?\s*formatter=/.test(panel), false, '기본 도움말을 쓴다')
  assert.match(panel, /<R\.Tooltip content=\{<BarTip/, '우리 도움말을 안 그린다')
  for (const word of ['시가', '고가', '저가', '종가']) {
    assert.ok(panel.includes(`'${word}'`), `${word} 를 안 보여 준다`)
  }
})

test('★ 도움말이 그 봉의 판단도 보여 준다 — 표식만 보고는 무엇을 판단했는지 모른다', () => {
  const panel = readFileSync(join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx'), 'utf8')
  const at = panel.indexOf('function BarTip')
  assert.ok(at > 0, '도움말 부품이 없다')
  const body = panel.slice(at, panel.indexOf('\n}\n', at))
  assert.match(body, /c\.barAt === row\.at/, '그 봉의 판단만 고르지 않는다')
  assert.match(body, /JUDGE_LABEL\[c\.judge\]/, '어느 판단기인지 안 말한다')
  assert.match(body, /LEANING_LABEL\[c\.direction\]/, '어느 쪽으로 기울었는지 안 말한다')
})

// ── 「지금 예측」이 언제 것인지 (I05) ──────────────────────────────

test('★ 갓 나온 판단에는 나이를 안 적는다', () => {
  const now = new Date('2026-09-28T10:00:00+09:00')
  // 늘 「1분 전」이 붙어 있으면 그 글자는 배경이 되고, 네 시간 전일 때도 안 읽힌다
  assert.equal(callAgeLabel('2026-09-28T09:59:30+09:00', now), null)
  assert.equal(callAgeLabel('2026-09-28T09:58:00+09:00', now), null)
})

test('★ 한참 지난 판단은 얼마나 전인지 적는다', () => {
  const now = new Date('2026-09-28T19:42:00+09:00')
  // 실측한 그 화면: 오후 7시42분에 오후 3시26분 판단을 「지금 예측」이라 부르고 있었다
  assert.equal(callAgeLabel('2026-09-28T15:26:00+09:00', now), '4시간 전')
  assert.equal(callAgeLabel('2026-09-28T19:30:00+09:00', now), '12분 전')
  assert.equal(callAgeLabel('2026-09-27T15:26:00+09:00', now), '1일 전')
})

test('시계가 어긋나 앞선 시각이 와도 「-3분 전」을 적지 않는다', () => {
  const now = new Date('2026-09-28T10:00:00+09:00')
  assert.equal(callAgeLabel('2026-09-28T10:05:00+09:00', now), null)
  assert.equal(callAgeLabel('망가진 값', now), null)
})

test('★ 날이 바뀌었는지 안다 — 시각만으로는 어제 것이 오늘 것으로 읽힌다', () => {
  const now = new Date('2026-09-29T09:00:00+09:00')
  assert.equal(isOtherDay('2026-09-28T15:26:00+09:00', now), true)
  assert.equal(isOtherDay('2026-09-29T08:59:00+09:00', now), false)
  // 자정 직전·직후는 KST 로 갈린다 — UTC 로 세면 아홉 시간이 밀린다
  assert.equal(isOtherDay('2026-09-29T00:01:00+09:00', now), false)
  assert.equal(isOtherDay('2026-09-28T23:59:00+09:00', now), true)
})

test('★ 화면이 나이를 그리고, 서버가 찍은 글자를 쓰지 않는다', () => {
  const src = readFileSync(join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx'), 'utf8')
  assert.ok(src.includes('callAgeLabel('), '나이를 안 잰다')
  assert.ok(src.includes('{callAge'), '재 놓고 화면에 안 그린다')
  /*
    첫 렌더에 서버 시각으로 만든 글자를 그리면 화면이 다시 그릴 때 값이 달라져
    하이드레이션이 어긋난다. 그래서 effect 안에서만 계산해야 한다.
  */
  assert.ok(/useEffect\([\s\S]{0,400}callAgeLabel\(/.test(src),
    '첫 렌더에서 나이를 계산한다 — 하이드레이션이 어긋난다')
  assert.ok(src.includes('setInterval('), '한 번만 재면 탭을 열어 둔 채로 글자가 멈춘다')
})

// ── 차트 제목이 실제로 그리는 것을 말한다 (I07) ────────────────────

test('★ 신호가 0건이면 제목이 「신호」라고 하지 않는다', () => {
  // 실측한 그 화면: 신호 0건 · 판단 44건인데 제목이 「가격과 신호」였다
  assert.equal(chartTitle({ signalCount: 0, callCount: 44 }), '1분봉 가격과 판단')
  assert.equal(chartTitle({ signalCount: 0, callCount: 0 }), '1분봉 가격')
  for (const t of [chartTitle({ signalCount: 0, callCount: 44 }), chartTitle({ signalCount: 0, callCount: 0 })]) {
    assert.doesNotMatch(t, /신호/, `안 그린 것을 제목에 적는다: ${t}`)
  }
})

test('신호가 있으면 신호라고 한다 — 관문을 다 지난 것이라 무게가 다르다', () => {
  assert.equal(chartTitle({ signalCount: 1, callCount: 0 }), '1분봉 가격과 신호')
  assert.equal(chartTitle({ signalCount: 3, callCount: 44 }), '1분봉 가격과 신호')
})

test('★ 화면이 제목을 고정값으로 안 적는다', () => {
  const src = readFileSync(join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx'), 'utf8')
  assert.ok(src.includes('chartTitle('), '제목 규칙을 안 부른다')
  assert.doesNotMatch(src, />가격과 신호</, '제목을 화면에 박아 뒀다')
})

test('★ 판단이 있으면 차트에 점이 실제로 찍힌다', () => {
  const src = readFileSync(join(WEB, TRADING_APP_DIR, 'ChartPanel.tsx'), 'utf8')
  /*
    제목만 「판단」으로 바꾸고 점을 안 찍으면 더 나빠진다 — 있다고 말해 놓고 안 보인다.
    기운 쪽이 없는(hold) 판단은 찍을 자리가 없으므로 거르는 것이 맞다.
  */
  const dots = src.slice(src.indexOf('chart.calls.filter'))
  assert.ok(src.includes('chart.calls.filter'), '판단을 거르는 자리가 없다')
  assert.ok(dots.slice(0, 200).includes('ReferenceDot'),
    '판단 점을 안 그린다 — 제목만 판단이라고 말하게 된다')
})


/**
 * `chart: await loadChart(...)` 가 실제로 넘기는 인자 글자.
 *
 * 함수 선언이 아니라 **부르는 자리**를 잘라 낸다 — 선언에 이름이 있는 것과
 * 그 값이 넘어가는 것은 다르다.
 */
function loadChartArgs(src: string): string {
  const at = src.indexOf('await loadChart(')
  if (at < 0) return ''
  let depth = 0
  for (let i = src.indexOf('(', at); i < src.length; i += 1) {
    if (src[i] === '(') depth += 1
    else if (src[i] === ')') {
      depth -= 1
      if (depth === 0) return src.slice(at, i)
    }
  }
  return ''
}


/* ── 주문 계획 (사용자 지적 2026-09-29 「주문을 어떻게 해야 하는지 모르겠어」) ── */

/** 지표를 구할 만큼 봉을 만든다. ATR 기간 14 면 15개가 필요하다 */
function manyBars(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    startAt: new Date(Date.UTC(2026, 8, 28, 0, i + 1)).toISOString(),
    open: 400 + i, high: 402 + i, low: 399 + i, close: 401 + i, volume: 10,
  }))
}

const PLAN: PlanParams = {
  atrPeriod: 14, smaFastPeriod: 5, smaSlowPeriod: 20, breakoutPeriod: 20,
  stopAtrMultiple: 1.2, targetAtrMultiple: 1.5, chaseAtrMultiple: 0.3,
  timeExitMinutes: 15, validMinutes: 10,
  sameDayExitAt: '2026-09-28T06:20:00.000Z',
}

test('★ 판단에도 계획이 선다 — 신호가 0건이어도 주문할 값이 나온다', () => {
  const bars = manyBars(30)
  const s = buildSeries({ bars, signals: [], lastRunReason: null, plan: PLAN })
  assert.ok(s.planBase, '계획 재료를 안 만든다')
  assert.equal(s.planBlocked, null, '세웠는데 못 세웠다고 말한다')

  const call = { from: 'judgment' as const, at: bars[29].startAt, direction: 'long' as const, prob: 0.85, judge: 'jev', referencePrice: null, stopPrice: null, targetPrice: null, evR: null }
  const plan = planForCall(call, s)
  assert.ok(plan, '판단에는 계획을 안 준다 — 방향과 점수만으로는 주문을 못 낸다')
  assert.equal(plan.from, 'preview', '예고를 기록으로 적는다')
  assert.equal(plan.referencePrice, bars[29].close, '기준가가 그 봉 종가가 아니다')
  // 값은 buildExitPlan 이 정한다. 롱이면 손절이 아래, 목표가 위다
  assert.ok(plan.stopPrice < plan.referencePrice, '롱인데 손절이 위에 있다')
  assert.ok(plan.targetPrice > plan.referencePrice, '롱인데 목표가 아래에 있다')
  assert.ok(plan.chaseLimitPrice !== null && plan.chaseLimitPrice > plan.referencePrice,
    '롱 진입 한계가가 기준가보다 아래다 — D-31 부호 버그다')
  assert.equal(plan.timeExitMinutes, 15)
  assert.equal(plan.validMinutes, 10)
  assert.equal(plan.sameDayExitAt, PLAN.sameDayExitAt)

  // 숏이면 부호가 뒤집힌다
  const shortPlan = planForCall({ ...call, direction: 'short' }, s)
  assert.ok(shortPlan && shortPlan.stopPrice > shortPlan.referencePrice, '숏인데 손절이 아래에 있다')
  assert.ok(shortPlan.chaseLimitPrice !== null && shortPlan.chaseLimitPrice < shortPlan.referencePrice,
    '숏 진입 한계가가 기준가보다 위다')
})

test('★ 지표를 못 구하면 계획 자리를 비우고 왜 없는지 말한다', () => {
  const s = buildSeries({ bars: BARS, signals: [], lastRunReason: null, plan: PLAN })
  assert.equal(s.planBase, null, '봉 3개로 ATR 14 를 구했다고 한다')
  assert.match(s.planBlocked ?? '', /봉이 \d+개 필요/, '몇 개가 모자란지를 안 말한다')
  // 0 으로 때우면 손절 거리가 0 이 되고 그것은 「즉시 손절」이라는 뜻이 된다
  const call = { from: 'judgment' as const, at: BARS[2].startAt, direction: 'long' as const, prob: 0.9, judge: 'jev', referencePrice: null, stopPrice: null, targetPrice: null, evR: null }
  assert.equal(planForCall(call, s), null, '재료가 없는데 계획을 지어낸다')
})

test('★ 설정을 안 주면 계획을 안 세운다 — 배수를 코드가 지어내지 않는다', () => {
  const s = buildSeries({ bars: manyBars(30), signals: [], lastRunReason: null })
  assert.equal(s.planBase, null)
  assert.match(s.planBlocked ?? '', /설정/, '왜 없는지를 안 말한다')
})

test('★ 관망에는 계획이 없다 — 주문할 것이 없는데 가격을 그리면 거짓말이다', () => {
  const s = buildSeries({ bars: manyBars(30), signals: [], lastRunReason: null, plan: PLAN })
  const call = { from: 'judgment' as const, at: '2026-09-28T00:30:00.000Z', direction: 'hold' as const, prob: 0.4, judge: 'rule', referencePrice: null, stopPrice: null, targetPrice: null, evR: null }
  assert.equal(planForCall(call, s), null)
})

test('★ 신호가 있으면 기록이 이긴다 — 지금 다시 셈하면 신호와 다른 값을 말한다', () => {
  const s = buildSeries({ bars: manyBars(30), signals: [], lastRunReason: null, plan: PLAN })
  const call = {
    from: 'signal' as const, at: '2026-09-28T00:20:00.000Z', direction: 'long' as const,
    prob: 0.61, judge: null, referencePrice: 404, stopPrice: 396, targetPrice: 412, evR: 0.32,
  }
  const plan = planForCall(call, s)
  assert.ok(plan)
  assert.equal(plan.from, 'signal')
  assert.equal(plan.referencePrice, 404, '기록된 기준가를 안 쓴다')
  assert.equal(plan.stopPrice, 396)
  assert.equal(plan.targetPrice, 412)
  // 신호 행에 안 남는 값이다. 지어내면 「이 값에 걸었는데 시스템은 다른 값을 봤다」가 된다
  assert.equal(plan.chaseLimitPrice, null, '기록에 없는 진입 한계가를 지어낸다')
})

test('★ 화면이 계획을 신호일 때만 그리지 않는다', () => {
  const panel = readFileSync(PANEL, 'utf8')
  assert.match(panel, /planForCall\(/, '계획을 안 셈한다')
  /*
    **계획 블록이 `call.from === 'signal'` 안에 있으면 안 된다.** 전에는 기준가·손절·
    목표가 그 안에 있었고, 신호가 0건인 판에서는 화면에 숫자가 하나도 없었다.
  */
  const guardAt = panel.indexOf("call.from === 'signal' &&")
  const blockAt = panel.indexOf('<PlanBlock plan={plan} />')
  assert.ok(blockAt > 0, '계획 블록을 안 그린다')
  assert.ok(guardAt < 0 || blockAt > panel.indexOf('</dl>', guardAt),
    '계획이 아직도 신호일 때만 그려진다')
  // 예고를 지시로 읽지 않게 어디서 온 값인지 같은 자리에서 말한다
  assert.match(panel, /PLAN_SOURCE_LABEL/, '기록인지 예고인지를 안 말한다')
  /*
    **들어갈 때와 나올 때가 시각이어야 한다** (사용자 지적 2026-09-29 「분 이렇게 표시 하지 말고」).
    「10분」은 언제부터 10분인지 읽는 사람이 판단 시각에 더해야 알 수 있었다.
  */
  assert.match(panel, /PLAN_LABEL\.entryBy/, '진입 마감 시각을 안 말한다')
  assert.match(panel, /PLAN_LABEL\.exitAt/, '나올 시각을 안 말한다')
  assert.match(panel, /PLAN_LABEL\.sessionExit/, '당일 청산 시각을 안 말한다')
  // 분만 남은 자리가 없어야 한다 — 시각 옆 보조로만 쓴다
  assert.match(panel, /seoulTimeText\(plan\.entryDeadlineAt\)/, '마감을 시각으로 안 그린다')
})


/* ── 오늘 장 (사용자 지적 2026-09-29 「실시간 시스템처럼 차트가 움직여야」) ── */

/** 어제 오후 세 개 + 오늘 아침 네 개. 사용자 화면이 바로 이 꼴이었다 */
const TWO_DAYS = [
  { startAt: '2026-09-28T06:32:00.000Z', open: 1085, high: 1086, low: 1084, close: 1085, volume: 1 },
  { startAt: '2026-09-28T06:33:00.000Z', open: 1085, high: 1086, low: 1084, close: 1085, volume: 1 },
  { startAt: '2026-09-28T06:34:00.000Z', open: 1085, high: 1086, low: 1084, close: 1085, volume: 1 },
  { startAt: '2026-09-28T23:45:00.000Z', open: 1083, high: 1086, low: 1082, close: 1082, volume: 1 },
  { startAt: '2026-09-28T23:46:00.000Z', open: 1082, high: 1084, low: 1082, close: 1084, volume: 1 },
  { startAt: '2026-09-29T00:00:00.000Z', open: 1082, high: 1084, low: 1080, close: 1082, volume: 1 },
  { startAt: '2026-09-29T00:01:00.000Z', open: 1082, high: 1085, low: 1082, close: 1085, volume: 1 },
]

test('★ 처음 그리는 구간이 마지막 날이다 — 어제가 화면을 채우면 오늘이 안 움직여 보인다', () => {
  const s = buildSeries({ bars: TWO_DAYS, signals: [], lastRunReason: null })
  assert.ok(s.window, '구간을 안 정한다')
  // 어제(KST 9/28 15:32~15:34) 셋은 창 밖, 오늘(9/29 08:45~09:01) 넷이 창 안이다
  assert.equal(s.window.startIndex, 3, '어제까지 창에 넣는다 — 오늘 봉이 묻힌다')
  assert.equal(s.window.endIndex, TWO_DAYS.length - 1, '마지막 봉이 창 밖이다')
  // 어제를 **버리지는 않는다** — 띠로 넓히면 그대로 나와야 한다
  assert.equal(s.bars.length, TWO_DAYS.length, '창 밖 봉을 아예 버린다 — 넓힐 길이 사라진다')
})

test('★ 그 날 봉이 모자라면 앞날까지 거슬러 채운다', () => {
  // 지표에 15개가 필요한데 마지막 날은 넷뿐이다
  const w = defaultWindow(buildSeries({ bars: TWO_DAYS, signals: [], lastRunReason: null }).bars, 6)
  assert.ok(w)
  assert.equal(w.startIndex, 1, '모자란 만큼 안 채운다 — 넷만 그리면 「거의 안 움직였다」로 읽힌다')
  // 있는 것보다 많이 달라고 해도 0 아래로는 안 간다
  const w2 = defaultWindow(buildSeries({ bars: TWO_DAYS, signals: [], lastRunReason: null }).bars, 999)
  assert.equal(w2?.startIndex, 0)
})

test('★ 날이 바뀌는 자리에 경계가 선다 — 열일곱 시간이 한 칸으로 붙지 않게', () => {
  const s = buildSeries({ bars: TWO_DAYS, signals: [], lastRunReason: null })
  assert.equal(s.dayBreaks.length, 1, '경계를 안 센다')
  assert.equal(s.dayBreaks[0].index, 3, '경계 자리가 틀렸다')
  assert.match(s.dayBreaks[0].dateLabel, /^\d{2}\/\d{2}$/, '날짜를 사람이 읽을 꼴로 안 적는다')
  // 첫 봉은 경계가 아니다 — 그 앞이 없으므로 「바뀌었다」고 말할 수 없다
  assert.equal(dayBreaksOf(s.bars).some((d) => d.index === 0), false)
  // 하루짜리면 경계가 없다
  assert.equal(buildSeries({ bars: BARS, signals: [], lastRunReason: null }).dayBreaks.length, 0)
})

test('★ 봉이 0건이면 구간도 경계도 없다 — 빈 차트에 띠를 그리지 않는다', () => {
  const s = buildSeries({ bars: [], signals: [], lastRunReason: null })
  assert.equal(s.window, null)
  assert.deepEqual(s.dayBreaks, [])
})

test('★ 화면이 구간 띠와 날 경계를 실제로 그린다', () => {
  const panel = readFileSync(PANEL, 'utf8')
  assert.match(panel, /<R\.Brush/, '구간 띠를 안 그린다 — 어제를 볼 길이 없다')
  /*
    서버가 정한 창을 실제로 넘겨야 한다. 안 넘기면 recharts 가 전체를 그린다.

    **변수 이름을 외우지 않는다** — 창을 사용자가 밀 수 있게 되면서 `chart.window` 를
    그대로 넘기던 자리가 화면 상태(`view`)로 바뀌었고, 규칙은 그대로인데 가드가 빨개졌다.
  */
  const brushStart = panel.indexOf('<R.Brush')
  const brushProps = panel.slice(brushStart, panel.indexOf('/>', brushStart))
  assert.match(brushProps, /startIndex=\{[^}]*startIndex\}/, '정한 창을 띠에 안 넘긴다')
  assert.match(brushProps, /endIndex=\{[^}]*endIndex\}/, '끝 자리를 안 넘긴다')
  // 봉이 0건이면 안 그린다
  assert.match(panel, /\{view && \(/, '봉 0건에도 띠를 그린다')
  /*
    **첫 렌더부터 창을 들고 시작해야 한다.** 효과로 나중에 넣으면 그 사이 한 번은
    전체가 그려지고 recharts 가 그때 잡은 범위를 그대로 쓴다 (실측 2026-09-29: 180→180).
  */
  assert.match(panel, /useState<[^>]*>\(\(\) => serverWindow\)/,
    '창을 첫 렌더 뒤에 넣는다 — recharts 가 그때 잡은 전체 범위를 그대로 쓴다')
  assert.match(panel, /chart\.dayBreaks\.map/, '날 경계를 안 그린다')
  /*
    **띠와 경계에 롱·숏 색을 쓰지 않는다.** 이 그림에서 빨강·파랑은 방향이라
    같은 색을 쓰면 경계선이 판단으로 읽힌다.
  */
  assert.equal(/--danger|--accent/.test(brushProps), false, '띠에 방향 색을 쓴다')
})


/* ── 들어갈 때와 나올 때가 시각이다 (사용자 지적 2026-09-29) ── */

test('★ 진입 마감이 시각으로 나온다 — 「10분」은 언제부터인지 사람이 세야 한다', () => {
  const bars = manyBars(30)
  const s = buildSeries({ bars, signals: [], lastRunReason: null, plan: PLAN })
  const at = '2026-09-29T00:58:00.000Z'
  const call = { from: 'judgment' as const, at, direction: 'long' as const, prob: 0.85, judge: 'jev', referencePrice: null, stopPrice: null, targetPrice: null, evR: null }
  const plan = planForCall(call, s)
  assert.ok(plan)
  // 판단 시각 + 진입 유효 10분
  assert.equal(plan.entryDeadlineAt, '2026-09-29T01:08:00.000Z')
  /*
    **기준 봉이 아니라 판단이 난 때부터 센다.** 판단이 09:58 것인데 봉이 10:03 이면
    기준 봉으로 세는 순간 마감을 5분 늦게 잡는다 — 이미 지난 신호를 살아 있다고 그리게 된다.
  */
  assert.notEqual(plan.entryDeadlineAt, s.planBase?.barAt)
})

test('★ 마감을 못 세면 지어내지 않는다', () => {
  const s = buildSeries({ bars: manyBars(30), signals: [], lastRunReason: null, plan: { ...PLAN, validMinutes: 0 } })
  const call = { from: 'judgment' as const, at: '2026-09-29T00:58:00.000Z', direction: 'long' as const, prob: 0.85, judge: 'jev', referencePrice: null, stopPrice: null, targetPrice: null, evR: null }
  assert.equal(planForCall(call, s)?.entryDeadlineAt, null)
  const bad = { ...call, at: '언제인지 모름' }
  assert.equal(planForCall(bad, buildSeries({ bars: manyBars(30), signals: [], lastRunReason: null, plan: PLAN }))?.entryDeadlineAt, null)
})

test('★ 마감이 지났으면 지났다고 말한다 — 지난 시각은 아직 된다고 읽힌다', () => {
  const now = new Date('2026-09-29T01:10:00.000Z')
  assert.equal(deadlineLeftText('2026-09-29T01:08:00.000Z', now), '지났습니다')
  assert.equal(deadlineLeftText('2026-09-29T01:13:00.000Z', now), '3분 남음')
  // 1분이 안 남으면 「0분 남음」이 된다. 그것은 지금이 마지막이라는 뜻이라 따로 쓴다
  assert.equal(deadlineLeftText('2026-09-29T01:10:30.000Z', now), '1분 안')
  assert.equal(deadlineLeftText(null, now), '')
})

test('★ 제목이 무슨 봉인지 말한다 — 1분인지 5분인지 모르면 같은 그림이 다른 뜻이다', () => {
  for (const t of [
    chartTitle({ signalCount: 0, callCount: 0 }),
    chartTitle({ signalCount: 0, callCount: 44 }),
    chartTitle({ signalCount: 3, callCount: 44 }),
  ]) {
    assert.match(t, /1분봉/, `봉 주기를 안 말한다: ${t}`)
  }
  // 새로고침 줄도 같은 말을 한다 — 「계속 바뀌나」는 그 줄을 보고 묻는 질문이다
  const live = readFileSync(join(WEB, TRADING_APP_DIR, 'LiveRefresh.tsx'), 'utf8')
  assert.match(live, /마지막 1분봉/, '새로고침 줄이 봉 주기를 안 말한다')
})


/* ── 계획이 판단이 난 봉에 붙는다 (repainting, 실측 2026-09-29) ── */

/**
 * **같은 판단은 볼 때마다 같은 값이어야 한다.**
 *
 * 실측: 09:58 판단의 그 봉 종가는 1083.58 인데 화면은 10:03 봉의 1087.84 를 그렸고,
 * 분이 갈 때마다 1086.64 · 1088.66 으로 움직였다. 목표 폭 2.44점짜리에 기준가가
 * 4점 넘게 흔들렸다 — 화면을 보고 건 주문과 시스템이 본 값이 달라진다.
 */
test('★ 봉이 더 들어와도 같은 판단의 계획이 안 바뀐다', () => {
  const bars = manyBars(40)
  const callAt = bars[25].startAt
  const call = { from: 'judgment' as const, at: callAt, direction: 'long' as const, prob: 0.85, judge: 'jev', referencePrice: null, stopPrice: null, targetPrice: null, evR: null }

  // 그 판단 직후에 본 판
  const early = buildSeries({ bars: bars.slice(0, 26), signals: [], lastRunReason: null, plan: PLAN })
  // 열네 봉이 더 들어온 뒤에 본 판
  const late = buildSeries({ bars, signals: [], lastRunReason: null, plan: PLAN })

  const a = planForCall(call, early)
  const b = planForCall(call, late)
  assert.ok(a && b, '계획을 못 세운다')
  assert.equal(b.referencePrice, a.referencePrice, '봉이 들어오자 기준가가 바뀐다 (repainting)')
  assert.equal(b.stopPrice, a.stopPrice, '손절가가 바뀐다')
  assert.equal(b.targetPrice, a.targetPrice, '목표가가 바뀐다')
  assert.equal(b.barAt, a.barAt, '계획이 다른 봉에 붙는다')
  // 마지막 봉이 아니라 **판단의 봉**이어야 한다
  assert.equal(b.barAt, callAt, '계획이 마지막 봉에 붙었다')
  assert.notEqual(b.barAt, bars[bars.length - 1].startAt)
})

test('★ 지표도 그 봉까지만 본다 — 뒤 봉을 섞으면 그때 세울 수 없던 계획이다', () => {
  const bars = manyBars(40)
  const all = buildSeries({ bars, signals: [], lastRunReason: null, plan: PLAN })
  const upTo = buildSeries({ bars: bars.slice(0, 26), signals: [], lastRunReason: null, plan: PLAN })
  // 40봉을 가진 판에서 25번 봉 기준으로 잰 재료가, 26봉만 가진 판의 마지막 봉 재료와 같아야 한다
  const anchored = planBaseAt(all.bars, bars[25].startAt, PLAN)
  assert.ok(anchored.base && upTo.planBase)
  assert.equal(anchored.base.atr, upTo.planBase.atr, '뒤 봉이 지표에 섞였다')
  assert.equal(anchored.base.referencePrice, upTo.planBase.referencePrice)
})

test('★ 그 봉까지 봉이 모자라면 계획을 안 세운다', () => {
  const bars = manyBars(40)
  const all = buildSeries({ bars, signals: [], lastRunReason: null, plan: PLAN })
  // 세 번째 봉 기준이면 ATR 14 를 못 구한다
  const early = planBaseAt(all.bars, bars[2].startAt, PLAN)
  assert.equal(early.base, null, '봉 3개로 ATR 14 를 구했다고 한다')
  assert.match(early.blocked ?? '', /봉이 \d+개 필요/, '몇 개가 모자란지를 안 말한다')
  // 차트에 없는 봉이면 지어내지 않는다
  assert.equal(planBaseAt(all.bars, '2020-01-01T00:00:00.000Z', PLAN).base, null)
})
