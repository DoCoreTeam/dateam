/**
 * 「진 실행은 밖으로 안 나간다」를 실제로 센다
 *
 * 유일 키는 **저장**을 막지 호출을 막지 않는다. 두 크론이 같은 봉에 들어오면
 * 둘 다 Jev 를 부르고 나서 둘째가 저장에 실패한다 — 돈은 두 번 나갔고,
 * 1-C 에서는 알림도 두 번 간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runJudges, scheduledMinuteOf, marketPhaseOf, shouldAskForBars, closedRunReason,
  RUN_BUDGET_MS, type TickPorts, type MarketPhase,
} from './tick-core.ts'
import {
  hasNightQuotation, NO_NIGHT_QUOTE_REASON, NO_NIGHT_QUOTE_MESSAGE,
} from '../bars/night-quote.ts'
import { stripComments } from '../../ui/component-scan.ts'

const HERE_TICK = dirname(fileURLToPath(import.meta.url))
import type { Judge, JudgeName, JudgeInput, JudgeResult } from '../judge/types.ts'

const INPUT = {} as JudgeInput

function countingJudge(name: JudgeName, counter: { n: number }, external = name === 'jev'): Judge {
  return {
    name,
    external,
    async judge(): Promise<JudgeResult> {
      counter.n += 1
      return { status: 'completed', rawScore: { p_long: 0.5, p_short: 0.2, p_hold: 0.3, enter_now: 0.6 } }
    },
  }
}

interface Harness {
  ports: TickPorts
  calls: { rule: { n: number }; jev: { n: number } }
  finished: string[]
  timings: Record<string, { req: string | null; res: string | null }>
  clock: { at: number }
}

function harness(over: Partial<{
  claim(judge: JudgeName): Promise<string | null>
  takeOver(judge: JudgeName): Promise<string | null>
}> = {}): Harness {
  const calls = { rule: { n: 0 }, jev: { n: 0 } }
  const finished: string[] = []
  const timings: Record<string, { req: string | null; res: string | null }> = {}
  const clock = { at: Date.parse('2026-09-25T01:15:05.000Z') }
  const judges = new Map<JudgeName, Judge>([
    ['rule', countingJudge('rule', calls.rule)],
    ['jev', countingJudge('jev', calls.jev)],
  ])
  const ports: TickPorts = {
    claim: over.claim ?? (async (j) => `id-${j}`),
    takeOver: over.takeOver ?? (async () => null),
    judges,
    async finish(id, judge, _result, _at, timing) {
      finished.push(`${judge}:${id}`)
      timings[judge] = {
        req: timing.aiRequestAt?.toISOString() ?? null,
        res: timing.aiResponseAt?.toISOString() ?? null,
      }
    },
    now: () => new Date(clock.at),
  }
  return { ports, calls, finished, timings, clock }
}

test('선점에 성공하면 판단기를 부르고 결과를 저장한다', async () => {
  const h = harness()
  const outcome = await runJudges(['rule', 'jev'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule', 'jev'])
  assert.deepEqual(h.finished, ['rule:id-rule', 'jev:id-jev'])
  assert.equal(h.calls.jev.n, 1)
})

test('★ 남이 먼저 잡았으면 판단기를 0회 부른다 — 이 한 줄이 이중 호출을 막는 전부다', async () => {
  const h = harness({ claim: async () => null, takeOver: async () => null })
  const outcome = await runJudges(['rule', 'jev'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, [])
  assert.deepEqual(outcome.skipped, ['rule', 'jev'])
  assert.equal(h.calls.jev.n, 0, '진 실행이 Jev 를 불렀다 — 돈이 두 번 나간다')
  assert.equal(h.calls.rule.n, 0)
  assert.deepEqual(h.finished, [])
})

test('★ 두 실행이 동시에 들어와도 하나만 나간다', async () => {
  // 실제 DB 의 유일 키를 흉내낸다: 먼저 부른 쪽만 id 를 받는다
  const taken = new Set<string>()
  const claim = async (judge: JudgeName) => {
    if (taken.has(judge)) return null
    taken.add(judge)
    return `id-${judge}`
  }
  const a = harness({ claim })
  const b = harness({ claim })
  const started = new Date(a.clock.at)

  const [first, second] = await Promise.all([
    runJudges(['rule', 'jev'], INPUT, a.ports, started),
    runJudges(['rule', 'jev'], INPUT, b.ports, started),
  ])

  const totalJev = a.calls.jev.n + b.calls.jev.n
  assert.equal(totalJev, 1, `Jev 가 ${totalJev}번 나갔다`)
  assert.equal(first.ran.length + second.ran.length, 2, '둘을 합쳐 판단기 둘이 한 번씩 돌아야 한다')
})

test('★ 60초 넘게 멈춘 선점은 이어받는다 — 사고 하나가 하루를 망치지 않게', async () => {
  const h = harness({ claim: async () => null, takeOver: async (j) => `taken-${j}` })
  const outcome = await runJudges(['rule'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule'])
  assert.deepEqual(h.finished, ['rule:taken-rule'])
})

test('★ 50초가 넘으면 남은 판단기를 다음 실행으로 넘긴다', async () => {
  const h = harness()
  const started = new Date(h.clock.at)
  // 첫 판단기가 도는 동안 시계가 51초 지난다
  const slow = new Map(h.ports.judges)
  slow.set('rule', {
    name: 'rule',
    external: false,
    async judge(): Promise<JudgeResult> {
      h.clock.at += RUN_BUDGET_MS + 1_000
      return { status: 'completed', rawScore: { p_long: 0.5, p_short: 0.2, p_hold: 0.3, enter_now: 0.6 } }
    },
  })
  const outcome = await runJudges(['rule', 'jev'], INPUT, { ...h.ports, judges: slow }, started)

  assert.deepEqual(outcome.ran, ['rule'])
  assert.deepEqual(outcome.deferred, ['jev'], '시간이 넘었는데 계속 불렀다 — 함수가 죽으면 그 분 기록이 통째로 없다')
  assert.equal(h.calls.jev.n, 0)
})

test('등록 안 된 판단기는 건너뛴다 — 없는 것을 부르지 않는다', async () => {
  const h = harness()
  const outcome = await runJudges(['rule', 'ml'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule'])
  assert.deepEqual(outcome.skipped, ['ml'])
})

test('판단기마다 선점이 따로다 — 느린 쪽이 빠른 쪽을 끌고 내려가지 않는다', async () => {
  const h = harness({ claim: async (j) => (j === 'jev' ? null : `id-${j}`) })
  const outcome = await runJudges(['rule', 'jev'], INPUT, h.ports, new Date(h.clock.at))
  assert.deepEqual(outcome.ran, ['rule'], 'Jev 를 남이 잡았다고 rule 기록까지 빠졌다')
  assert.deepEqual(outcome.skipped, ['jev'])
})

test('예정 분은 초와 밀리초를 떨어뜨린다 — 같은 분이 한 값이어야 유일 키가 선다', () => {
  assert.equal(scheduledMinuteOf(new Date('2026-09-25T01:15:05.123Z')).toISOString(),
    '2026-09-25T01:15:00.000Z')
  assert.equal(scheduledMinuteOf(new Date('2026-09-25T01:15:59.999Z')).toISOString(),
    '2026-09-25T01:15:00.000Z')
})

// ── 판단 시각 (§14.2) ────────────────────────────────────

test('★ 밖으로 나간 판단기만 요청·응답 시각을 남긴다', async () => {
  const h = harness()
  await runJudges(['rule', 'jev'], INPUT, h.ports, new Date(h.clock.at))

  // rule 은 지표만 보고 답한다. 안 나갔는데 나간 시각을 적으면 지연 중앙값이 0 으로 끌려간다
  assert.deepEqual(h.timings.rule, { req: null, res: null }, 'rule 에 나간 시각이 적혔다')

  // jev 는 관문을 지나 벤더까지 간다. 이 둘이 비면 Jev 지연을 못 잰다
  assert.ok(h.timings.jev.req, 'jev 요청 시각이 비어 있다 — 실측 2026-09-26 의 그 상태다')
  assert.ok(h.timings.jev.res, 'jev 응답 시각이 비어 있다')
})

test('★ 응답 시각이 요청 시각보다 앞서지 않는다', async () => {
  const h = harness()
  const slow = new Map(h.ports.judges)
  slow.set('jev', {
    name: 'jev',
    external: true,
    async judge(): Promise<JudgeResult> {
      h.clock.at += 3_000
      return { status: 'completed', rawScore: { p_long: 0.5, p_short: 0.2, p_hold: 0.3, enter_now: 0.6 } }
    },
  })
  await runJudges(['jev'], INPUT, { ...h.ports, judges: slow }, new Date(h.clock.at))
  const { req, res } = h.timings.jev
  assert.ok(req && res)
  assert.ok(Date.parse(res) - Date.parse(req) >= 3_000, `걸린 시간이 ${Date.parse(res) - Date.parse(req)}ms 로 잡혔다`)
})

test('★ 기권한 판단기도 시각을 남긴다 — 기다린 시간은 기다린 시간이다', async () => {
  const h = harness()
  const abstaining = new Map(h.ports.judges)
  abstaining.set('jev', {
    name: 'jev',
    external: true,
    async judge(): Promise<JudgeResult> {
      h.clock.at += 10_000
      return { status: 'abstain', abstainReason: 'timeout:10000ms' }
    },
  })
  await runJudges(['jev'], INPUT, { ...h.ports, judges: abstaining }, new Date(h.clock.at))
  assert.ok(h.timings.jev.req && h.timings.jev.res, '기권이라고 시각을 안 남기면 기권률 분석에 시간 축이 없다')
})

test('★ 판단기가 밖으로 나가는지를 이름이 아니라 값으로 말한다', () => {
  const src = readFileSync(join(HERE_TICK, 'tick-core.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.doesNotMatch(body, /name\s*===\s*'jev'/, '이름으로 가르면 그것이 곧 특권이 된다')
  assert.match(body, /judge\.external/, '밖으로 나가는지를 값으로 안 묻는다')
})

/* ── 장이 어느 국면인가 (실측 2026-09-28) ─────────────────── */

