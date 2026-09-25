/**
 * 리스크 산술 — **숏에서 위험이 작게 나오는 버그**를 잡는다 (D-31)
 *
 * 롱의 진입 한계가는 기준가 위, 숏은 아래다. 숏에서 위쪽 값을 집으면 손절까지의 거리가
 * 짧게 나오고 위험이 작다고 계산된다. 그 버그는 화면에서 아무 일도 안 일어나고
 * **실제 손실에서만** 드러난다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  worstEntryPrice, computeRisk, remainingLossBudget,
  checkSignalAllowed, checkSettingsStorable, toR,
} from './arithmetic.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 명세 §9.2 의 상품 규격 */
const MINI = { multiplier: 50_000, tickSize: 0.02 }
const REGULAR = { multiplier: 250_000, tickSize: 0.05 }

test('★ 방향이 진입 한계가의 부호를 정한다 — 숏은 아래다', () => {
  assert.equal(worstEntryPrice('long', 1105, 0.4), 1105.4)
  assert.equal(worstEntryPrice('short', 1105, 0.4), 1104.6)
})

/**
 * 명세 §9.3 의 예시를 그대로 재현한다.
 * 지수 1,105 · 1분 ATR 1.3 → 손절 1.56(1.2×ATR) · 진입 한계 0.40(0.3×ATR)
 * 롱: 한계가 1105.60, 손절 1103.44 → 거리 2.16... 명세는 최악 진입 기준 1.96 을 든다
 * (명세의 손절가는 **기준가** 기준 1105 − 1.56 = 1103.44 이고, 최악 진입 1105.40 에서
 *  1103.44 까지가 1.96 이다)
 */
test('★ 명세 §9.3 의 미니 1계약 가격 위험이 100,000원으로 재현된다', () => {
  const risk = computeRisk({
    direction: 'long',
    instrument: MINI,
    referencePrice: 1105,
    stopPrice: 1105 - 1.56,
    chaseDistance: 0.4,
    stopSlippageTicks: 2,
    roundTripFeeKrw: 0,
    quantity: 1,
  })
  // 최악 진입 1105.40 − 손절 1103.44 = 1.96, 슬리피지 2틱 = 0.04 → 2.00pt
  assert.equal(risk.stopDistancePoints, 2, `거리가 ${risk.stopDistancePoints} 다 — 부동소수 오차가 남았다`)
  assert.equal(risk.priceRiskKrw, 100_000, '명세 §9.3 의 미니 가격 위험과 다르다')
})

test('★ 명세 §9.3 의 정규 1계약 가격 위험이 515,000원으로 재현된다', () => {
  const risk = computeRisk({
    direction: 'long',
    instrument: REGULAR,
    referencePrice: 1105,
    stopPrice: 1105 - 1.56,
    chaseDistance: 0.4,
    stopSlippageTicks: 2,
    roundTripFeeKrw: 0,
    quantity: 1,
  })
  // 1.96 + 2틱(0.10) = 2.06pt × 250,000 = 515,000
  assert.equal(risk.stopDistancePoints, 2.06)
  assert.equal(risk.priceRiskKrw, 515_000)
})

test('★ 숏의 위험이 롱과 같다 — 다르면 방향 부호가 한쪽에만 들어간 것이다', () => {
  const common = {
    instrument: MINI, chaseDistance: 0.4, stopSlippageTicks: 2,
    roundTripFeeKrw: 0, quantity: 1,
  }
  const long = computeRisk({ ...common, direction: 'long', referencePrice: 1105, stopPrice: 1105 - 1.56 })
  const short = computeRisk({ ...common, direction: 'short', referencePrice: 1105, stopPrice: 1105 + 1.56 })

  assert.equal(long.priceRiskKrw, short.priceRiskKrw,
    '숏 위험이 롱과 다르다 — 숏에서 위쪽 한계가를 집으면 위험이 작게 나온다(D-31)')
  assert.equal(short.worstEntryPrice, 1104.6, '숏 한계가가 기준가 위로 잡혔다')
})

test('1회 위험은 가격 위험 + 왕복 비용이다', () => {
  const risk = computeRisk({
    direction: 'long', instrument: MINI, referencePrice: 1105, stopPrice: 1105 - 1.56,
    chaseDistance: 0.4, stopSlippageTicks: 2, roundTripFeeKrw: 3_000, quantity: 1,
  })
  assert.equal(risk.riskPerTradeKrw, 103_000)
})

