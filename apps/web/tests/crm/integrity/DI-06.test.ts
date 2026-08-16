/**
 * DI-06 전이 — WON 은 성사일과 금액 없이 존재할 수 없다
 * 근거: 구현명세서 2.3 chk_won / 3.4 "OPEN → WON(won_at, amount 필수)"
 *       DB(CHECK)와 앱(state-machines) 두 곳에서 같은 판정을 하는지 함께 확인한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData, catchError } from './_helpers.ts'
import { canTransitDeal } from '../../../lib/crm/domain/state-machines.ts'

const base = (id: string) => ({
  id, companyId: `co_${id}`, pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: '테스트 딜',
})

test('DI-06 DB: 금액·성사일 없는 WON 은 저장되지 않는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_dl_di06') })
    const e = await catchError(() =>
      tx.crmDeal.create({ data: { ...base('dl_di06'), companyId: 'co_dl_di06', status: 'WON' } }))
    assert.ok(e, 'chk_won 이 통과됐다')
    assert.match(String(e), /chk_won/, `CHECK(chk_won) 위반이 아니라 다른 오류가 났다`)
  })
})

test('DI-06 DB: 금액과 성사일이 있으면 WON 이 저장된다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_dl_di06b') })
    const d = await tx.crmDeal.create({
      data: {
        ...base('dl_di06b'), companyId: 'co_dl_di06b',
        status: 'WON', wonAt: new Date(), amountMinor: 300000000n, currency: 'KRW',
      },
    })
    assert.equal(d.status, 'WON')
  })
})

test('DI-06 앱: 상태 머신도 같은 판정을 한다', () => {
  assert.equal(canTransitDeal('OPEN', 'WON', {}).ok, false)
  assert.equal(canTransitDeal('OPEN', 'WON', { wonAt: new Date() }).ok, false)
  assert.equal(canTransitDeal('OPEN', 'WON', { wonAt: new Date(), amountMinor: 1 }).ok, true)
})
