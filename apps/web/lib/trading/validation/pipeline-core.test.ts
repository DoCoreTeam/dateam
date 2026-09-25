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
import { planSteps, checkStepOrder, stepMayRead, initialProgress } from './pipeline-core.ts'
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
    'backfillMinuteBars(', 'saveBacktestRun(', 'computeRisk(', 'profitFactor(', 'maxDrawdownR(',
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
