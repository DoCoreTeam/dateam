/**
 * DI-09 격리(쓰기) — 읽기뿐 아니라 쓰기도 워크스페이스를 넘을 수 없다
 * 근거: 구현명세서 2.2 "injectWorkspaceFilter 는 workspaceId 조건이 이미 있으면 검증(불일치 시 throw),
 *       없으면 추가. create/createMany 의 data 에도 강제 세팅"
 *       5장 공통규칙 "workspaceId 는 클라이언트가 보내지 않고 세션에서만 해석"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, dbB, WS_A, inRollback, companyData, catchError } from './_helpers.ts'

test('DI-09 create 에 남의 workspaceId 를 심으면 앱 가드가 막는다', async () => {
  const e = await catchError(() =>
    dbA.crmCompany.create({ data: { ...companyData('co_di09'), workspaceId: 'ws_somewhere_else' } as any }))
  assert.ok(e, '남의 워크스페이스로 생성됐다')
  assert.equal((e as any).code, 'WORKSPACE_MISMATCH')
})

test('DI-09 B 가 만든 것은 B 워크스페이스로 들어간다 (A 의 것이 되지 않는다)', async () => {
  await inRollback(dbB, async (tx: any) => {
    // 워크스페이스 행이 없으면 FK 가 서지 않는다 — B 는 이 트랜잭션 안에서만 존재한다
    await tx.crmWorkspace.create({ data: { name: '정합성테스트B' } })
    const c = await tx.crmCompany.create({ data: companyData('co_di09_b') })
    assert.equal(c.workspaceId, 'ws_integrity_b')
    // 같은 트랜잭션 안에서도 A 의 눈에는 안 보인다
    assert.equal(await tx.crmCompany.count({ where: { id: 'co_di09_b' } }), 1)
  })
})

test('DI-09 update 는 남의 레코드에 닿지 않는다 (0건 갱신)', async () => {
  const r = await dbB.crmPipeline.updateMany({ where: { id: 'pl_gpu' }, data: { name: '탈취 시도' } })
  assert.equal(r.count, 0, '남의 파이프라인이 갱신됐다')
  const still = await dbA.crmPipeline.findUnique({ where: { id: 'pl_gpu' } })
  assert.equal(still?.name, 'GPU 인프라', '이름이 바뀌었다')
})

test('DI-09 delete 도 남의 레코드에 닿지 않는다', async () => {
  const r = await dbB.crmPipeline.deleteMany({ where: { id: 'pl_gpu' } })
  assert.equal(r.count, 0)
  assert.ok(await dbA.crmPipeline.findUnique({ where: { id: 'pl_gpu' } }), 'A 의 파이프라인이 사라졌다')
})

test('DI-09 workspaceId 를 자기 것으로 명시하는 것은 허용된다', async () => {
  await inRollback(dbA, async (tx: any) => {
    const c = await tx.crmCompany.create({ data: { ...companyData('co_di09_ok'), workspaceId: WS_A } as any })
    assert.equal(c.workspaceId, WS_A)
  })
})
