/**
 * 쌓인 판단으로 청산 규칙과 시간대를 바꿔 본다 — **앞 구간에서 고르고 뒤 구간에서 다시 잰다**
 *
 * 화면과 백테스트가 쓰는 채점(`judge/score.ts` → `replay/execution.ts`)을 그대로 돌린다.
 * 여기서 셈을 새로 적으면 이 탐색의 답과 화면의 성적이 갈린다.
 *
 * 읽기 전용이다. DB 에 접속하지 않고 psql 로 뽑은 JSON 세 개를 읽는다 (만드는 명령은
 * docs/trading/2026-11-판단성적-탐색.md 「다시 돌리는 법」).
 *
 *   node --experimental-strip-types scripts/trading-sweep.ts <judgments.json> <bars.json> <settings.json>
 *
 * 규칙 판단만 센다. AI 판단은 같은 봉에서 규칙과 방향이 99.6% 같아(2026-11-05 실측) 둘을 다 세면
 * 같은 거래를 두 번 센다.
 */

import { readFileSync } from 'node:fs'
import { scoreJudgment, isSettled, type JudgmentScore, type ScoreParams } from '../lib/trading/judge/score.ts'
import { leaningOf } from '../lib/trading/judgment-labels.ts'
import { profitFactor } from '../lib/trading/stats/metrics.ts'
import type { MinuteBarInput } from '../lib/trading/bars/confirm.ts'

interface JudgmentRow { id: string; contract_code: string; bar_close_at: string; judge: string; raw_score: Record<string, number> }
interface BarRow { contract_code: string; bar_start_at: string; open: string; high: string; low: string; close: string; volume: number }

/** 미니 코스피200 (trading_instruments). 승수·호가 간격 */
const INSTRUMENT = { multiplier: 50_000, tickSize: 0.02, tickValue: 1_000 }
/** 탐색 구간 비율. 나머지가 확인 구간이다 */
const SEARCH_SHARE = 0.6
/** 이보다 적게 결판 난 조합은 고르지 않는다 — 몇 건으로 고르면 우연을 고른다 */
const MIN_SETTLED = 100
const SESSION_EXIT_BEFORE_MINUTES = 15

const STOPS = [0.8, 1.2, 1.6, 2.0]
const TARGETS = [1.0, 1.5, 2.0, 3.0]
const HOLDS = [5, 15, 30, 60]

const [judgmentsPath, barsPath, settingsPath] = process.argv.slice(2)
if (!judgmentsPath || !barsPath || !settingsPath) {
  process.stderr.write('사용법: trading-sweep.ts <judgments.json> <bars.json> <settings.json>\n')
  process.exit(1)
}

const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
const judgments = (JSON.parse(readFileSync(judgmentsPath, 'utf8')) as JudgmentRow[]).filter((j) => j.judge === 'rule')
const barsByContract = new Map<string, MinuteBarInput[]>()
for (const b of JSON.parse(readFileSync(barsPath, 'utf8')) as BarRow[]) {
  const list = barsByContract.get(b.contract_code) ?? []
  list.push({ startAt: new Date(b.bar_start_at), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: b.volume } as MinuteBarInput)
  barsByContract.set(b.contract_code, list)
}

const kstDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
const kstHour = (iso: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)))

function paramsOf(stop: number, target: number, hold: number): ScoreParams {
  const slippage = INSTRUMENT.tickSize * 2
  return {
    indicators: {
      atrPeriod: Number(settings.atr_period) || 14,
      smaFastPeriod: Number(settings.sma_fast_period) || 5,
      smaSlowPeriod: Number(settings.sma_slow_period) || 20,
      breakoutPeriod: Number(settings.breakout_period) || 20,
    },
    exit: {
      stopAtrMultiple: stop,
      targetAtrMultiple: target,
      chaseAtrMultiple: Number(settings.exit_chase_atr_multiple) || 0.3,
      timeExitMinutes: hold,
    },
    instrument: INSTRUMENT as ScoreParams['instrument'],
    quantity: 1,
    delayMinutes: Number(settings.replay_delay_minutes) || 2,
    orderKind: settings.replay_order_type === 'limit' ? 'limit' : 'market',
    slippagePoints: slippage,
    stopSlippagePoints: slippage,
    feePercentPerSide: Number(settings.fee_percent_per_side) || 0,
    feeFlatKrw: Number(settings.fee_rate) || 0,
    sessionCloseAt: (d) => new Date(new Date(`${kstDay(d)}T15:45:00+09:00`).getTime() - SESSION_EXIT_BEFORE_MINUTES * 60_000),
  }
}

interface Scored extends JudgmentScore { day: string; hour: number }

function scoreAll(stop: number, target: number, hold: number, invert = false): Scored[] {
  const params = paramsOf(stop, target, hold)
  const out: Scored[] = []
  for (const j of judgments) {
    const lean = leaningOf(j.raw_score)
    if (!lean || lean.direction === 'hold') continue
    const direction = invert ? (lean.direction === 'long' ? 'short' : 'long') : lean.direction
    const s = scoreJudgment({ id: j.id, barCloseAt: j.bar_close_at, judge: j.judge, direction }, barsByContract.get(j.contract_code) ?? [], params)
    out.push({ ...s, day: j.bar_close_at.slice(0, 10), hour: kstHour(j.bar_close_at) })
  }
  return out
}

interface Stat { settled: number; avgR: number | null; pf: number | null; netKrw: number; plusDays: number; days: number }

