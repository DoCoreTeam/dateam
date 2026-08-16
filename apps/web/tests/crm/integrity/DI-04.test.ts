/**
 * DI-04 삭제 차단 — 열린 딜을 가진 회사는 삭제할 수 없다
 * 근거: crm_schema CrmDeal.company onDelete: Restrict "// DI-04: 열린 딜 보유 회사 삭제 차단"
 *       구현명세서 5장 DELETE /api/crm/companies/[id] → 422 OPEN_DEALS_EXIST
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData, catchError, errCode } from './_helpers.ts'

test('DI-04 딜이 딸린 회사를 지우려 하면 DB 가 막는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di04') })
    await tx.crmDeal.create({
      data: { id: 'dl_di04', companyId: 'co_di04', pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: '열린 딜' },
    })
    const e = await catchError(() => tx.crmCompany.delete({ where: { id: 'co_di04' } }))
    assert.ok(e, '딜이 있는데 회사가 지워졌다')
    assert.equal(errCode(e), 'P2003', `FK 제약 위반이 아니라 ${errCode(e)} 가 났다`)
  })
})

test('DI-04 딜이 없는 회사는 지워진다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di04_free') })
    await tx.crmCompany.delete({ where: { id: 'co_di04_free' } })
    assert.equal(await tx.crmCompany.count({ where: { id: 'co_di04_free' } }), 0)
  })
})
