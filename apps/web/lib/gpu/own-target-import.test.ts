import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchProductId, isOnDemandTerm, strategicKrwFromUsd, STRATEGIC_PRICE_MAX } from './own-target-import.ts'

const cands = [
  { id: 'a', model_name: 'A100 80GB' },
  { id: 'b', model_name: 'H100 80GB' },
  { id: 'c', model_name: 'RTX A6000' },
  { id: 'd', model_name: 'RTX 6000 Ada' },
]

test('matchProductId: 정규화 완전일치', () => {
  assert.equal(matchProductId(cands, 'a100 80gb'), 'a')
  assert.equal(matchProductId(cands, 'H100  80GB'), 'b')
})

test('matchProductId: generic 토큰 단독 오매칭 금지(RTX 6000 Ada ≠ RTX A6000)', () => {
  assert.equal(matchProductId(cands, 'RTX 6000 Ada'), 'd')
  assert.equal(matchProductId(cands, 'RTX A6000'), 'c')
})

test('matchProductId: 매칭 없으면 null', () => {
  assert.equal(matchProductId(cands, 'B200 192GB'), null)
})

test('isOnDemandTerm: on_demand 표기차 + 빈값만 true', () => {
  assert.equal(isOnDemandTerm('on_demand'), true)
  assert.equal(isOnDemandTerm('on-demand'), true)
  assert.equal(isOnDemandTerm('OD'), true)
  assert.equal(isOnDemandTerm(null), true)   // 약정 미상 → 대표가로 간주
  assert.equal(isOnDemandTerm('reserved_12m'), false)
  assert.equal(isOnDemandTerm('reserved_1m'), false)
})

test('strategicKrwFromUsd: USD/GPU/hr → KRW 반올림', () => {
  assert.equal(strategicKrwFromUsd(0.8102, 1523.4), Math.round(0.8102 * 1523.4))
  assert.equal(strategicKrwFromUsd(1.0416, 1523.4), 1587) // A100 ≈ 1587 KRW/hr
})

test('strategicKrwFromUsd: 비정상 입력/상한초과 → null(차단)', () => {
  assert.equal(strategicKrwFromUsd(0, 1500), null)
  assert.equal(strategicKrwFromUsd(-1, 1500), null)
  assert.equal(strategicKrwFromUsd(1, 0), null)
  assert.equal(strategicKrwFromUsd(STRATEGIC_PRICE_MAX, 1000), null) // 초과
})
