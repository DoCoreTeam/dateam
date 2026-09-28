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
import { buildSeries, axisDomain, pickNowCall, callAgeLabel, isOtherDay, chartTitle } from './series.ts'
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
  assert.match(src, /loadChart\(contractCode, now, signals, judgments, recentRuns\[0\]\?\.reason \?\? null\)/,
    '봉·신호·판단·사유를 함께 안 넘긴다')
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
  assert.match(overview, /loadChart\(contractCode, now, signals, judgments,/, '판단을 안 넘긴다')
  assert.match(overview, /buildSeries\(\{ bars, signals, judgments, lastRunReason \}\)/, '판단을 안 쓴다')
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
  assert.equal(chartTitle({ signalCount: 0, callCount: 44 }), '가격과 판단')
  assert.equal(chartTitle({ signalCount: 0, callCount: 0 }), '가격')
  for (const t of [chartTitle({ signalCount: 0, callCount: 44 }), chartTitle({ signalCount: 0, callCount: 0 })]) {
    assert.doesNotMatch(t, /신호/, `안 그린 것을 제목에 적는다: ${t}`)
  }
})

test('신호가 있으면 신호라고 한다 — 관문을 다 지난 것이라 무게가 다르다', () => {
  assert.equal(chartTitle({ signalCount: 1, callCount: 0 }), '가격과 신호')
  assert.equal(chartTitle({ signalCount: 3, callCount: 44 }), '가격과 신호')
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
