/**
 * DI-05 정합 — 딜의 스테이지는 반드시 같은 파이프라인 소속이어야 한다
 * 근거: crm_schema CrmDeal.stage @relation(fields:[pipelineId, stageId]) "// DI-05 복합 FK"
 *       CrmStage @@unique([pipelineId, id]) "// 딜의 stage 가 반드시 같은 pipeline 소속임을 DB 가 보장"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData, catchError, errCode } from './_helpers.ts'

test('DI-05 다른 파이프라인의 스테이지를 붙이면 DB 가 막는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di05') })
    const e = await catchError(() => tx.crmDeal.create({
      // pl_gpu 인데 스테이지는 파트너십(st_partner_1)
      data: { id: 'dl_di05', companyId: 'co_di05', pipelineId: 'pl_gpu', stageId: 'st_partner_1', name: '불일치' },
    }))
    assert.ok(e, '파이프라인이 다른 스테이지가 붙었다')
    assert.equal(errCode(e), 'P2003')
  })
})

test('DI-05 같은 파이프라인의 스테이지는 붙는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di05_ok') })
    const deal = await tx.crmDeal.create({
      data: { id: 'dl_di05_ok', companyId: 'co_di05_ok', pipelineId: 'pl_gpu', stageId: 'st_gpu_3', name: '정상' },
    })
    assert.equal(deal.stageId, 'st_gpu_3')
  })
})

test('DI-05 스테이지 이동도 같은 파이프라인 안에서만 된다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di05_mv') })
    await tx.crmDeal.create({
      data: { id: 'dl_di05_mv', companyId: 'co_di05_mv', pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: '이동' },
    })
    await tx.crmDeal.update({ where: { id: 'dl_di05_mv' }, data: { stageId: 'st_gpu_2' } })
    const e = await catchError(() =>
      tx.crmDeal.update({ where: { id: 'dl_di05_mv' }, data: { stageId: 'st_public_1' } }))
    assert.ok(e, '다른 파이프라인 스테이지로 이동됐다')
  })
})
