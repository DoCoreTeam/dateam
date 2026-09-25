/**
 * 매분 감시 — **열린 포지션은 어떤 경우에도 계속 본다** (§10.2)
 *
 * 수익 목표를 채웠어도, 게이트가 걸렸어도, 시간이 모자라도 본다.
 * 빠지면 그 포지션은 아무도 안 보는 채로 남고 손절가를 지나도 모른다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WATCH_ORDER, watchTasks, planWithinBudget, watchReason, NEVER_DEFERRED,
  type WatchTask,
} from './watch-plan.ts'
import { RUN_BUDGET_MS } from './tick-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

test('★ 순서가 명세 §10.2 그대로다', () => {
  assert.deepEqual([...WATCH_ORDER], [
    'open_position_risk', 'protection', 'daily_loss_limit',
    'session_close', 'profit_target', 'new_signal',
  ])
})

test('★ 수익 목표를 채워도 열린 포지션 감시는 안 멈춘다', () => {
  const tasks = watchTasks({ hasPosition: true, profitTargetReached: true, gateBlocked: false })
  assert.ok(tasks.includes('open_position_risk'))
  assert.ok(tasks.includes('protection'))
  // 멈추는 것은 새 신호뿐이다
  assert.equal(tasks.includes('new_signal'), false)
})

test('★ 게이트가 걸려도 열린 포지션 감시는 안 멈춘다', () => {
  const tasks = watchTasks({ hasPosition: true, profitTargetReached: false, gateBlocked: true })
  assert.ok(tasks.includes('open_position_risk'))
  assert.equal(tasks.includes('new_signal'), false)
})

test('포지션이 없으면 포지션 감시는 할 일이 없다', () => {
  const tasks = watchTasks({ hasPosition: false, profitTargetReached: false, gateBlocked: false })
  assert.equal(tasks.includes('open_position_risk'), false)
  assert.ok(tasks.includes('new_signal'))
})

// ── 50초 상한 (§14.3) ────────────────────────────────────

const ALL: WatchTask[] = [...WATCH_ORDER]

test('시간이 넉넉하면 전부 한다', () => {
  const plan = planWithinBudget({ tasks: ALL, elapsedMs: 0, budgetMs: RUN_BUDGET_MS, perTaskMs: 1000 })
  assert.deepEqual(plan.run, ALL)
  assert.deepEqual(plan.deferred, [])
})

test('★ 시간이 모자라면 남은 일을 다음 실행으로 미룬다', () => {
  const plan = planWithinBudget({ tasks: ALL, elapsedMs: 40_000, budgetMs: RUN_BUDGET_MS, perTaskMs: 4_000 })
  assert.ok(plan.deferred.length > 0, '넘치는데 하나도 안 미뤘다')
  assert.equal(plan.run.length + plan.deferred.length, ALL.length, '일이 사라졌다')
})

test('★ 시간이 다 지나도 열린 포지션 감시는 안 미룬다', () => {
  // 목록이 비면 아래 반복이 한 번도 안 돌아 늘 초록이다. 실측: 목록을 비우고 깨뜨려 봤더니 통과했다
  assert.deepEqual([...NEVER_DEFERRED], ['open_position_risk', 'protection'])
  const plan = planWithinBudget({ tasks: ALL, elapsedMs: 49_999, budgetMs: RUN_BUDGET_MS, perTaskMs: 4_000 })
  for (const task of NEVER_DEFERRED) {
    assert.ok(plan.run.includes(task), `${task} 를 미뤘다`)
    assert.equal(plan.deferred.includes(task), false)
  }
  // 나머지는 다음 실행으로
  assert.ok(plan.deferred.includes('new_signal'))
})

test('★ 예산을 이미 넘겼어도 안 미루는 일은 한다 — 늦게 보는 것이 안 보는 것보다 낫다', () => {
  const plan = planWithinBudget({ tasks: ALL, elapsedMs: 90_000, budgetMs: RUN_BUDGET_MS, perTaskMs: 4_000 })
  assert.deepEqual(plan.run, ['open_position_risk', 'protection'])
  assert.equal(plan.deferred.length, 4)
})

test('★ 하는 일이 §10.2 순서를 지킨다 — 안 미루는 일을 앞으로 뽑아도', () => {
  const shuffled: WatchTask[] = ['new_signal', 'protection', 'session_close', 'open_position_risk']
  const plan = planWithinBudget({ tasks: shuffled, elapsedMs: 0, budgetMs: RUN_BUDGET_MS, perTaskMs: 1000 })
  const ranks = plan.run.map((t) => WATCH_ORDER.indexOf(t))
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `순서가 어긋났다: ${plan.run.join(',')}`)
})

test('무엇을 하고 무엇을 미뤘는지가 사유에 남는다 — 조용히 미루면 「했는데 아무 일 없었다」와 같아진다', () => {
  assert.equal(
    watchReason({ run: ['open_position_risk'], deferred: ['new_signal'] }),
    'watch=open_position_risk,deferred=new_signal')
  assert.equal(watchReason({ run: [], deferred: [] }), 'watch=none')
})

// ── 창구와 배선 ──────────────────────────────────────────

test('★ 새 창구를 안 연다 — cron/tick 하나가 다 한다', () => {
  const apiDir = join(HERE, '..', '..', '..', 'app', 'api', 'trading')
  const routes: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory()) { walk(join(dir, name.name)); continue }
      if (name.name === 'route.ts') routes.push(join(dir, name.name))
    }
  }
  walk(apiDir)
  // 1-A 의 tick 과 1-B 의 validate 둘뿐이다. 감시가 창구를 하나 더 열지 않았다
  const names = routes.map((r) => r.slice(r.indexOf('app/api/trading'))).sort()
  assert.deepEqual(names, [
    'app/api/trading/cron/tick/route.ts',
    'app/api/trading/cron/validate/route.ts',
  ], `창구가 늘었다: ${names.join(', ')}`)
})

test('★ 감시가 tick 에서 불린다 — 만들고 안 부르면 포지션을 아무도 안 본다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.ok(/\brunWatch\s*\(/.test(tick), 'tick 이 runWatch 를 안 부른다')
})

test('★ 감시가 봉 확정보다 먼저 돈다 — 봉이 안 와도 포지션은 봐야 한다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const watchAt = tick.search(/\brunWatch\s*\(/)
  const barAt = tick.search(/decideBarConfirmation\s*\(/)
  assert.ok(watchAt > 0 && barAt > 0)
  assert.ok(watchAt < barAt,
    '봉 확정 뒤에 감시한다 — 봉이 결측인 분에 return 하면 그 분은 포지션을 안 본다')
})

test('★ 감시가 주문을 안 부른다 (M1)', () => {
  const src = readFileSync(join(HERE, 'watch.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.equal(/\b[A-Z]{4}\d{4}U\b/.test(src), false)
  assert.equal(/trading\/(ngt-)?order\b/.test(src), false)
})

test('★ 대조 잠금을 코드가 스스로 안 푼다', () => {
  const src = readFileSync(join(HERE, 'watch.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.equal(/resolved_by|mismatch_resolved/.test(src), false,
    '감시가 대조를 스스로 푼다 — 푸는 것은 사람뿐이다(§11)')
})

test('★ 신호 발행이 tick 에서 불린다 — 1-C 의 본체다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.ok(/\bemitSignal\s*\(/.test(tick), 'tick 이 emitSignal 을 안 부른다')
  // 부르는 함수가 있어도 그 함수를 아무도 안 부르면 안 도는 것이다
  assert.ok(/\bemitOrExplain\s*\(/.test(tick.replace(/async function emitOrExplain[\s\S]*/, '')),
    'emitOrExplain 을 정의만 하고 안 부른다')
})

