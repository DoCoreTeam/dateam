/**
 * 점검 — **모르는 것을 괜찮다고 안 센다**
 *
 * 값을 못 읽었을 때 ok 로 두면 화면이 초록이 되고 아무도 안 본다.
 * 실측 전례: 캘린더가 안 채워져 크론이 매분 「세션 정보 없음」으로 끝났는데 오류는 0건이었고
 * 봉이 닷새 동안 0줄이었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHECK_IDS, STATUS_RANK, runChecks, sortByUrgency, needsAttention,
  checkBars, checkCron, checkBroker, checkNotify, checkCalibration,
  checkGate, checkAiBudget, checkReconciled,
  type CheckInput, type CheckResult,
} from './checks.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 전부 멀쩡한 입력 */
const OK: CheckInput = {
  expectedBars: 380, actualBars: 380,
  minutesSinceRun: 1,
  brokerFailureStreak: 0,
  notifyFailureStreak: 0, pendingNotifications: 0,
  hasCalibration: true,
  gatePassed: true, gateInsufficient: 0,
  aiSpentKrw: 1000, aiBudgetKrw: 100000,
  reconciliationRequired: false,
  thresholds: {
    maxMissingBars: 5, maxMinutesSinceRun: 5, maxBrokerFailureStreak: 3,
    maxNotifyFailureStreak: 3, aiBudgetWarnRatio: 0.8,
  },
}

test('전부 멀쩡하면 여덟 다 ok', () => {
  const results = runChecks(OK)
  assert.equal(results.length, CHECK_IDS.length)
  assert.deepEqual(results.filter((r) => r.status !== 'ok'), [])
})

test('★ 점검을 하나도 안 건너뛴다 — 건너뛴 점검은 화면에서 「없다」와 같아 보인다', () => {
  const ids = runChecks(OK).map((r) => r.id)
  assert.deepEqual(ids, [...CHECK_IDS])
  // 값이 전부 없어도 여덟이 다 나온다
  const blank = Object.fromEntries(
    Object.keys(OK).filter((k) => k !== 'thresholds').map((k) => [k, null]),
  ) as unknown as CheckInput
  const all = runChecks({ ...blank, thresholds: OK.thresholds })
  assert.deepEqual(all.map((r) => r.id), [...CHECK_IDS])
})

test('★ 값이 없으면 ok 가 아니라 unknown 이다', () => {
  const blank = Object.fromEntries(
    Object.keys(OK).filter((k) => k !== 'thresholds').map((k) => [k, null]),
  ) as unknown as CheckInput
  const all = runChecks({ ...blank, thresholds: OK.thresholds })
  for (const r of all) {
    assert.equal(r.status, 'unknown', `${r.id} 가 값 없이 ${r.status} 로 나왔다`)
    assert.match(r.reason, /^no_value:|^no_budget_set$/)
    assert.ok(r.userMessage.includes('모릅니다'), `${r.id} 가 모른다고 말하지 않는다`)
  }
})

test('★ 세션 정보가 없으면 「봉 0개, 다 모였다」가 아니라 unknown 이다', () => {
  const r = checkBars({ ...OK, expectedBars: 0, actualBars: 0 })
  assert.equal(r.status, 'unknown')
  assert.equal(r.reason, 'no_session')
})

test('봉 결측은 문턱을 넘으면 fail, 넘기 전엔 warn', () => {
  assert.equal(checkBars({ ...OK, actualBars: 379 }).status, 'warn')
  assert.equal(checkBars({ ...OK, actualBars: 370 }).status, 'fail')
  assert.equal(checkBars({ ...OK, actualBars: 380 }).status, 'ok')
})

test('★ 판정 근거가 숫자로 남는다 — 「이상해 보인다」로는 고칠 곳을 못 찾는다', () => {
  const r = checkBars({ ...OK, actualBars: 370 })
  assert.deepEqual(r.measured, { expected: 380, actual: 370, missing: 10 })
  assert.match(r.reason, /^missing:10$/)
})

test('크론·증권사·알림 판정', () => {
  assert.equal(checkCron({ ...OK, minutesSinceRun: 9 }).status, 'fail')
  assert.equal(checkBroker({ ...OK, brokerFailureStreak: 1 }).status, 'warn')
  assert.equal(checkBroker({ ...OK, brokerFailureStreak: 3 }).status, 'fail')
  assert.equal(checkNotify({ ...OK, pendingNotifications: 2 }).status, 'warn')
  assert.equal(checkNotify({ ...OK, notifyFailureStreak: 3 }).status, 'fail')
})

test('★ 보정 모델 없음은 고장이 아니라 아직 안 만든 것이다', () => {
  const r = checkCalibration({ ...OK, hasCalibration: false })
  assert.equal(r.status, 'warn', '보정 없음을 고장으로 적었다')
  assert.ok(r.userMessage.includes('검증 단계가 먼저'))
})

