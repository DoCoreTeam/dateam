/**
 * 가드 — **표에 있는 값이 관문까지 가는가**
 *
 * 이 시험이 막는 두 회귀는 서로 다르다.
 *
 * ① 「고정 null 되살리기」 — `overview.ts` 가 관문에 직접 null 을 적어 넣는 판.
 *   숫자를 select 로 가져와 놓고 버리므로 화면은 언제나 「아직 못 잼」이 된다.
 *   단위 시험으로는 안 잡힌다. `buildGateInput` 은 여전히 초록이고 아무도 안 부를 뿐이다.
 *   그래서 **부르는 자리를 읽는다**.
 *
 * ② 「계산 한 자리 더 복사하기」 — 대표 시세·대표 변동폭을 다른 파일에 또 적는 판.
 *   세 자리가 있었고 셋이 조금씩 달랐다(파이프라인 0.4, 설정 저장소 0.39).
 *   같은 관문이 낮과 밤에 다른 답을 냈다. 그래서 **그 숫자가 어디 적혀 있는지 센다**.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGateInput, type BacktestRunRow } from './overview-gate.ts'
import { evaluateGate, type GateThresholds } from './gate/criteria.ts'
import { TYPICAL_PRICE_POINTS, TYPICAL_ATR_POINTS, typicalTradeRisk } from './risk/arithmetic.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const THRESHOLDS: GateThresholds = {
  minValidateTrades: 500,
  minLockboxTrades: 100,
  minProfitFactor: 1.25,
  maxDrawdownLimitMultiple: 8,
  dailyLossLimitKrw: 500_000,
  minJudgeImprovementR: 0.05,
}

function run(over: Partial<BacktestRunRow>): BacktestRunRow {
  return {
    window_kind: 'validate',
    trade_count: 600,
    net_expectancy_r: 0.12,
    profit_factor: 1.4,
    max_drawdown_krw: 1_200_000,
    ...over,
  }
}

test('★ 표에 있는 profit_factor 와 max_drawdown_krw 가 관문까지 간다', () => {
  const risk = 250_000
  const input = buildGateInput({
    runs: [run({}), run({ window_kind: 'lockbox', trade_count: 120 })],
    thresholds: THRESHOLDS,
    typicalRiskKrw: risk,
  })
  assert.equal(input.profitFactor, 1.4, '표에 있는 값을 버렸다')
  assert.equal(input.maxDrawdownR, 1_200_000 / risk, 'MDD 를 R 로 환산하지 않았다')
  assert.equal(input.riskPerTradeKrw, risk)
  assert.equal(input.validateTradeCount, 600)
  assert.equal(input.lockboxTradeCount, 120)
})

test('★ 여러 구간을 돌렸으면 가장 나쁜 쪽을 쓴다', () => {
  const input = buildGateInput({
    runs: [
      run({ profit_factor: 1.9, max_drawdown_krw: 400_000 }),
      run({ profit_factor: 1.1, max_drawdown_krw: 3_000_000 }),
    ],
    thresholds: THRESHOLDS,
    typicalRiskKrw: 200_000,
  })
  assert.equal(input.profitFactor, 1.1, '좋은 구간만 보면 관문이 헐거워진다')
  assert.equal(input.maxDrawdownR, 3_000_000 / 200_000)
})

test('★ NUMERIC 칸이 문자열로 와도 읽는다', () => {
  /*
    `profit_factor` 들은 NUMERIC 이고 PostgREST 는 NUMERIC 을 **문자열로** 준다
    (`'1.4000'`, `'1200000.00'`). 숫자로만 시험하면 실제 표를 붙인 날 조용히
    전부 못 잼이 된다 — 형이 안 맞아 오류가 나는 것이 아니라 값이 안 읽힐 뿐이다.
  */
  const input = buildGateInput({
    runs: [{
      window_kind: 'validate',
      trade_count: 600,
      net_expectancy_r: '0.1200',
      profit_factor: '1.4000',
      max_drawdown_krw: '1200000.00',
    }],
    thresholds: THRESHOLDS,
    typicalRiskKrw: 250_000,
  })
  assert.equal(input.profitFactor, 1.4)
  assert.equal(input.maxDrawdownR, 1_200_000 / 250_000)
})

test('거래가 0건인 줄의 요약 숫자는 안 쓴다', () => {
  const input = buildGateInput({
    runs: [run({ trade_count: 0, profit_factor: 99, max_drawdown_krw: 0 })],
    thresholds: THRESHOLDS,
    typicalRiskKrw: 200_000,
  })
  assert.equal(input.profitFactor, null, '거래 0건의 성적은 뜻이 없다')
  assert.equal(input.maxDrawdownR, null)
})

test('빈 칸은 0 이 아니라 못 잼이다', () => {
  const input = buildGateInput({
    runs: [run({ profit_factor: null, max_drawdown_krw: '' })],
    thresholds: THRESHOLDS,
    typicalRiskKrw: 200_000,
  })
  assert.equal(input.profitFactor, null)
  assert.equal(input.maxDrawdownR, null)
})