/** 평일 정규장 한 판 (선물 기준, KST). 단일가 08:30, 접속매매 08:45~15:45, 마감 단일가 15:50 */
const DAY = {
  openAuctionStart: new Date('2026-09-28T08:30:00+09:00'),
  continuousStart: new Date('2026-09-28T08:45:00+09:00'),
  continuousEnd: new Date('2026-09-28T15:45:00+09:00'),
  closeAuctionEnd: new Date('2026-09-28T15:50:00+09:00'),
}

const kst = (hhmm: string): Date => new Date(`2026-09-28T${hhmm}:00+09:00`)

/**
 * **사용자 지적 2026-09-28** 「장이 안 열렸다는 거 뻔히 아는데 봉을 못 불러왔다 무슨 뜻인지?」
 *
 * 실측 08:00~08:19 기록이 전부 `bar_not_ready|bar_retry=2/2,still_missing|…` 였다.
 */
test('★ 장 시작 전·단일가·접속매매·마감 뒤를 가른다', () => {
  assert.equal(marketPhaseOf(DAY, kst('08:00')), 'before_open', '실측이 걸렸던 그 시각이다')
  assert.equal(marketPhaseOf(DAY, kst('08:29')), 'before_open')
  assert.equal(marketPhaseOf(DAY, kst('08:30')), 'auction')
  assert.equal(marketPhaseOf(DAY, kst('08:44')), 'auction')
  assert.equal(marketPhaseOf(DAY, kst('08:45')), 'open')
  assert.equal(marketPhaseOf(DAY, kst('15:44')), 'open')
  assert.equal(marketPhaseOf(DAY, kst('15:45')), 'auction', '마감 단일가는 아직 장 안이다')
  assert.equal(marketPhaseOf(DAY, kst('15:50')), 'after_close')
  assert.equal(marketPhaseOf(DAY, kst('23:00')), 'after_close')
})

