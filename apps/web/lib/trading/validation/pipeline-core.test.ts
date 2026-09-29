/**
 * 검증 파이프라인 — **순서가 규칙의 전부다**
 *
 * 부품은 각자 맞아도 순서가 틀리면 전부 거짓이 된다.
 * 보정을 검증 구간 자료로 맞추면 그 검증은 자기 답을 보고 푸는 것이고,
 * 한 번이라도 어긋난 순서로 돌면 그 결과가 DB 에 남아 나중에 아무도 못 알아본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  planSteps, checkStepOrder, stepMayRead, initialProgress,
  newCallBudget, takeCall, budgetNote,
} from './pipeline-core.ts'
import type { WalkForwardPlan } from '../backtest/windows.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const PLAN: WalkForwardPlan = {
  folds: [
    { index: 0, trainFrom: '2026-01-01', trainTo: '2026-03-31', validateFrom: '2026-04-01', validateTo: '2026-04-10' },
    { index: 1, trainFrom: '2026-01-01', trainTo: '2026-04-10', validateFrom: '2026-04-11', validateTo: '2026-04-20' },
  ],
  developFrom: '2026-01-01',
  developTo: '2026-04-20',
  lockboxFrom: '2026-04-21',
  lockboxTo: '2026-05-10',
}

test('★ 접기마다 학습 → 보정 → 기대값표 → 검증 순이다', () => {
  const steps = planSteps(PLAN)
  const fold0 = steps.filter((s) => s.foldIndex === 0).map((s) => s.kind)
  assert.deepEqual(fold0, ['backtest_train', 'calibrate', 'build_ev', 'backtest_validate'])
  assert.equal(checkStepOrder(steps), null)
})

test('★ 보정과 기대값표가 학습 구간만 읽는다 — 검증 구간을 읽으면 자기 답을 본다', () => {
  const steps = planSteps(PLAN)
  for (const s of steps) {
    if (s.kind !== 'calibrate' && s.kind !== 'build_ev') continue
    const fold = PLAN.folds[s.foldIndex as number]
    assert.equal(s.windowTo, fold.trainTo, `${s.label} 이 학습 구간 밖을 읽는다`)
    assert.ok(s.windowTo < fold.validateFrom)
    assert.equal(stepMayRead(s, fold.validateFrom), false, `${s.label} 이 검증 구간 날짜를 읽을 수 있다`)
    assert.equal(stepMayRead(s, fold.trainTo), true)
  }
})

test('★ 관문이 맨 마지막이다 — 앞에 있으면 아직 안 만든 것으로 판정한다', () => {
  const steps = planSteps(PLAN)
  assert.equal(steps[steps.length - 1].kind, 'evaluate_gate')
  assert.equal(steps[steps.length - 2].kind, 'compare_judges')

  const reordered = [steps[steps.length - 1], ...steps.slice(0, -1)]
  const rejection = checkStepOrder(reordered)
  assert.equal(rejection?.reason, 'gate_not_last')
})

test('★ 순서가 뒤집힌 계획은 돌리기 전에 거절한다', () => {
  const steps = planSteps(PLAN)
  // 보정을 검증 뒤로 옮긴다
  const fold0 = steps.filter((s) => s.foldIndex === 0)
  const broken = [
    fold0[0], fold0[3], fold0[1], fold0[2],
    ...steps.filter((s) => s.foldIndex !== 0),
  ]
  const rejection = checkStepOrder(broken)
  assert.ok(rejection, '보정이 검증 뒤인데 통과했다')
  assert.match(rejection.reason, /^fold_0_step_order/)
  assert.ok(rejection.userMessage.includes('학습 뒤, 검증 앞'))
})

test('★ 학습 구간이 검증 구간과 겹치면 거절한다', () => {
  const steps = planSteps({
    ...PLAN,
    folds: [{ index: 0, trainFrom: '2026-01-01', trainTo: '2026-04-05', validateFrom: '2026-04-01', validateTo: '2026-04-10' }],
  })
  const rejection = checkStepOrder(steps)
  assert.ok(rejection, '학습이 검증과 겹치는데 통과했다')
  assert.match(rejection.reason, /window_overlap/)
  assert.ok(rejection.userMessage.includes('검증 구간을 보고 만든 모델'))
})

test('단계 수가 접기 수를 따른다', () => {
  assert.equal(planSteps(PLAN).length, 2 * 4 + 2)
  assert.equal(planSteps({ ...PLAN, folds: [PLAN.folds[0]] }).length, 1 * 4 + 2)
})

test('진행 상태가 첫 단계 이름을 말한다', () => {
  const steps = planSteps(PLAN)
  const progress = initialProgress(steps)
  assert.equal(progress.total, steps.length)
  assert.equal(progress.done, 0)
  assert.equal(progress.currentLabel, '1겹 학습 백테스트')
  assert.deepEqual(progress.failed, [])
})

// ── 배선 ─────────────────────────────────────────────────

test('★ 파이프라인이 1-B 부품을 실제로 부른다 — 만들어만 두지 않는다', () => {
  const src = readFileSync(join(HERE, 'pipeline.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const call of [
    'planWalkForward(', 'checkOrder(', 'planSteps(', 'checkStepOrder(',
    'runBacktest(', 'fitPlatt(', 'applyPlatt(', 'chooseMethod(', 'validateWindows(',
    'buildEvModel(', 'expectedValueFor(', 'fitMl(', 'createMlJudge(',
    'bootstrapExpectancy(', 'bootstrapDifference(', 'isBetterThan(',
    'evaluateGate(', 'spreadStats(', 'typicalTicks(', 'judgeCalibration(',
    'backfillMinuteBars(', 'saveBacktestRun(', 'profitFactor(', 'maxDrawdownR(',
    /*
      대표 1회 위험은 `typicalTradeRisk` 가 유일한 출처다(그 안에서 `computeRisk` 를 부른다).
      여기서 `computeRisk(` 를 요구하면 **계산을 한 자리 더 복사한 판이 초록이 된다** —
      가드가 막아야 할 바로 그 판이다.
    */
    'typicalTradeRisk(',
  ]) {
    assert.ok(body.includes(call), `파이프라인이 ${call} 를 안 부른다 — 만들어만 둔 부품이다`)
  }
})