function statOf(list: readonly Scored[]): Stat {
  const settled = list.filter((s) => isSettled(s) && s.netPnlR !== null)
  const byDay = new Map<string, number>()
  for (const s of settled) byDay.set(s.day, (byDay.get(s.day) ?? 0) + (s.netPnlKrw ?? 0))
  const totalR = settled.reduce((a, s) => a + (s.netPnlR ?? 0), 0)
  return {
    settled: settled.length,
    avgR: settled.length > 0 ? totalR / settled.length : null,
    pf: profitFactor(settled.map((s) => ({ tradeDate: s.day, netPnlR: s.netPnlR ?? 0 }))),
    netKrw: settled.reduce((a, s) => a + (s.netPnlKrw ?? 0), 0),
    plusDays: [...byDay.values()].filter((v) => v > 0).length,
    days: byDay.size,
  }
}

const fmt = (v: number | null, d = 3) => (v === null ? '없음' : v.toFixed(d))
const won = (v: number) => `${v < 0 ? '-' : ''}${Math.abs(Math.round(v)).toLocaleString('ko-KR')}`
const line = (label: string, s: Stat) =>
  `| ${label} | ${s.settled} | ${fmt(s.avgR)} | ${fmt(s.pf, 2)} | ${won(s.netKrw)} | ${s.plusDays}/${s.days} |`
const HEAD = '| 조합 | 결판 | 건당 R | Profit Factor | 합계(원, 1계약) | 플러스 날 |\n|---|---|---|---|---|---|'

const allDays = [...new Set(judgments.map((j) => j.bar_close_at.slice(0, 10)))].sort()
const cut = allDays[Math.floor(allDays.length * SEARCH_SHARE)]
const inSearch = (s: Scored) => s.day < cut
const inCheck = (s: Scored) => s.day >= cut

const out: string[] = []
out.push(`규칙 판단 ${judgments.length}건, ${allDays[0]} ~ ${allDays[allDays.length - 1]} (${allDays.length}일)`)
out.push(`탐색 구간 ${allDays[0]} ~ ${cut} 전날, 확인 구간 ${cut} ~ ${allDays[allDays.length - 1]}`)

// 1 지금 설정
const current = scoreAll(Number(settings.exit_stop_atr_multiple) || 1.2, Number(settings.exit_target_atr_multiple) || 1.5, Number(settings.min_hold_minutes) || 15)
out.push('\n### 지금 설정 그대로\n', HEAD,
  line('전체', statOf(current)), line('탐색 구간', statOf(current.filter(inSearch))), line('확인 구간', statOf(current.filter(inCheck))),
  line('롱만', statOf(current.filter((s) => s.direction === 'long'))), line('숏만', statOf(current.filter((s) => s.direction === 'short'))))

// 2 시간대
const BUCKETS: [string, (h: number) => boolean][] = [
  ['09시', (h) => h === 9], ['10~11시', (h) => h >= 10 && h < 12], ['12~13시', (h) => h >= 12 && h < 14], ['14~15시', (h) => h >= 14 && h < 16], ['야간', (h) => h >= 18 || h < 6],
]
out.push('\n### 시간대별 (지금 설정, 탐색 구간과 확인 구간을 나눠서)\n', HEAD, ...BUCKETS.flatMap(([l, f]) => [
  line(`${l} 탐색`, statOf(current.filter((s) => f(s.hour) && inSearch(s)))),
  line(`${l} 확인`, statOf(current.filter((s) => f(s.hour) && inCheck(s)))),
]))

// 3 반대 방향 — 방향 예측에 정보가 있으면 반대는 더 나빠야 한다
const inverted = scoreAll(Number(settings.exit_stop_atr_multiple) || 1.2, Number(settings.exit_target_atr_multiple) || 1.5, Number(settings.min_hold_minutes) || 15, true)
out.push('\n### 판단과 반대로 들어갔다면 (지금 설정)\n', HEAD, line('전체', statOf(inverted)))

// 4 격자 — 탐색 구간에서 고르고 확인 구간에서 다시 잰다
const grid: { label: string; search: Stat; check: Stat; all: Stat }[] = []
for (const stop of STOPS) for (const target of TARGETS) for (const hold of HOLDS) {
  const scored = scoreAll(stop, target, hold)
  grid.push({ label: `손절 ${stop} 목표 ${target} 보유 ${hold}분`, search: statOf(scored.filter(inSearch)), check: statOf(scored.filter(inCheck)), all: statOf(scored) })
}
const ranked = grid.filter((g) => g.search.settled >= MIN_SETTLED && g.search.avgR !== null).sort((a, b) => (b.search.avgR ?? 0) - (a.search.avgR ?? 0))
out.push(`\n### 격자 ${grid.length}개 중 탐색 구간 건당 R 상위 5개와 그 확인 구간\n`,
  '| 조합 | 탐색 결판 | 탐색 건당 R | 탐색 PF | 확인 결판 | 확인 건당 R | 확인 PF | 확인 합계(원) |\n|---|---|---|---|---|---|---|---|',
  ...ranked.slice(0, 5).map((g) => `| ${g.label} | ${g.search.settled} | ${fmt(g.search.avgR)} | ${fmt(g.search.pf, 2)} | ${g.check.settled} | ${fmt(g.check.avgR)} | ${fmt(g.check.pf, 2)} | ${won(g.check.netKrw)} |`))
const positiveAll = grid.filter((g) => (g.all.avgR ?? -1) > 0).length
const positiveBoth = grid.filter((g) => (g.search.avgR ?? -1) > 0 && (g.check.avgR ?? -1) > 0).length
out.push(`\n격자 ${grid.length}개 중 전체 구간 건당 R 이 플러스인 조합 ${positiveAll}개, 탐색과 확인 둘 다 플러스인 조합 ${positiveBoth}개`)

process.stdout.write(`${out.join('\n')}\n`)
