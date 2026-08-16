/**
 * DI-02 중복 — 같은 워크스페이스에서 회사 도메인은 중복될 수 없다.
 *              다른 워크스페이스에서는 같은 도메인이 허용된다(격리와 중복은 다른 축이다).
 * 근거: crm_schema @@unique([workspaceId, domain]) / TASKS T1-02 "DI-02, 03, 18"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData, catchError, errCode } from './_helpers.ts'

test('DI-02 같은 워크스페이스에서 같은 도메인은 두 번 만들 수 없다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di02_a', { domain: 'dup.example.com' }) })
    const e = await catchError(() =>
      tx.crmCompany.create({ data: companyData('co_di02_b', { domain: 'dup.example.com' }) }))
    assert.ok(e, '중복 도메인이 통과했다')
    assert.equal(errCode(e), 'P2002', `유니크 위반이 아니라 ${errCode(e)} 가 났다`)
  })
})

test('DI-02 도메인이 null 이면 여러 건이 허용된다 (Postgres 는 null 을 중복으로 보지 않는다)', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di02_n1') })
    await tx.crmCompany.create({ data: companyData('co_di02_n2') })
    assert.equal(await tx.crmCompany.count({ where: { id: { in: ['co_di02_n1', 'co_di02_n2'] } } }), 2)
  })
})
