/**
 * 관문 — **「미달」과 「아직 못 잼」은 다른 상태다**
 *
 * 표본 80건으로 「기대값 하한이 0 이하라 미달」이라고 말하면 읽는 사람은 전략이 나쁘다고
 * 읽는다. 사실은 아직 아무것도 모르는 것이다. 그 둘을 섞으면 멀쩡한 전략을 버리거나,
 * 반대로 표본이 없는데 통과시킨다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateGate, type GateInput, type GateThresholds } from './criteria.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const T: GateThresholds = {
  minValidateTrades: 500,
  minLockboxTrades: 100,
  minProfitFactor: 1.25,
  maxDrawdownLimitMultiple: 8,
  dailyLossLimitKrw: 500_000,
  minJudgeImprovementR: 0.05,
}

/** 전부 통과하는 입력 */
const GOOD: GateInput = {
  thresholds: T,
  validateTradeCount: 600,
  lockboxTradeCount: 150,
  validateExpectancy: { estimate: 0.3, lower: 0.1, upper: 0.5 },
  lockboxExpectancy: { estimate: 0.25, lower: 0.05, upper: 0.45 },
  harshExpectancyR: 0.12,
  profitFactor: 1.4,
  maxDrawdownR: 20,
  riskPerTradeKrw: 100_000,
  calibration: { betterThanBaseRate: true, monotonic: true, insufficient: false },
  judgeComparison: { better: true, reason: 'better_by:0.1200' },
  riskArithmeticOk: true,
}

/**
 * 명세 §13.5 는 여덟 줄인데 재는 것은 **열 가지**다.
 * 「거래 수」 줄이 검증 합계와 Lockbox 둘을 말하고,
 * 「기대값 하한」 줄이 하한과 Lockbox 일관성 둘을 말하기 때문이다.
 * 한 줄로 합치면 어느 쪽이 모자란지가 사라진다.
 */
test('★ 명세 여덟 줄이 열 가지 판정으로 펼쳐지고, 전부 좋으면 통과한다', () => {
  const verdict = evaluateGate(GOOD)
  assert.equal(verdict.passed, true, verdict.criteria.filter((c) => c.status !== 'pass').map((c) => c.detail).join(' / '))
  assert.equal(verdict.failedCount, 0)
  assert.equal(verdict.insufficientCount, 0)
  assert.deepEqual(verdict.criteria.map((c) => c.id), [
    'trade_count', 'lockbox_count', 'expectancy_lower', 'lockbox_consistency',
    'harsh_slippage', 'profit_factor', 'max_drawdown', 'calibration',
    'judge_comparison', 'risk_arithmetic',
  ])
})

test('★ 표본이 모자라면 「미달」이 아니라 「아직 못 잼」이다', () => {
  const verdict = evaluateGate({ ...GOOD, validateTradeCount: 80 })
  const tradeCount = verdict.criteria.find((c) => c.id === 'trade_count')
  assert.equal(tradeCount?.status, 'insufficient', '표본 부족을 미달로 말했다 — 멀쩡한 전략을 버리게 된다')
  assert.equal(verdict.failedCount, 0, '미달이 하나도 없는데 미달로 셌다')
  assert.equal(verdict.passed, false, '못 쟀는데 통과시켰다')
})

test('★ 하나라도 미달이면 통과가 아니다', () => {
  const verdict = evaluateGate({ ...GOOD, profitFactor: 1.1 })
  assert.equal(verdict.passed, false)
  assert.equal(verdict.failedCount, 1)
  const pf = verdict.criteria.find((c) => c.id === 'profit_factor')
  assert.equal(pf?.status, 'fail')
  assert.ok(pf?.detail.includes('1.100') && pf.detail.includes('1.25'),
    '얼마나 모자란지가 없으면 다음에 무엇을 할지 모른다')
})

