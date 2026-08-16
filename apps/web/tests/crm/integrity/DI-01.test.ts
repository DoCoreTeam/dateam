/**
 * DI-01 격리 — 타 워크스페이스 레코드는 조회되지 않고, 존재 여부도 노출하지 않는다
 * 근거: 통합기획서 v0.2.1 936행 "타 워크스페이스 레코드 ID로 조회, 수정, 삭제 시도 | 404, 데이터 무변경 (전 객체 반복)"
 *       구현명세서 7장 "NOT_FOUND 404 | 타 워크스페이스 접근 포함(존재 여부 노출 금지)"
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, dbB, WS_A, inRollback, companyData, catchError } from './_helpers.ts'

test('DI-01 A 가 만든 회사는 B 에게 목록에서 보이지 않는다', async () => {
  await inRollback(dbA, async (tx: any) => {
    await tx.crmCompany.create({ data: companyData('co_di01', { domain: 'di01.example.com' }) })
    const seenByA = await tx.crmCompany.findMany({ where: { id: 'co_di01' } })
    assert.equal(seenByA.length, 1, 'A 는 자기 것을 봐야 한다')
  })

  // 커밋되지 않았으므로 A 에게도 남아 있지 않아야 한다(테스트가 흔적을 남기지 않는지 확인)
  assert.equal(await dbA.crmCompany.count({ where: { id: 'co_di01' } }), 0)
})

test('DI-01 남의 레코드를 id 로 단건 조회하면 null 이다 (예외가 아니라 "없음")', async () => {
  // 라우트가 실제로 하는 모양: where 에 id 만 주고 workspaceId 는 가드가 넣는다.
  // pl_gpu 는 A 에 실제로 존재하지만 B 에게는 없는 것처럼 보여야 한다(존재 여부 노출 금지).
  assert.ok(await dbA.crmPipeline.findUnique({ where: { id: 'pl_gpu' } }), 'A 에는 있어야 한다')
  assert.equal(await dbB.crmPipeline.findUnique({ where: { id: 'pl_gpu' } }), null, '존재 여부가 노출됐다')
})

test('DI-01 호출부가 남의 workspaceId 를 직접 적으면 그건 버그다 — 조용히 빈 결과를 주지 않고 던진다', async () => {
  // "없음"과 "네가 잘못 짰다"는 다른 사건이다. 전자는 404, 후자는 코드를 고쳐야 한다.
  const e = await catchError(() => dbB.crmCompany.findMany({ where: { workspaceId: WS_A } }))
  assert.ok(e, '남의 workspaceId 를 명시했는데 통과했다')
  assert.equal((e as any).code, 'WORKSPACE_MISMATCH')
  assert.equal((e as any).message.includes(WS_A), false, '오류 문장에 남의 워크스페이스 id 가 노출됐다')
})

test('DI-01 A 의 파이프라인 개수는 B 에게 0 이다', async () => {
  assert.ok((await dbA.crmPipeline.count()) > 0)
  assert.equal(await dbB.crmPipeline.count(), 0)
})

test('DI-01 집계(count)에도 격리가 걸린다', async () => {
  assert.ok((await dbA.crmMember.count()) > 0, 'A 는 멤버가 있다')
  assert.equal(await dbB.crmMember.count(), 0, 'B 에게는 A 의 멤버가 세어지면 안 된다')
})

// ------------------------------------------------------------
// 원본 정의는 조회뿐 아니라 **수정·삭제 시도**까지 포함한다 — 데이터 무변경
// ------------------------------------------------------------

test('DI-01 남의 레코드는 수정되지 않는다 (0건 갱신, 원본 무변경)', async () => {
  const r = await dbB.crmPipeline.updateMany({ where: { id: 'pl_gpu' }, data: { name: '탈취 시도' } })
  assert.equal(r.count, 0, '남의 파이프라인이 갱신됐다')
  const still = await dbA.crmPipeline.findUnique({ where: { id: 'pl_gpu' } })
  assert.equal(still?.name, 'GPU 인프라', '이름이 바뀌었다')
})

test('DI-01 남의 레코드는 삭제되지 않는다', async () => {
  const r = await dbB.crmPipeline.deleteMany({ where: { id: 'pl_gpu' } })
  assert.equal(r.count, 0)
  assert.ok(await dbA.crmPipeline.findUnique({ where: { id: 'pl_gpu' } }), 'A 의 파이프라인이 사라졌다')
})

test('DI-01 create 에 남의 workspaceId 를 심으면 앱 가드가 막는다', async () => {
  const e = await catchError(() =>
    dbA.crmCompany.create({ data: { ...companyData('co_di01_steal'), workspaceId: 'ws_somewhere_else' } as any }))
  assert.ok(e, '남의 워크스페이스로 생성됐다')
  assert.equal((e as any).code, 'WORKSPACE_MISMATCH')
})

test('DI-01 내 workspaceId 를 명시하는 것은 허용된다 (과차단 금지)', async () => {
  await inRollback(dbA, async (tx: any) => {
    const c = await tx.crmCompany.create({ data: { ...companyData('co_di01_ok'), workspaceId: WS_A } as any })
    assert.equal(c.workspaceId, WS_A)
  })
})
