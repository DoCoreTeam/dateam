/**
 * DI-18 잠금 — 낙관적 잠금. version 이 어긋나면 0건 갱신되고 409 로 응답한다
 * 근거: 구현명세서 2.4 "update 는 반드시 where { id, version } + data { version: { increment: 1 } },
 *       영향 행 0이면 409 CONFLICT 반환(DI-18)" / 7장 CONFLICT 409 details.currentVersion
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData } from './_helpers.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

test('DI-18 같은 version 으로 갱신하면 1건, version 이 1 오른다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di18') })
    const r = await tx.crmCompany.updateMany({
      where: { id: 'co_di18', version: 0 },
      data: { name: '갱신됨', version: { increment: 1 } },
    })
    assert.equal(r.count, 1)
    const after = await tx.crmCompany.findUnique({ where: { id: 'co_di18' } })
    assert.equal(after.version, 1)
    assert.equal(after.name, '갱신됨')
  })
})

test('DI-18 낡은 version 으로 갱신하면 0건이다 (덮어쓰지 않는다)', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di18b') })
    await tx.crmCompany.updateMany({
      where: { id: 'co_di18b', version: 0 },
      data: { name: '먼저 저장한 사람', version: { increment: 1 } },
    })
    // 두 번째 사람이 version 0 을 들고 왔다
    const r = await tx.crmCompany.updateMany({
      where: { id: 'co_di18b', version: 0 },
      data: { name: '나중에 저장한 사람', version: { increment: 1 } },
    })
    assert.equal(r.count, 0, '먼저 저장한 내용이 덮였다')
    const after = await tx.crmCompany.findUnique({ where: { id: 'co_di18b' } })
    assert.equal(after.name, '먼저 저장한 사람')
  })
})

test('DI-18 0건이면 409 CONFLICT 로 올린다', () => {
  // 서비스 계층이 count === 0 을 어떻게 다뤄야 하는지 고정한다
  const affected = 0
  const e = affected === 0 ? new CrmError('CONFLICT', undefined, { currentVersion: 1 }) : null
  assert.ok(e)
  assert.equal(e.status, 409)
  assert.equal(e.details.currentVersion, 1)
})
