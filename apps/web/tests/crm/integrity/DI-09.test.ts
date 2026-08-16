/**
 * DI-09 — 스테이지 이동 시 stage_history 생성과 duration 계산, 트랜잭션 원자성
 * 근거: 통합기획서 v0.2.1 944행 (DI 표 원문)
 *       539행 "스테이지 변경 트랜잭션에서 항상 함께 기록"
 *       703행 "딜 갱신 + stage_history 삽입 + 자동화 이벤트 발행을 단일 트랜잭션"
 *
 * 이력이 빠지면 영업 사이클 길이·정체 감지가 통째로 거짓이 된다.
 * 이력만 남고 딜이 안 바뀌거나 그 반대면, 두 값이 서로를 반박한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData, catchError } from './_helpers.ts'
import { durationSecBetween, toStageHistoryData, isRealMove } from '../../../lib/crm/domain/stage-history.ts'

const T0 = new Date('2026-08-01T00:00:00Z')
const T1 = new Date('2026-08-04T00:00:00Z') // +3일

test('DI-09 duration 은 직전 이동으로부터의 초다', () => {
  assert.equal(durationSecBetween(T0, T1), 3 * 24 * 3600)
})

test('DI-09 첫 이동은 duration 이 null 이다 — 0 이 아니다', () => {
  // 0 은 "머물지 않았다", null 은 "모른다". 섞으면 평균 체류 시간이 거짓이 된다
  assert.equal(durationSecBetween(null, T1), null)
})

test('DI-09 시계 역전은 음수 대신 0 으로 접는다', () => {
  assert.equal(durationSecBetween(T1, T0), 0)
})

test('DI-09 같은 스테이지로의 이동은 이력이 아니다', () => {
  assert.equal(isRealMove('st_gpu_1', 'st_gpu_1'), false)
  assert.equal(isRealMove('st_gpu_1', 'st_gpu_2'), true)
  assert.equal(isRealMove(null, 'st_gpu_1'), true)
})

test('DI-09 딜 갱신과 이력 삽입이 한 트랜잭션이다 — 이력이 실패하면 딜도 안 바뀐다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di09') })
    await tx.crmDeal.create({
      data: { id: 'dl_di09', companyId: 'co_di09', pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: '이동 딜' },
    })

    // 딜을 옮기고 이력을 남기는 도중 이력이 실패하는 상황
    const e = await catchError(async () => {
      await tx.crmDeal.update({ where: { id: 'dl_di09' }, data: { stageId: 'st_gpu_2' } })
      await tx.crmStageHistory.create({
        // dealId 를 없는 값으로 줘서 FK 로 실패시킨다
        data: { id: 'sh_di09_bad', dealId: 'dl_nonexistent', toStageId: 'st_gpu_2' },
      })
    })
    assert.ok(e, '이력 삽입이 성공해버렸다')
  })

  // 트랜잭션이 롤백됐으므로 딜도 이력도 남지 않는다
  assert.equal(await dbA.crmDeal.count({ where: { id: 'dl_di09' } }), 0)
})

test('DI-09 정상 이동은 딜과 이력이 함께 남는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di09b') })
    await tx.crmDeal.create({
      data: { id: 'dl_di09b', companyId: 'co_di09b', pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: '이동 딜' },
    })
    await tx.crmDeal.update({ where: { id: 'dl_di09b' }, data: { stageId: 'st_gpu_2' } })
    await tx.crmStageHistory.create({
      data: {
        id: 'sh_di09b',
        ...toStageHistoryData({
          dealId: 'dl_di09b', fromStageId: 'st_gpu_1', toStageId: 'st_gpu_2',
          movedById: null, movedAt: T1, prevMovedAt: T0,
        }),
      },
    })

    const deal = await tx.crmDeal.findUnique({ where: { id: 'dl_di09b' } })
    assert.equal(deal.stageId, 'st_gpu_2')
    const rows = await tx.crmStageHistory.findMany({ where: { dealId: 'dl_di09b' } })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].durationSec, 3 * 24 * 3600)
    assert.equal(rows[0].fromStageId, 'st_gpu_1')
  })
})

test('DI-09 딜이 사라지면 이력도 함께 사라진다 (CASCADE)', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di09c') })
    await tx.crmDeal.create({
      data: { id: 'dl_di09c', companyId: 'co_di09c', pipelineId: 'pl_gpu', stageId: 'st_gpu_1', name: 'x' },
    })
    await tx.crmStageHistory.create({
      data: { id: 'sh_di09c', dealId: 'dl_di09c', toStageId: 'st_gpu_1' },
    })
    await tx.crmDeal.delete({ where: { id: 'dl_di09c' } })
    assert.equal(await tx.crmStageHistory.count({ where: { dealId: 'dl_di09c' } }), 0, '고아 이력이 남았다')
  })
})