test('관문 진행과 계좌 대조', () => {
  assert.equal(checkGate({ ...OK, gateInsufficient: 3 }).status, 'warn')
  assert.equal(checkGate({ ...OK, gatePassed: false }).status, 'warn')
  assert.equal(checkReconciled({ ...OK, reconciliationRequired: true }).status, 'fail')
})

test('★ 예산 상한이 0 이면 「다 찼다」가 아니라 「모른다」다 — 0 으로 나누지 않는다', () => {
  const r = checkAiBudget({ ...OK, aiBudgetKrw: 0 })
  assert.equal(r.status, 'unknown')
  assert.equal(r.reason, 'no_budget_set')
  assert.equal(checkAiBudget({ ...OK, aiSpentKrw: 85000 }).status, 'warn')
  assert.equal(checkAiBudget({ ...OK, aiSpentKrw: 100000 }).status, 'fail')
})

// ── 순서와 주목 ──────────────────────────────────────────

test('★ 급한 것부터. unknown 이 warn 보다 앞이다 — 모르는 것이 경고보다 급하다', () => {
  assert.ok(STATUS_RANK.fail < STATUS_RANK.unknown)
  assert.ok(STATUS_RANK.unknown < STATUS_RANK.warn)
  assert.ok(STATUS_RANK.warn < STATUS_RANK.ok)
})

test('급한 순서로 정렬하고 같은 급이면 정의 순서', () => {
  const rows = runChecks({
    ...OK, reconciliationRequired: true, hasCalibration: null, brokerFailureStreak: 1,
  })
  const sorted = sortByUrgency(rows)
  assert.equal(sorted[0].status, 'fail')
  assert.equal(sorted[1].status, 'unknown')
  assert.ok(STATUS_RANK[sorted[2].status] >= STATUS_RANK.warn)
})

test('★ unknown 도 손볼 것이다 — 그냥 두면 계속 모른다', () => {
  const rows = runChecks({ ...OK, hasCalibration: null })
  const attention = needsAttention(rows)
  assert.equal(attention.length, 1)
  assert.equal(attention[0].status, 'unknown')
  assert.deepEqual(needsAttention(runChecks(OK)), [])
})

// ── AI 가 판정에 안 들어간다 ─────────────────────────────

test('★ 점검에 AI 호출이 0개다', () => {
  const src = readFileSync(join(HERE, 'checks.ts'), 'utf8')
  assert.equal(/callKnowledge|callGemini|fetch\(|createAdminClient/.test(src), false,
    '점검이 AI 나 DB 를 부른다 — 판정은 넘겨받은 숫자로만 한다')
})

test('★ 모든 점검이 사람이 읽을 문장을 갖는다 — 조용히 넘어가는 항목 0개', () => {
  const inputs: CheckInput[] = [
    OK,
    { ...OK, actualBars: 300, minutesSinceRun: 99, brokerFailureStreak: 9,
      notifyFailureStreak: 9, pendingNotifications: 9, hasCalibration: false,
      gatePassed: false, gateInsufficient: 2, aiSpentKrw: 999999, reconciliationRequired: true },
  ]
  const seen = new Set<string>()
  for (const input of inputs) {
    for (const r of runChecks(input)) {
      seen.add(r.id)
      assert.ok(r.userMessage.length > 5, `${r.id} 의 문장이 너무 짧다`)
      assert.ok(r.reason.length > 0, `${r.id} 에 기계용 사유가 없다`)
      assert.ok(Object.keys(r.measured).length > 0, `${r.id} 에 잰 값이 없다`)
    }
  }
  assert.equal(seen.size, CHECK_IDS.length)
})

test('★ 문턱이 코드에 안 박혀 있다 — 전부 입력으로 온다', () => {
  const src = readFileSync(join(HERE, 'checks.ts'), 'utf8')
  const bodyStart = src.indexOf('export function checkBars')
  const body = src.slice(bodyStart)
  // 숫자 리터럴 비교가 있으면 문턱이 코드에 박힌 것이다 (0 과 1 은 경계라 예외)
  const hardcoded = [...body.matchAll(/[<>]=?\s*(\d+(?:\.\d+)?)/g)]
    .map((m) => m[1]).filter((n) => n !== '0' && n !== '1')
  assert.deepEqual(hardcoded, [], `문턱이 코드에 박혀 있다: ${hardcoded.join(', ')}`)
})

/** 같은 값을 두 번 넣어도 같은 결과 — 판정에 시각이나 난수가 안 끼었다 */
test('판정이 재현된다', () => {
  const a = runChecks(OK)
  const b = runChecks(OK)
  assert.deepEqual(a, b)
  const cast = (r: CheckResult) => `${r.id}:${r.status}`
  assert.deepEqual(a.map(cast), b.map(cast))
})