test('★ 신호 발행이 판단 뒤에 온다 — 판단 없이 신호가 설 수 없다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const judgeAt = tick.search(/await runJudges\(/)
  const emitAt = tick.search(/const emitNote = await emitOrExplain\(/)
  assert.ok(judgeAt > 0 && emitAt > 0)
  assert.ok(judgeAt < emitAt, '판단보다 먼저 신호를 낸다')
})

test('★ 발행 실패가 판단 기록을 안 죽인다 — 곁가지가 본 일을 죽이지 않는다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const fn = tick.slice(tick.indexOf('async function emitOrExplain'))
  assert.ok(fn.includes('try {') && fn.includes('} catch'), '발행이 감싸져 있지 않다')
  assert.ok(fn.includes('emit_failed:'), '실패 사유를 안 남긴다')
})

test('★ 감시 실패도 수집을 안 죽인다', () => {
  const tick = readFileSync(join(HERE, 'tick.ts'), 'utf8')
  const start = tick.indexOf('const accountRef = await loadAccountRef')
  const fn = tick.slice(start, tick.indexOf('직전 1분 봉이 확정됐나', start))
  assert.ok(fn.includes('try {') && fn.includes('} catch'), '감시가 감싸져 있지 않다')
  assert.ok(fn.includes('watch_failed:'), '실패 사유를 안 남긴다')
})

test('★ 발행이 다섯 단계 판정을 직접 안 다시 쓴다 — 판정은 한 곳이다', () => {
  const src = readFileSync(join(HERE, 'emit-signal.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  assert.ok(src.includes('decideEmit('), '발행이 순서 판정을 안 부른다')
  // 「나가도 되나」를 여기서 다시 세면 emit.ts 와 갈린다
  assert.equal(/ruleBlocks\.length\s*===?\s*0|gateHits\.length\s*===?\s*0/.test(src), false,
    '발행이 제 나름의 통과 판정을 만든다')
})

test('★ 신호가 나가면 발송 시각을 적는다 (§14.2) — 한 번만', () => {
  const src = readFileSync(join(HERE, 'emit-signal.ts'), 'utf8')
  assert.ok(src.includes('notify_sent_at'), '발송 시각을 안 적는다')
  assert.ok(src.includes(".is('notify_sent_at', null)"), '발송 시각을 매번 덮는다')
})

test('★ 감시가 대조 상태를 스스로 되돌리지 않는다', () => {
  const src = readFileSync(join(HERE, 'watch.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  // `positionState` 에 들어가는 값은 입력과 `nextState` 의 결과뿐이다.
  // 상태 이름을 직접 대입하면 그 줄이 코드가 스스로 푸는 길이다(§11)
  const assigns = [...src.matchAll(/positionState\s*=\s*([^\n]+)/g)].map((m) => m[1].trim())
  for (const rhs of assigns) {
    assert.ok(
      rhs.startsWith('input.positionState') || rhs.startsWith('nextState('),
      `positionState 에 직접 값을 넣는다: ${rhs}`,
    )
  }
})

test('★ 신호 없는 알림에 유일 키를 준다 — NULL 은 아무것도 안 막는다', () => {
  const src = readFileSync(join(HERE, 'watch.ts'), 'utf8')
  const fn = src.slice(src.indexOf('const queue = async'))
  const body = fn.slice(0, fn.indexOf('\n  }'))
  assert.ok(body.includes('dedupeKey:'), '유일 키를 안 준다 — 같은 경고가 매분 쌓인다')
  assert.ok(body.includes('dailyDedupeKey('), '유일 키를 손으로 조립한다 — 규칙이 두 곳이 된다')
})