test('★ 리스크 산술은 거래가 0건이어도 답이 나온다', () => {
  const ok = buildGateInput({ runs: [], thresholds: THRESHOLDS, typicalRiskKrw: 120_000 })
  assert.equal(ok.riskArithmeticOk, true, '한도 50만에 1회 위험 12만이면 신호가 나갈 수 있다')
  const tooBig = buildGateInput({ runs: [], thresholds: THRESHOLDS, typicalRiskKrw: 900_000 })
  assert.equal(tooBig.riskArithmeticOk, false, '한도보다 1회 위험이 크면 신호가 한 건도 못 나간다')
  const verdict = evaluateGate(tooBig)
  const line = verdict.criteria.find((c) => c.id === 'risk_arithmetic')
  assert.equal(line?.status, 'fail', '잴 수 있는 줄을 못 잼으로 두면 사람이 고칠 곳을 못 찾는다')
})

test('규격을 못 읽었으면 리스크 산술은 못 잼이다 (0 으로 채우지 않는다)', () => {
  const unknownRisk = buildGateInput({ runs: [], thresholds: THRESHOLDS, typicalRiskKrw: null })
  assert.equal(unknownRisk.riskArithmeticOk, null)
  assert.equal(unknownRisk.riskPerTradeKrw, null)
  assert.equal(unknownRisk.maxDrawdownR, null, '1R 을 모르면 MDD 를 R 로 못 바꾼다')
  const zeroRisk = buildGateInput({ runs: [], thresholds: THRESHOLDS, typicalRiskKrw: 0 })
  assert.equal(zeroRisk.riskArithmeticOk, null, '0 원은 계산이 된 것이 아니다')
})

test('★ 현황 화면이 관문에 고정 null 을 적어 넣지 않는다', () => {
  const src = readFileSync(join(HERE, 'overview.ts'), 'utf8')
  assert.ok(src.includes('buildGateInput('), 'overview.ts 가 buildGateInput 을 안 부른다')
  // 부르기만 하고 그 결과를 안 쓰는 판을 막는다 — 값이 관문까지 가야 한다
  assert.ok(
    /evaluateGate\(\s*buildGateInput\(/.test(src),
    'evaluateGate 에 buildGateInput 의 결과가 아닌 것을 넘긴다',
  )
  for (const field of ['profitFactor', 'maxDrawdownR', 'riskPerTradeKrw', 'riskArithmeticOk']) {
    assert.ok(
      !new RegExp(`${field}:\\s*null`).test(src),
      `overview.ts 가 ${field} 를 고정 null 로 되돌렸다 — 표에 값이 있어도 화면은 「아직 못 잼」이 된다`,
    )
  }
})

/** lib/trading 밑의 .ts 를 전부 모은다 (시험 파일 제외) */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { sourceFiles(full, acc); continue }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    acc.push(full)
  }
  return acc
}

test('★ 대표 시세와 대표 변동폭이 한 자리에만 적혀 있다', () => {
  const home = join(HERE, 'risk', 'arithmetic.ts')
  const offenders: string[] = []
  for (const file of sourceFiles(HERE)) {
    if (file === home) continue
    // 주석은 세지 않는다 — 여기가 왜 그 숫자를 안 쓰는지 적어 둘 수 있어야 한다
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const n of [TYPICAL_PRICE_POINTS, TYPICAL_ATR_POINTS]) {
      // 소수점을 정규식 와일드카드로 두면 1.3 이 103 도 잡는다 — 실제로 두 건을 오탐했다
      const literal = String(n).replace(/\./g, '\\.')
      if (new RegExp(`(?<![\\d.])${literal}(?![\\d.])`).test(code)) {
        offenders.push(`${relative(HERE, file)} (${n})`)
      }
    }
  }
  assert.deepEqual(
    offenders, [],
    `한 거래 위험 계산이 복사됐다 — typicalTradeRisk 를 부르지 않으면 같은 관문이 낮과 밤에 다른 답을 낸다: ${offenders.join(', ')}`,
  )
})

test('★ 검증 파이프라인과 설정 저장소가 같은 함수로 잰다', () => {
  for (const rel of ['validation/pipeline.ts', 'settings/store.ts', 'overview.ts']) {
    const src = readFileSync(join(HERE, rel), 'utf8')
    assert.ok(src.includes('typicalTradeRisk('), `${rel} 이 대표 1회 위험을 따로 센다`)
  }
})

test('설정을 바꾸면 대표 1회 위험이 따라 움직인다 (고정값이 아니다)', () => {
  const instrument = { multiplier: 50_000, tickSize: 0.05 }
  const base = typicalTradeRisk({
    instrument, stopAtrMultiple: 1.2, chaseAtrMultiple: 0.3, stopSlippageTicks: 2, roundTripFeeKrw: 0,
  })
  const wider = typicalTradeRisk({
    instrument, stopAtrMultiple: 2.4, chaseAtrMultiple: 0.3, stopSlippageTicks: 2, roundTripFeeKrw: 0,
  })
  assert.ok(wider.riskPerTradeKrw > base.riskPerTradeKrw, '손절을 멀리 두면 1회 위험이 커져야 한다')
  const withFee = typicalTradeRisk({
    instrument, stopAtrMultiple: 1.2, chaseAtrMultiple: 0.3, stopSlippageTicks: 2, roundTripFeeKrw: 5_000,
  })
  assert.equal(withFee.riskPerTradeKrw, base.riskPerTradeKrw + 5_000, '왕복 비용이 1회 위험에 들어가야 한다')
})