test('★ 단일가 시각이 없는 세션에도 빈 구간이 안 생긴다', () => {
  const night = { ...DAY, openAuctionStart: null, closeAuctionEnd: null }
  assert.equal(marketPhaseOf(night, kst('08:00')), 'before_open')
  assert.equal(marketPhaseOf(night, kst('08:45')), 'open')
  assert.equal(marketPhaseOf(night, kst('15:45')), 'after_close')
})

test('★ 장이 닫혔으면 봉을 묻지 않는다 — 거짓 고장도 연속 실패도 안 쌓인다', () => {
  const day = (phase: MarketPhase) => shouldAskForBars({ phase, isNight: false, hasNightQuote: false })
  assert.equal(day('before_open'), false)
  assert.equal(day('after_close'), false)
  // 단일가는 모은다 — 그 봉으로 판단만 안 한다 (§6.1 · D-40)
  assert.equal(day('auction'), true)
  assert.equal(day('open'), true)
  // 낮에는 야간 창구 유무가 아무것도 안 바꾼다
  assert.equal(shouldAskForBars({ phase: 'open', isNight: false, hasNightQuote: true }), true)
})

test('★ 야간 창구가 있으면 어느 국면이든 모은다', () => {
  for (const phase of ['before_open', 'auction', 'open', 'after_close'] as const) {
    assert.equal(shouldAskForBars({ phase, isNight: true, hasNightQuote: true }), true,
      `야간 창구가 있는데 ${phase} 에서 안 묻는다`)
  }
})

