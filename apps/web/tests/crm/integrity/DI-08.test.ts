/**
 * DI-08 전이 — WON 에서 LOST 로 바로 갈 수 없다 (재오픈을 거쳐야 한다)
 * 근거: 구현명세서 3.4 "WON → LOST 직접 전이 금지"
 *
 * 이건 DB CHECK 로는 못 막는다(두 상태 모두 각자의 CHECK 를 만족시킬 수 있다).
 * 그래서 앱 상태 머신이 유일한 방어선이고, 이 테스트가 그 사실 자체를 고정한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { canTransitDeal, assertTransit } from '../../../lib/crm/domain/state-machines.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

test('DI-08 WON → LOST 는 금지된다', () => {
  const v = canTransitDeal('WON', 'LOST', { lostReason: '사후 취소' })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'NOT_ALLOWED')
})

test('DI-08 LOST → WON 도 금지된다 (실주 사유가 남은 채 성사가 되면 리포트가 두 번 센다)', () => {
  assert.equal(canTransitDeal('LOST', 'WON', { wonAt: new Date(), amountMinor: 1 }).ok, false)
})

test('DI-08 재오픈을 거치면 갈 수 있다', () => {
  assert.equal(canTransitDeal('WON', 'OPEN', { reopenReason: '고객 취소 통보' }).ok, true)
  assert.equal(canTransitDeal('OPEN', 'LOST', { lostReason: '고객 취소' }).ok, true)
})

test('DI-08 서비스가 우회하면 422 로 막힌다', () => {
  assert.throws(
    () => assertTransit('deal', 'WON', 'LOST', { lostReason: 'x' }),
    (e: unknown) => e instanceof CrmError && e.status === 422,
  )
})