test('★ 기대값 하한이 0 이하면 미달이고 얼마인지 말한다', () => {
  const verdict = evaluateGate({ ...GOOD, validateExpectancy: { estimate: 0.1, lower: -0.05, upper: 0.25 } })
  const c = verdict.criteria.find((c) => c.id === 'expectancy_lower')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('-0.050'))
})

test('★ 가혹 슬리피지에서 0 이하면 미달 — 가정이 조금만 나빠져도 뒤집히는 전략이다', () => {
  const verdict = evaluateGate({ ...GOOD, harshExpectancyR: -0.02 })
  const c = verdict.criteria.find((c) => c.id === 'harsh_slippage')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('뒤집히는'))
})

test('★ 최종 검증이 검증 구간 범위 밖이면 미달이다', () => {
  const outOfRange = evaluateGate({ ...GOOD, lockboxExpectancy: { estimate: 0.9, lower: 0.7, upper: 1.1 } })
  assert.equal(outOfRange.criteria.find((c) => c.id === 'lockbox_consistency')?.status, 'fail')

  const flipped = evaluateGate({ ...GOOD, lockboxExpectancy: { estimate: -0.2, lower: -0.4, upper: 0 } })
  assert.equal(flipped.criteria.find((c) => c.id === 'lockbox_consistency')?.status, 'fail', '부호가 뒤집혔는데 통과했다')
})

test('최종 검증을 안 열었으면 못 잰 것이다', () => {
  const verdict = evaluateGate({ ...GOOD, lockboxExpectancy: null })
  assert.equal(verdict.criteria.find((c) => c.id === 'lockbox_consistency')?.status, 'insufficient')
})

test('★ MDD 는 일일 손실 한도 × 배수로 잰다', () => {
  // 20R × 100,000원 = 2,000,000원, 상한 500,000 × 8 = 4,000,000 → 통과
  assert.equal(evaluateGate(GOOD).criteria.find((c) => c.id === 'max_drawdown')?.status, 'pass')
  // 50R × 100,000 = 5,000,000 → 미달
  const over = evaluateGate({ ...GOOD, maxDrawdownR: 50 })
  const c = over.criteria.find((c) => c.id === 'max_drawdown')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('5,000,000') && c.detail.includes('4,000,000'))
})

test('PF 를 못 재면(잃은 거래 0) 미달이 아니라 못 잰 것이다', () => {
  const verdict = evaluateGate({ ...GOOD, profitFactor: null })
  assert.equal(verdict.criteria.find((c) => c.id === 'profit_factor')?.status, 'insufficient')
})

test('보정이 기저율보다 나쁘면 미달이고 왜인지 말한다', () => {
  const worse = evaluateGate({ ...GOOD, calibration: { betterThanBaseRate: false, monotonic: true, insufficient: false } })
  const c = worse.criteria.find((c) => c.id === 'calibration')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('아무 정보도'))

  const notMono = evaluateGate({ ...GOOD, calibration: { betterThanBaseRate: true, monotonic: false, insufficient: false } })
  assert.ok(notMono.criteria.find((c) => c.id === 'calibration')?.detail.includes('오름차순'))
})

test('보정 표본이 모자라면 못 잰 것이다', () => {
  const verdict = evaluateGate({ ...GOOD, calibration: { betterThanBaseRate: false, monotonic: false, insufficient: true } })
  assert.equal(verdict.criteria.find((c) => c.id === 'calibration')?.status, 'insufficient')
})

test('판단기가 다른 것보다 낫지 않으면 미달이다', () => {
  const verdict = evaluateGate({ ...GOOD, judgeComparison: { better: false, reason: 'lower_not_positive:-0.01' } })
  const c = verdict.criteria.find((c) => c.id === 'judge_comparison')
  assert.equal(c?.status, 'fail')
  assert.ok(c?.detail.includes('lower_not_positive'))
})

test('리스크 산술이 안 맞으면 미달이다', () => {
  const verdict = evaluateGate({ ...GOOD, riskArithmeticOk: false })
  assert.equal(verdict.criteria.find((c) => c.id === 'risk_arithmetic')?.status, 'fail')
})

