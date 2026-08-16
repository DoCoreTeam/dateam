/**
 * DI-07 전이 — LOST 는 사유 없이 존재할 수 없다
 * 근거: 구현명세서 2.3 chk_lost / 3.4 "LOST(lost_reason 필수)"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData, catchError } from './_helpers.ts'
import { canTransitDeal } from '../../../lib/crm/domain/state-machines.ts'

test('DI-07 DB: 사유 없는 LOST 는 저장되지 않는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di07') })
    const e = await catchError(() => tx.crmDeal.create({
      data: { id: 'dl_di07', companyId: 'co_di07', pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: 'x', status: 'LOST' },
    }))
    assert.ok(e, 'chk_lost 가 통과됐다')
    assert.match(String(e), /chk_lost/)
  })
})

test('DI-07 DB: 사유가 있으면 LOST 가 저장된다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di07b') })
    const d = await tx.crmDeal.create({
      data: {
        id: 'dl_di07b', companyId: 'co_di07b', pipelineId: 'pl_gpu', stageId: 'st_gpu_1',
        name: 'x', status: 'LOST', lostReason: '가격 경쟁력 부족',
      },
    })
    assert.equal(d.lostReason, '가격 경쟁력 부족')
  })
})

test('DI-07 앱: 상태 머신도 같은 판정을 한다', () => {
  assert.equal(canTransitDeal('OPEN', 'LOST', {}).ok, false)
  assert.equal(canTransitDeal('OPEN', 'LOST', { lostReason: '예산 미확보' }).ok, true)
})