test('★ 야간 창구가 없으면 안 묻는다 — 476회의 헛일이 여기서 났다', () => {
  /*
    실측 2026-09-29: 크론 최근 1000회 중 476회가 `bar_not_ready` 였다.
    낮 창구로 밤에 물어보고, 못 받으면 3초 뒤 두 번 더 물어보고, 그래도 없으니
    「아직 안 들어왔다」를 남긴 것이다. 하룻밤이면 같은 빈 답을 받으러 2천 번 나간다.
  */
  for (const phase of ['before_open', 'auction', 'open', 'after_close'] as const) {
    assert.equal(shouldAskForBars({ phase, isNight: true, hasNightQuote: false }), false,
      `야간 창구가 없는데 ${phase} 에서 또 묻는다`)
  }
})

test('★ 야간 창구가 비어 있다는 것이 값으로 있다 — 주석으로만 적지 않는다', () => {
  // 주석은 늙는다. 「없다」와 「아직 안 적었다」를 구별하려면 값이어야 한다
  assert.equal(hasNightQuotation('minuteChart'), false, '야간 분봉 창구가 생겼다면 안내와 시험을 다시 보라')
  assert.match(NO_NIGHT_QUOTE_REASON, /night/, '실행 기록에 남을 말이 야간을 안 가리킨다')
  assert.match(NO_NIGHT_QUOTE_MESSAGE, /창구/, '사람이 읽을 말이 없다')
})

test('★ 크론이 이 판정을 실제로 부르고, 봉을 묻기 전에 부른다', () => {
  const tick = readFileSync(join(HERE_TICK, 'tick.ts'), 'utf8')
  const decide = tick.indexOf('shouldAskForBars({')
  const ask = tick.indexOf('kis.minuteBars({')
  assert.ok(decide > 0, '판정을 안 부른다')
  assert.ok(ask > 0, '봉을 묻는 자리를 못 찾겠다')
  assert.ok(decide < ask, '봉을 먼저 묻고 나서 장 시간을 본다 — 순서가 뒤집히면 고친 것이 없다')
  assert.match(tick, /market_closed=\$\{phase\}/, '어느 국면이라 안 물었는지를 안 남긴다')
  // 「장이 닫혔다」와 「야간 창구가 없다」는 사람이 할 일이 다르다 — 한 말로 적지 않는다
  assert.ok(tick.includes('NO_NIGHT_QUOTE_REASON'), '야간 창구가 없어 안 물은 것을 따로 안 적는다')
  assert.ok(tick.includes('hasNightQuotation('), '야간 창구 유무를 안 보고 판정에 넘긴다')
})

test('★ 주말·휴장일의 지금 동작은 안 바뀐다 — 창이 없으면 그 전에 돌아간다', () => {
  const tick = readFileSync(join(HERE_TICK, 'tick.ts'), 'utf8')
  const noWindow = tick.indexOf('if (!window) {')
  const decide = tick.indexOf('shouldAskForBars({')
  assert.ok(noWindow > 0 && noWindow < decide,
    '창이 없는 날 판정이 뒤로 밀렸다 — no_session 이 안 나온다')
})


// ── 안 물은 실행의 사유 ──────────────────────────────────

/**
 * 실측 2026-10-05 자정이 이 모양이었다. 남은 것은 `market_closed=before_open` 뿐이었고,
 * 그 판이 10월물에서 11월물로 갈아탔다는 사실은 기록에 **한 글자도 없었다.**
 */