test('★ 검증 창구가 새 인증을 안 만든다 — 기존 기계 인증을 쓴다', () => {
  const route = readFileSync(
    join(HERE, '..', '..', '..', 'app', 'api', 'trading', 'cron', 'validate', 'route.ts'), 'utf8')
  assert.match(route, /isMachineCall\(/)
  assert.match(route, /machineAuthUnconfigured\(/)
  assert.match(route, /export const maxDuration/, '한 바퀴가 길어 실행 한도가 필요하다')
  // 사람 세션 게이트를 여기 붙이지 않는다 — 부르는 쪽이 사람이 아니다
  assert.doesNotMatch(route, /requireAdminApi|getRequestUser/)
})

test('★ 트레이딩 창구가 둘뿐이다 — 검증 때문에 셋째가 생기지 않았다', () => {
  const api = join(HERE, '..', '..', '..', 'app', 'api', 'trading')
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  const routes = walk(api).filter((f) => f.endsWith('route.ts'))
  assert.equal(routes.length, 2, `창구가 ${routes.length}개다. 지킬 자리가 늘었다`)
})

/**
 * **검증이 Jev 를 부를 때는 상한이 먼저다** (§13.4 · §17.1)
 *
 * 백테스트는 진입 조건이 걸린 봉마다 판단기를 부른다. `rule`·`ml` 은 공짜지만 Jev 는
 * 벤더 호출이라 상한 없이 열면 한 바퀴에 수백 번이 나가고, 그 사실은 예산이 마른
 * 뒤에야 보인다. 실측 전례가 있다 — 상한을 아는 자리가 0곳이라 하루 23,318건이 나갔다.
 */
test('★ 상한을 넘으면 더 안 부른다', () => {
  const budget = newCallBudget(3)
  assert.equal(takeCall(budget), true)
  assert.equal(takeCall(budget), true)
  assert.equal(takeCall(budget), true)
  assert.equal(takeCall(budget), false, '상한을 넘겨 부른다')
  assert.equal(budget.used, 3, '못 부른 것까지 쓴 것으로 센다')
})

test('★ 0 이면 한 번도 안 부른다 — 「안 켰다」가 「무제한」이 되면 안 된다', () => {
  const budget = newCallBudget(0)
  assert.equal(takeCall(budget), false)
  assert.equal(budgetNote(budget, 0), 'jev=off:budget_zero')
})

test('★ 음수·소수는 정수 상한으로 읽는다', () => {
  assert.equal(newCallBudget(-5).max, 0, '음수가 무제한이 된다')
  assert.equal(newCallBudget(2.9).max, 2)
})

test('★ 몇 번 불렀고 몇 번 기권했는지가 사유에 남는다', () => {
  const budget = newCallBudget(5)
  takeCall(budget); takeCall(budget)
  assert.equal(budgetNote(budget, 1), 'jev=calls:2/5,abstain:1')
  // 상한에 닿았으면 그 사실도 말한다 — 「표본이 적다」와 「상한에 걸렸다」는 다른 일이다
  const full = newCallBudget(2)
  takeCall(full); takeCall(full); takeCall(full)
  assert.match(budgetNote(full, 3), /capped/)
})

test('★ Jev 가 안 돌았으면 「졌다」가 아니라 「안 쟀다」로 적는다', () => {
  const src = readFileSync(join(HERE, 'pipeline.ts'), 'utf8')
  assert.ok(src.includes('jevTrades.length > 0'), '표본 0건으로 비교를 낸다')
  assert.ok(src.includes("jev_better=not_measured"), '안 쟀다는 것을 사유에 안 남긴다')
  assert.ok(src.includes('`jev=off:${jev.reason}`'), '왜 안 돌았는지를 안 남긴다')
})

test('★ 키나 모델이 없어도 검증이 안 죽는다', () => {
  const src = readFileSync(join(HERE, 'pipeline.ts'), 'utf8')
  const fn = src.slice(src.indexOf('async function jevForValidation'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(body.includes('try {') && body.includes('catch'), '만들다 실패하면 검증 전체가 죽는다')
  assert.ok(body.includes("reason: 'model_not_set'"), '모델이 없는 것을 안 가른다')
  assert.equal(/throw/.test(body), false, '던진다 — 그날 검증이 통째로 사라진다')
})

test('★ 상한에 닿으면 기권이지 오류가 아니다', () => {
  const src = readFileSync(join(HERE, 'pipeline.ts'), 'utf8')
  const fn = src.slice(src.indexOf('function cappedJudge'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(body.includes("status: 'abstain'"), '상한에서 기권이 아니다')
  assert.ok(body.includes("abstainReason: 'call_cap'"), '왜 기권했는지를 안 남긴다')
  assert.equal(/throw/.test(body), false, '상한에서 던진다 — 그때까지 쌓은 결과가 버려진다')
})

test('★ 상한이 접기마다 새로 생기지 않는다 — 접기 수만큼 곱해진다', () => {
  const src = readFileSync(join(HERE, 'pipeline.ts'), 'utf8')
  const declaredAt = src.indexOf('const jev = await jevForValidation(')
  const foldAt = src.indexOf('for (const fold of')
  assert.ok(declaredAt > 0, 'Jev 판단기를 안 만든다')
  assert.ok(foldAt > 0, '접기 반복을 못 찾았다')
  assert.ok(declaredAt < foldAt, '접기 안에서 상한을 새로 만든다 — 상한이 뜻을 잃는다')
})


/* ── 검증이 실시간과 같은 장 규칙으로 잰다 (점검 2026-09-29) ── */

/**
 * **다른 규칙으로 잰 성적은 실제로 안 도는 전략의 것이다** (M4).
 *
 * 점검 전에는 이 자리가 `sessionCloseAt = 진입봉 + 24시간`, `isDecidable = () => true`,
 * `minutesSinceOpen = () => 0` 이었다. 장 끝 직전 진입을 세고 다음 날까지 들고 있는 것으로
 * 셈했으니, 그 성적으로 관문을 통과해도 그 숫자는 실시간의 것이 아니다.
 */
test('★ 검증 백테스트가 장 규칙을 고정값으로 안 쓴다', () => {
  const src = readFileSync(join(HERE, 'pipeline.ts'), 'utf8')
  const at = src.indexOf('const params = (slippageTicks')
  assert.ok(at > 0, '백테스트 인자를 못 찾았다')
  const body = src.slice(at, src.indexOf('\n  })', at))

  // 「무조건 된다」와 「장 연 지 0분」은 실시간에 없는 규칙이다
  assert.equal(/isDecidable:\s*\(\)\s*=>\s*true/.test(body), false,
    '아무 봉에서나 진입하는 것으로 잰다 — 장 끝 직전 진입이 성적에 섞인다')
  assert.equal(/minutesSinceOpen:\s*\(\)\s*=>\s*0/.test(body), false,
    '장이 열린 지 0분이라고 잰다')
  assert.equal(/24 \* 60 \* 60_000/.test(body.slice(0, body.indexOf('isDecidable'))), false,
    '당일 청산 대신 24시간 뒤로 잰다 — 다음 날까지 들고 있는 것으로 셈한다')

  // 실시간이 쓰는 그 함수를 써야 한다. 여기서 규칙을 새로 적으면 또 갈린다
  for (const fn of ['sameDayExitAt(', 'isContinuousTrading(', 'isAuctionWindow(']) {
    assert.ok(body.includes(fn), `${fn} 을 안 쓴다 — 실시간과 다른 규칙을 여기서 새로 적었다`)
  }
  // 청산 여유 분도 설정이다. 화면·실시간과 같은 키를 읽어야 한다
  assert.ok(src.includes("num('session_close_exit_minutes'"), '청산 여유를 설정에서 안 읽는다')
})

test('★ 세션을 모르는 날은 「되는 날」로 안 친다', () => {
  const src = readFileSync(join(HERE, 'pipeline.ts'), 'utf8')
  const at = src.indexOf('isDecidable: (barStartAt)')
  const body = src.slice(at, src.indexOf('},', at))
  assert.ok(body.includes('if (!w) return false'),
    '세션을 모르는 날을 판단 가능으로 친다 — 그 성적은 짐작이다')
})