test('수량이 늘면 위험도 같은 배수로 는다', () => {
  const one = computeRisk({
    direction: 'long', instrument: MINI, referencePrice: 1105, stopPrice: 1103.44,
    chaseDistance: 0.4, stopSlippageTicks: 2, roundTripFeeKrw: 0, quantity: 1,
  })
  const three = computeRisk({
    direction: 'long', instrument: MINI, referencePrice: 1105, stopPrice: 1103.44,
    chaseDistance: 0.4, stopSlippageTicks: 2, roundTripFeeKrw: 0, quantity: 3,
  })
  assert.equal(three.priceRiskKrw, one.priceRiskKrw * 3)
})

// ── 남은 여유 ────────────────────────────────────────────

test('남은 여유는 한도에서 실현 손실과 열린 위험을 뺀 값이다', () => {
  assert.equal(remainingLossBudget({
    dailyLossLimitKrw: 500_000, realizedLossKrw: 120_000, openPositionRiskKrw: 100_000,
  }), 280_000)
})

test('★ 1회 위험이 남은 여유보다 크면 신호를 막고 숫자로 말한다', () => {
  const risk = computeRisk({
    direction: 'long', instrument: REGULAR, referencePrice: 1105, stopPrice: 1103.44,
    chaseDistance: 0.4, stopSlippageTicks: 2, roundTripFeeKrw: 0, quantity: 1,
  })
  const blocked = checkSignalAllowed(risk, {
    dailyLossLimitKrw: 500_000, realizedLossKrw: 0, openPositionRiskKrw: 0,
  })
  assert.ok(blocked, '515,000원 위험이 500,000원 한도를 지났는데 통과했다')
  assert.match(blocked.reason, /^risk_exceeds_budget:/)
  assert.ok(blocked.userMessage.includes('515,000'), '얼마나 넘었는지가 문장에 없다')

  // 미니면 통과한다
  const mini = computeRisk({
    direction: 'long', instrument: MINI, referencePrice: 1105, stopPrice: 1103.44,
    chaseDistance: 0.4, stopSlippageTicks: 2, roundTripFeeKrw: 0, quantity: 1,
  })
  assert.equal(checkSignalAllowed(mini, {
    dailyLossLimitKrw: 500_000, realizedLossKrw: 0, openPositionRiskKrw: 0,
  }), null)
})

test('★ 열린 포지션 위험이 여유를 먹는다 — 안 빼면 두 배를 질 수 있다', () => {
  const mini = computeRisk({
    direction: 'long', instrument: MINI, referencePrice: 1105, stopPrice: 1103.44,
    chaseDistance: 0.4, stopSlippageTicks: 2, roundTripFeeKrw: 0, quantity: 1,
  })
  // 여유 500,000 인데 이미 450,000 이 열려 있으면 100,000 짜리 신호는 못 낸다
  const blocked = checkSignalAllowed(mini, {
    dailyLossLimitKrw: 500_000, realizedLossKrw: 0, openPositionRiskKrw: 450_000,
  })
  assert.ok(blocked, '열린 포지션 위험을 안 뺐다')
})

// ── 저장 불가 (M6) ───────────────────────────────────────

test('★ 한도가 1회 위험보다 작은 설정은 저장되지 않는다 (M6)', () => {
  const regular = computeRisk({
    direction: 'long', instrument: REGULAR, referencePrice: 1105, stopPrice: 1103.44,
    chaseDistance: 0.4, stopSlippageTicks: 2, roundTripFeeKrw: 0, quantity: 1,
  })
  const rejected = checkSettingsStorable({ dailyLossLimitKrw: 500_000, typicalRisk: regular })
  assert.ok(rejected, '그 설정으로는 어떤 신호도 못 나가는데 저장됐다')
  assert.ok(rejected.userMessage.includes('어떤 신호도 나가지 못합니다'),
    '왜 안 되는지가 문장에 없으면 화면에는 「신호가 안 온다」로만 보인다')

  assert.equal(checkSettingsStorable({ dailyLossLimitKrw: 600_000, typicalRisk: regular }), null)
})

test('R 은 1회 위험 대비다 — 위험이 0이면 나눌 수 없어 null', () => {
  assert.equal(toR(50_000, 100_000), 0.5)
  assert.equal(toR(-100_000, 100_000), -1)
  assert.equal(toR(1, 0), null)
})

// ── 금액을 코드에 안 박는다 (M6) ─────────────────────────

test('★ 승수와 호가 단위를 코드에 박지 않는다 — 데이터로 계산한다', () => {
  const src = readFileSync(join(HERE, 'arithmetic.ts'), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const literal of ['250000', '250_000', '50000', '50_000', '12500', '12_500', '0.05', '0.02']) {
    assert.equal(body.includes(literal), false,
      `상품 규격 ${literal} 이 코드에 박혀 있다 — trading_instruments 에서 받아야 한다(M6)`)
  }
})
