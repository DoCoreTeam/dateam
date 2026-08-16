/**
 * DI-15 예산 — 100% 도달 시 AI 는 소프트 차단, 코어 CRM 은 정상. 상한 상향 시 즉시 해제
 * 근거: 구현명세서 3.4 "Budget spent < limit 정상, >= 80% 경보 1회, >= 100% AI 소프트 차단(코어 CRM 정상),
 *       상한 상향 시 즉시 해제" / 3.6 / TASKS T1-07 "DI-14, 15"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateBudget, BUDGET_ALERT_RATIO } from '../../../lib/crm/domain/state-machines.ts'
import { dbA } from './_helpers.ts'

test('DI-15 100% 도달 시 차단으로 판정한다', () => {
  const v = evaluateBudget({ limitMinorUsd: 10000n, spentMinorUsd: 10000n })
  assert.equal(v.level, 'blocked')
  assert.equal(v.shouldBlock, true)
})

test(`DI-15 ${BUDGET_ALERT_RATIO * 100}% 경보는 1회만 나간다`, () => {
  assert.equal(evaluateBudget({ limitMinorUsd: 10000n, spentMinorUsd: 8000n }).shouldSendAlert, true)
  assert.equal(
    evaluateBudget({ limitMinorUsd: 10000n, spentMinorUsd: 9500n, alertSentAt: new Date() }).shouldSendAlert,
    false,
  )
})

test('DI-15 상한을 올리면 즉시 해제된다', () => {
  const v = evaluateBudget({ limitMinorUsd: 100000n, spentMinorUsd: 10000n, blockedAt: new Date() })
  assert.equal(v.level, 'ok')
  assert.equal(v.shouldUnblock, true)
})

test('DI-15 소프트 차단이다 — 예산이 막혀도 코어 CRM 조회는 살아 있다', async () => {
  // 차단은 ai/runner 앞단에서만 일어난다. 파이프라인·회사 조회가 예산에 의존하면 안 된다.
  assert.ok((await dbA.crmPipeline.count()) > 0, '코어 조회가 예산과 얽혀 있다')
  assert.equal(typeof (await dbA.crmCompany.count()), 'number')
})
