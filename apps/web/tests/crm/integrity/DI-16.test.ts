/**
 * DI-16 — 소프트 삭제 레코드는 목록·검색·리포트에서 빠지고, 휴지통에서 복구된다
 * 근거: 통합기획서 v0.2.1 951행 (DI 표 원문)
 *       473행 "소프트 삭제 기본: deleted_at 컬럼, 30일 보관 후 하드 삭제 배치, 휴지통 복구 제공"
 *       632행 "유니크 제약은 전부 부분 인덱스로 선언해 휴지통과 충돌 방지"
 *
 * 사용자 결정(2026-08-16): 소프트 삭제 + 즉시(영구) 삭제 선택 — 둘 다 제공한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, companyData } from './_helpers.ts'
import { TRASH_RETENTION_DAYS, isPurgeDue } from '../../../lib/crm/domain/soft-delete.ts'

test('DI-16 휴지통에 넣은 레코드는 목록에서 빠진다 (필터를 손으로 안 붙여도)', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di16') })
    assert.equal(await tx.crmCompany.count({ where: { id: 'co_di16' } }), 1)

    await tx.crmCompany.update({ where: { id: 'co_di16' }, data: { deletedAt: new Date() } })
    assert.equal(await tx.crmCompany.count({ where: { id: 'co_di16' } }), 0, '지운 것이 목록에 남아 있다')
    assert.equal(await tx.crmCompany.findUnique({ where: { id: 'co_di16' } }), null)
  })
})

test('DI-16 휴지통은 일부러 열어야 보인다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di16b') })
    await tx.crmCompany.update({ where: { id: 'co_di16b' }, data: { deletedAt: new Date() } })

    const trashed = await tx.crmCompany.findMany({ where: { deletedAt: { not: null } } })
    assert.ok(trashed.some((c: any) => c.id === 'co_di16b'), '휴지통에서도 안 보인다')
  })
})

test('DI-16 휴지통에서 복구하면 다시 목록에 나타난다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di16c') })
    await tx.crmCompany.update({ where: { id: 'co_di16c' }, data: { deletedAt: new Date() } })
    assert.equal(await tx.crmCompany.count({ where: { id: 'co_di16c' } }), 0)

    // 복구: 삭제된 행을 명시해서 되살린다
    await tx.crmCompany.update({
      where: { id: 'co_di16c', deletedAt: { not: null } },
      data: { deletedAt: null },
    })
    assert.equal(await tx.crmCompany.count({ where: { id: 'co_di16c' } }), 1, '복구되지 않았다')
  })
})

test('DI-16 휴지통에 있는 동안 같은 도메인으로 다시 만들 수 있다 (부분 유니크)', async () => {
  // 이게 마이그 201 의 존재 이유다. 전체 유니크면 "지웠는데 왜 못 만들지"가 된다.
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di16d1', { domain: 'trash.example.com' }) })
    await tx.crmCompany.update({ where: { id: 'co_di16d1' }, data: { deletedAt: new Date() } })

    await tx.crmCompany.create({ data: companyData('co_di16d2', { domain: 'trash.example.com' }) })
    assert.equal(await tx.crmCompany.count({ where: { domain: 'trash.example.com' } }), 1)
  })
})

test('DI-16 영구 삭제는 휴지통에 있는 것을 실제로 지운다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di16e') })
    await tx.crmCompany.update({ where: { id: 'co_di16e' }, data: { deletedAt: new Date() } })

    // delete 에는 삭제 필터가 붙지 않는다 — 붙으면 휴지통 비우기가 0건이 된다
    const r = await tx.crmCompany.deleteMany({ where: { id: 'co_di16e' } })
    assert.equal(r.count, 1, '휴지통 비우기가 0건이다')
    assert.equal(await tx.crmCompany.count({ where: { deletedAt: { not: null }, id: 'co_di16e' } }), 0)
  })
})

test(`DI-16 보관 기간은 ${TRASH_RETENTION_DAYS}일이고, 지나면 정리 대상이 된다`, () => {
  const deletedAt = new Date('2026-08-16T00:00:00Z')
  assert.equal(isPurgeDue(deletedAt, new Date('2026-09-14T00:00:00Z')), false)
  assert.equal(isPurgeDue(deletedAt, new Date('2026-09-15T00:00:00Z')), true)
})
