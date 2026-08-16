/**
 * DI-03 중복 — 같은 워크스페이스에서 인물 이메일은 중복될 수 없다
 * 근거: crm_schema @@unique([workspaceId, email]) / TASKS T1-02 "DI-02, 03, 18"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, catchError, errCode } from './_helpers.ts'

test('DI-03 같은 이메일의 인물을 두 번 만들 수 없다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmPerson.create({ data: { id: 'pe_di03_a', name: '홍길동', email: 'dup@example.com' } })
    const e = await catchError(() =>
      tx.crmPerson.create({ data: { id: 'pe_di03_b', name: '홍길순', email: 'dup@example.com' } }))
    assert.ok(e, '중복 이메일이 통과했다')
    assert.equal(errCode(e), 'P2002')
  })
})

test('DI-03 이메일이 없으면 동명이인을 여러 건 만들 수 있다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmPerson.create({ data: { id: 'pe_di03_n1', name: '김철수' } })
    await tx.crmPerson.create({ data: { id: 'pe_di03_n2', name: '김철수' } })
    assert.equal(await tx.crmPerson.count({ where: { name: '김철수' } }), 2)
  })
})