test('★ 장 밖 실행도 그날 월물을 어떻게 정했는지를 싣는다 — 굳히는 판이 늘 장 밖이다', () => {
  const reason = closedRunReason({
    why: 'market_closed=before_open',
    syncReason: 'synced,contract_roll=deadline_reached_while_thin:A05610->A05611',
    notes: ['position=flat,closed=0', 'broker=failed'],
  })
  assert.ok(reason.startsWith('market_closed=before_open|'), reason)
  assert.ok(reason.includes('contract_roll=deadline_reached_while_thin:A05610->A05611'), reason)
})

test('굳은 날의 사유도 그대로 남는다 — 「어떻게 정했나」의 답이 날마다 있어야 한다', () => {
  const reason = closedRunReason({ why: 'market_closed=after_close', syncReason: 'day_config_frozen', notes: [] })
  assert.equal(reason, 'market_closed=after_close|day_config_frozen')
})

test('빈 표식은 버린다 — 빈 칸이 끼면 사유를 쪼갠 쪽이 빈 토막을 받는다', () => {
  const reason = closedRunReason({ why: 'no_night_quote:minuteChart', syncReason: '', notes: ['', 'broker=failed', ''] })
  assert.equal(reason, 'no_night_quote:minuteChart|broker=failed')
})

/**
 * 사유 앞 토막은 `run-reason` 이 정규식으로 읽는다. 앞에 뭔가 더 붙으면 그 줄을 못 알아보고
 * 화면이 「장이 아직 안 열렸습니다」 대신 모르는 표식을 접어 둔다
 */
test('안 물은 사유가 맨 앞을 지킨다 — run-reason 이 그 자리를 보고 읽는다', () => {
  const reason = closedRunReason({ why: 'market_closed=auction', syncReason: 'day_config_frozen', notes: ['x=1'] })
  assert.equal(reason.split('|')[0], 'market_closed=auction')
})

/**
 * **부르는 자리를 센다.** 이 함수가 아무리 맞게 돌아도 크론이 안 부르면 기록은 그대로 빈다 —
 * 10-05 자정에 실제로 그랬다. 그래서 단정이 「값이 거기까지 가나」를 본다
 */
test('★ 크론의 장 밖 반환이 둘 다 이 함수를 지나고 syncReason 을 넘긴다', () => {
  const tick = readFileSync(join(HERE_TICK, 'tick.ts'), 'utf8')
  const calls = tick.match(/closedRunReason\(\{/g) ?? []
  assert.equal(calls.length, 2, `장 밖 반환은 둘인데 ${calls.length}곳만 이 함수를 지난다`)
  // 인자에 syncReason 이 실제로 들어가는지 — 선언만 하고 안 넘기면 기록은 예전 그대로다
  const passed = tick.match(/closedRunReason\(\{[\s\S]{0,400}?syncReason[,:\s]/g) ?? []
  assert.equal(passed.length, 2, `syncReason 을 넘기는 자리가 ${passed.length}곳뿐이다`)
  /*
    신호 쪽에도 `roll=` 이 있고 그것은 「만기 이월 중이라 신호를 안 냈다」는 뜻이다.
    교체 판정이 그 이름을 쓰면 운영 화면이 월물을 갈아탄 줄을 신호 이야기로 읽는다.
    그래서 `rollNote` 에 넣는 값이 전부 `contract_roll` 로 시작하는지를 센다
  */
  assert.ok(tick.includes('contract_roll='), '갈아탄 사유를 안 적는다')
  assert.ok(tick.includes('contract_roll_no='), '안 갈아탄 사유를 안 적는다')
  /*
    교체 표식을 짧은 이름으로 적은 자리가 하나라도 남으면 그 줄이 신호 규칙에 잡힌다.
    **주석을 먼저 걷어낸다** — 이 파일의 설명 글에도 `roll=` 이 나오고,
    주석을 세는 가드는 코드를 고쳐도 계속 빨갛거나 계속 초록이다
  */
  const code = stripComments(tick)
  assert.ok(!/[`'"]roll(_no)?=/.test(code), '교체 사유를 신호 쪽 roll= 과 같은 이름으로 적는 자리가 남았다')
})
