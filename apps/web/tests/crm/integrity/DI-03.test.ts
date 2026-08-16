/**
 * DI-03 중복 — 같은 워크스페이스에서 인물 이메일은 중복될 수 없다
 * 근거: 통합기획서 v0.2.1 938행 "대소문자만 다른 이메일 인물 생성 | 중복 차단"
 *       534행 "(workspace_id, lower(email)) 부분 유니크"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, inRollback, catchError, errCode, companyData } from './_helpers.ts'

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

test('DI-03 대소문자만 다른 이메일도 중복이다 (원본 정의의 핵심)', async () => {
  // 앱이 소문자로 정규화하는 것은 앱의 약속일 뿐이다.
  // 임포트·이관·직접 SQL 이 우회하므로 DB 가 lower() 유니크로 막아야 한다(마이그 201).
  await inRollback(dbA, async (tx: any) => {
    await tx.crmPerson.create({ data: { id: 'pe_di03_c1', name: '홍길동', email: 'Case@Example.com' } })
    const e = await catchError(() =>
      tx.crmPerson.create({ data: { id: 'pe_di03_c2', name: '홍길순', email: 'case@example.com' } }))
    assert.ok(e, '대소문자만 다른 이메일이 통과했다')
  })
})

test('DI-03 회사 도메인도 대소문자를 구분하지 않는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: { id: 'co_di03_c1', name: 'A사', domain: 'Data-Alliance.com' } })
    const e = await catchError(() =>
      tx.crmCompany.create({ data: { id: 'co_di03_c2', name: 'B사', domain: 'data-alliance.com' } }))
    assert.ok(e, '대소문자만 다른 도메인이 통과했다')
  })
})