test('★ 관문 숫자를 코드에 박지 않는다 — 화면이 말하는 기준과 재는 기준이 갈린다', () => {
  const src = readFileSync(join(HERE, 'criteria.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const literal of ['500', '1.25', '100)', '0.05']) {
    assert.equal(body.includes(literal), false, `관문 기준 ${literal} 이 코드에 박혀 있다`)
  }
  // 전부 thresholds 에서 온다
  assert.match(body, /t\.minValidateTrades/)
  assert.match(body, /t\.minProfitFactor/)
  assert.match(body, /t\.maxDrawdownLimitMultiple/)
})

/* ── 못 잰 줄에 할 일이 붙는다 (사용자 지적 2026-09-28) ── */

import { readFileSync as readSrcFile } from 'node:fs'
import { join as joinSrcPath, dirname as dirSrcPath } from 'node:path'
import { fileURLToPath as urlSrcPath } from 'node:url'

const WEB_ROOT = joinSrcPath(dirSrcPath(urlSrcPath(import.meta.url)), '..', '..', '..')

/**
 * **「없습니다」만 있는 화면은 읽는 사람의 일을 늘리기만 한다.**
 * 실측 2026-09-28 검증 화면 열 줄이 전부 「아직 못 잼」이고 할 일이 한 줄도 없었다.
 */
test('★ 못 잰 줄마다 무엇을 하면 되는지가 붙는다', () => {
  const src = readSrcFile(joinSrcPath(WEB_ROOT, 'lib', 'trading', 'gate', 'criteria.ts'), 'utf8')
  // 못 잰 줄을 만드는 자리가 할 일을 기본으로 들고 있다
  assert.match(src, /how: string = RUN_VALIDATION/, '할 일 기본값이 없다')
  assert.match(src, /return \{ id, label, status: 'insufficient', actual, required, detail, how \}/,
    '할 일을 만들어 놓고 안 담는다')
  // 잰 줄에는 안 붙는다 — 늘 뜨는 안내는 안 읽힌다
  const passLine = src.slice(src.indexOf('function pass('), src.indexOf('function fail('))
  assert.equal(/how/.test(passLine), false, '지나간 줄에도 할 일이 붙는다')
})

/**
 * **할 일이 참이어야 한다.** 「밤마다 도는 검증이 거래를 만듭니다」라고 쓰려면
 * 그 검증이 실제로 돌아야 한다 — 실측 2026-09-28 그 크론이 등록조차 안 돼 있었고,
 * 그래서 봉이 쌓여도 거래가 영영 0건이었다.
 */
test('★ 검증이 실제로 도는 크론이 등록돼 있다 — 안 그러면 그 할 일은 거짓말이다', () => {
  const vercel = JSON.parse(
    readSrcFile(joinSrcPath(WEB_ROOT, 'vercel.json'), 'utf8'),
  ) as { crons: { path: string; schedule: string }[] }
  const validate = vercel.crons.find((c) => c.path === '/api/trading/cron/validate')
  assert.ok(validate, '검증 크론이 없다 — 아무도 안 부르면 거래가 영영 0건이다')
  // 매분 도는 수집과 달리 가끔 부른다. 한 바퀴가 길고 결과가 달라지려면 봉이 며칠은 쌓여야 한다
  assert.equal(/^\* \* \* \* \*$/.test(validate!.schedule), false, '무거운 일을 매분 돌린다')
  assert.ok(vercel.crons.some((c) => c.path === '/api/trading/cron/tick'), '수집 크론이 사라졌다')
})

test('★ 검증 화면이 그 할 일을 실제로 그린다', () => {
  const panel = readSrcFile(joinSrcPath(WEB_ROOT, 'app', '(trading)', 'trading', 'BacktestPanel.tsx'), 'utf8')
  assert.match(panel, /c\.how && /, '할 일을 안 그린다')
  assert.match(panel, /styles\.how/, '곁말로 안 구분한다')
})
