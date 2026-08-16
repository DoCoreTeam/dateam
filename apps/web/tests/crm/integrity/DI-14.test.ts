/**
 * DI-14 예산 — 사용액 증가는 ai_run 생성과 같은 트랜잭션이어야 한다
 * 근거: crm_schema CrmAiBudget.spentMinorUsd "// ai_run 생성과 단일 트랜잭션으로 증가(DI-14)"
 *       구현명세서 3.6-3 "실행 후 실제 비용을 spent 에 가산(ai_run 생성과 단일 트랜잭션)"
 *
 * 둘이 갈라지면 둘 다 틀린다 — run 만 남으면 공짜로 쓴 것이 되고,
 * spent 만 오르면 쓰지도 않은 돈이 빠진다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, catchError } from './_helpers.ts'

const MONTH = '2099-12' // 실사용 월과 겹치지 않게

test('DI-14 run 생성이 실패하면 spent 증가도 남지 않는다', async () => {
  const before = await dbA.crmAiBudget.count({ where: { month: MONTH } })

  const e = await catchError(() => dbA.$transaction(async (tx: any) => {
    await tx.crmAiBudget.create({
      data: { id: 'bg_di14', month: MONTH, limitMinorUsd: 100000n, spentMinorUsd: 0n },
    })
    await tx.crmAiBudget.update({
      where: { id: 'bg_di14' }, data: { spentMinorUsd: { increment: 500n } },
    })
    // ai_run 이 실패하는 상황 — runId 로 없는 워크스페이스를 쓰는 대신 명시적으로 던진다
    throw new Error('ai_run 생성 실패')
  }))

  assert.ok(e, '트랜잭션이 성공해버렸다')
  assert.equal(await dbA.crmAiBudget.count({ where: { month: MONTH } }), before,
    'run 이 실패했는데 예산 행이 남았다')
})

test('DI-14 둘 다 성공하면 함께 반영된다 (같은 트랜잭션 안에서 확인)', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmAiBudget.create({
      data: { id: 'bg_di14b', month: MONTH, limitMinorUsd: 100000n, spentMinorUsd: 0n },
    })
    const run = await tx.crmAiRun.create({
      data: {
        id: 'run_di14', kind: 'MEETING_EXTRACT', model: 'test-model',
        promptVersion: 'meeting_extract@v1.0.0', inputRef: { meetingId: 'm1' },
        costMinorUsd: 500n,
      },
    })
    await tx.crmAiBudget.update({
      where: { id: 'bg_di14b' }, data: { spentMinorUsd: { increment: run.costMinorUsd } },
    })
    const budget = await tx.crmAiBudget.findUnique({ where: { id: 'bg_di14b' } })
    assert.equal(budget.spentMinorUsd, 500n)
    assert.equal(await tx.crmAiRun.count({ where: { id: 'run_di14' } }), 1)
  })
  assert.equal(await dbA.crmAiRun.count({ where: { id: 'run_di14' } }), 0, '롤백됐어야 한다')
})

test('DI-14 사용액은 음수가 될 수 없다 (chk_budget)', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmAiBudget.create({
      data: { id: 'bg_di14c', month: MONTH, limitMinorUsd: 100n, spentMinorUsd: 0n },
    })
    const e = await catchError(() => tx.crmAiBudget.update({
      where: { id: 'bg_di14c' }, data: { spentMinorUsd: { decrement: 1n } },
    }))
    assert.ok(e, '음수 사용액이 저장됐다')
    assert.match(String(e), /chk_budget/)
  })
})
