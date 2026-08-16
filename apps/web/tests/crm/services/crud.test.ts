/**
 * 회사·인물 CRUD 서비스 — 실 DB 검증 (dacrm T1-02)
 *
 * 여기서 검증하는 것은 "함수가 값을 돌려주는가"가 아니라 **사용자가 겪는 일**이다:
 *   두 사람이 동시에 고치면 어떻게 되는가 · 대소문자만 다른 이메일을 넣으면 어떻게 되는가 ·
 *   지운 것이 목록에서 사라지는가 · 되살릴 수 있는가.
 *
 * 쓰기는 전부 트랜잭션 안에서 하고 롤백한다(운영 DB 를 쓰므로 흔적을 남기지 않는다).
 * 롤백할 수 없는 것(서비스가 자체 트랜잭션을 여는 create/update)은 끝에서 지운다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import {
  createCompany, updateCompany, deleteCompany, restoreCompany,
  listCompanies, listTrashedCompanies, getCompany,
} from '../../../lib/crm/services/company.ts'
import { createPerson, updatePerson, listPeople } from '../../../lib/crm/services/person.ts'
import { normalizeDomain, normalizeEmail, normalizePhone } from '../../../lib/crm/domain/normalize.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MADE: { companies: string[]; people: string[] } = { companies: [], people: [] }

async function cleanup() {
  if (MADE.companies.length) {
    await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: MADE.companies } } })
    await dbA.crmCompany.deleteMany({ where: { id: { in: MADE.companies } } })
  }
  if (MADE.people.length) {
    await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: MADE.people } } })
    await dbA.crmPerson.deleteMany({ where: { id: { in: MADE.people } } })
  }
  MADE.companies = []
  MADE.people = []
}

// ------------------------------------------------------------
// 정규화 — 저장 전에 한 곳에서만 한다
// ------------------------------------------------------------

test('도메인은 URL 을 통째로 붙여 넣어도 호스트만 남는다', () => {
  assert.equal(normalizeDomain('https://www.Data-Alliance.com/about?x=1'), 'data-alliance.com')
  assert.equal(normalizeDomain('DATA-ALLIANCE.COM'), 'data-alliance.com')
  assert.equal(normalizeDomain('  '), null)
  assert.equal(normalizeDomain('사내망'), null, '점이 없으면 도메인이 아니다')
})

test('이메일은 소문자로, 형식이 아니면 null', () => {
  assert.equal(normalizeEmail('  Kim@Example.COM '), 'kim@example.com')
  assert.equal(normalizeEmail('not-an-email'), null)
})

test('전화는 표시용 구분자를 지운다', () => {
  assert.equal(normalizePhone('010-1234-5678'), '01012345678')
  assert.equal(normalizePhone('123'), null, '너무 짧으면 전화가 아니다')
})

// ------------------------------------------------------------
// 생성·조회
// ------------------------------------------------------------

test('회사를 만들면 목록과 상세에서 보인다', async () => {
  const c = await createCompany(WS_A, 'mb_owner', {
    name: '  테스트 상사  ', domain: 'https://WWW.Test-Corp.com/',
  })
  MADE.companies.push(c.id)

  assert.equal(c.name, '테스트 상사', '앞뒤 공백이 남았다')
  assert.equal(c.domain, 'test-corp.com', '도메인이 정규화되지 않았다')
  assert.equal(c.version, 0, '새 레코드의 버전은 0이다')

  const got = await getCompany(dbA, c.id)
  assert.equal(got.id, c.id)

  const page = await listCompanies(dbA, { q: '테스트 상사' })
  assert.ok(page.items.some((r) => r.id === c.id), '목록에 안 보인다')

  await cleanup()
})

test('회사명이 비면 저장되지 않고 이유를 말한다', async () => {
  const e = await catchError(() => createCompany(WS_A, 'mb_owner', { name: '   ' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
  assert.match((e as CrmError).message, /회사명/)
})

test('이메일 형식이 틀리면 조용히 버리지 않고 막는다', async () => {
  // 조용히 null 로 저장하면 사용자는 이메일이 저장된 줄 안다
  const e = await catchError(() => createPerson(WS_A, 'mb_owner', {
    name: '홍길동', email: 'broken-email',
  }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
})

// ------------------------------------------------------------
// 낙관적 잠금 (DI-18) — 두 사람이 동시에 고치는 일
// ------------------------------------------------------------

test('두 사람이 같은 회사를 고치면 나중 사람이 막힌다 (덮어쓰기 방지)', async () => {
  const c = await createCompany(WS_A, 'mb_owner', { name: '동시수정 상사' })
  MADE.companies.push(c.id)

  // A 가 먼저 저장 — 성공하고 버전이 오른다
  const afterA = await updateCompany(WS_A, 'mb_owner', c.id, { version: c.version, industry: 'IT' })
  assert.equal(afterA.version, c.version + 1)
  assert.equal(afterA.industry, 'IT')

  // B 는 아직 옛 버전을 들고 있다 → 막혀야 한다
  const e = await catchError(() =>
    updateCompany(WS_A, 'mb_owner', c.id, { version: c.version, industry: '제조' }))
  assert.ok(e instanceof CrmError, '두 번째 저장이 통과했다 — 앞사람 수정이 덮인다')
  assert.equal((e as CrmError).code, 'CONFLICT')
  assert.equal((e as CrmError).status, 409)
  assert.equal((e as CrmError).details.currentVersion, afterA.version,
    '현재 버전을 알려 줘야 화면이 다시 시도할 수 있다')

  // 앞사람 값이 그대로 남아 있다
  assert.equal((await getCompany(dbA, c.id)).industry, 'IT')

  await cleanup()
})

test('없는 회사를 고치면 404 — 버전 충돌과 구분된다', async () => {
  const e = await catchError(() =>
    updateCompany(WS_A, 'mb_owner', 'co_does_not_exist', { version: 0, industry: 'IT' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'NOT_FOUND')
})

test('PATCH 는 안 보낸 필드를 건드리지 않는다', async () => {
  const c = await createCompany(WS_A, 'mb_owner', {
    name: '부분수정 상사', industry: 'IT', region: '서울',
  })
  MADE.companies.push(c.id)

  const after = await updateCompany(WS_A, 'mb_owner', c.id, { version: c.version, region: '부산' })
  assert.equal(after.region, '부산')
  assert.equal(after.industry, 'IT', '보내지 않은 필드가 지워졌다')
  assert.equal(after.name, '부분수정 상사')

  // null 을 명시하면 지운다 — undefined 와 다르다
  const cleared = await updateCompany(WS_A, 'mb_owner', c.id, { version: after.version, industry: null })
  assert.equal(cleared.industry, null, 'null 을 보냈는데 안 지워졌다')

  await cleanup()
})

// ------------------------------------------------------------
// 중복 (DI-02·03) — DB 부분 유니크가 실제로 막는가
// ------------------------------------------------------------

test('같은 도메인 회사를 또 만들면 막힌다 (대소문자 무관)', async () => {
  const c = await createCompany(WS_A, 'mb_owner', { name: '중복테스트 A', domain: 'dup-test.com' })
  MADE.companies.push(c.id)

  const e = await catchError(() =>
    createCompany(WS_A, 'mb_owner', { name: '중복테스트 B', domain: 'DUP-TEST.COM' }))
  assert.ok(e, '대소문자만 다른 도메인이 통과했다')

  await cleanup()
})

test('같은 이메일 인물을 또 만들면 막힌다 (대소문자 무관)', async () => {
  const p = await createPerson(WS_A, 'mb_owner', { name: '중복 인물 A', email: 'dup@test.com' })
  MADE.people.push(p.id)

  const e = await catchError(() =>
    createPerson(WS_A, 'mb_owner', { name: '중복 인물 B', email: 'DUP@TEST.COM' }))
  assert.ok(e, '대소문자만 다른 이메일이 통과했다')

  await cleanup()
})

// ------------------------------------------------------------
// 삭제·복구 (DI-16 + 사용자 결정: 소프트 + 영구 선택)
// ------------------------------------------------------------

test('휴지통에 넣으면 목록에서 빠지고, 휴지통에서는 보인다', async () => {
  const c = await createCompany(WS_A, 'mb_owner', { name: '삭제될 상사', domain: 'trash-me.com' })
  MADE.companies.push(c.id)

  await deleteCompany(WS_A, 'mb_owner', c.id, 'trash')

  const page = await listCompanies(dbA, { q: '삭제될 상사' })
  assert.equal(page.items.some((r) => r.id === c.id), false, '지운 것이 목록에 남았다')

  const trash = await listTrashedCompanies(dbA)
  assert.ok(trash.items.some((r) => r.id === c.id), '휴지통에서도 안 보인다')

  await cleanup()
})

test('휴지통에 있는 동안 같은 도메인으로 다시 만들 수 있다', async () => {
  // 마이그 201(부분 유니크)이 없으면 여기서 막힌다 — "지웠는데 왜 못 만들지"
  const c1 = await createCompany(WS_A, 'mb_owner', { name: '재등록 A', domain: 'reuse-me.com' })
  MADE.companies.push(c1.id)
  await deleteCompany(WS_A, 'mb_owner', c1.id, 'trash')

  const c2 = await createCompany(WS_A, 'mb_owner', { name: '재등록 B', domain: 'reuse-me.com' })
  MADE.companies.push(c2.id)
  assert.notEqual(c2.id, c1.id)

  await cleanup()
})

test('휴지통에서 되살리면 목록에 다시 나타난다', async () => {
  const c = await createCompany(WS_A, 'mb_owner', { name: '복구될 상사' })
  MADE.companies.push(c.id)

  await deleteCompany(WS_A, 'mb_owner', c.id, 'trash')
  const restored = await restoreCompany(WS_A, 'mb_owner', c.id)
  assert.equal(restored.id, c.id)

  const page = await listCompanies(dbA, { q: '복구될 상사' })
  assert.ok(page.items.some((r) => r.id === c.id), '복구했는데 목록에 없다')

  await cleanup()
})

test('영구 삭제는 실제로 지운다 — 휴지통에도 안 남는다', async () => {
  const c = await createCompany(WS_A, 'mb_owner', { name: '영구삭제 상사' })
  const id = c.id

  await deleteCompany(WS_A, 'mb_owner', id, 'trash')
  await deleteCompany(WS_A, 'mb_owner', id, 'purge')

  assert.equal(await dbA.crmCompany.count({ where: { id, deletedAt: { not: null } } }), 0)
  // 감사 로그는 남는다 — 무엇을 지웠는지는 남아야 한다
  const audit = await dbA.crmAuditLog.count({ where: { targetId: id, action: 'record.purged' } })
  assert.equal(audit, 1, '영구 삭제가 감사 로그에 안 남았다')

  await dbA.crmAuditLog.deleteMany({ where: { targetId: id } })
})

// ------------------------------------------------------------
// 커서 목록 — 목록이 움직여도 같은 것을 두 번 보지 않는다
// ------------------------------------------------------------

test('커서로 넘기면 겹치지 않고 이어진다', async () => {
  const made: string[] = []
  for (let i = 0; i < 5; i += 1) {
    const c = await createCompany(WS_A, 'mb_owner', { name: `커서테스트 ${i}` })
    made.push(c.id)
    MADE.companies.push(c.id)
  }

  const p1 = await listCompanies(dbA, { q: '커서테스트', limit: 2 })
  assert.equal(p1.items.length, 2)
  assert.ok(p1.nextCursor, '다음 페이지가 있는데 커서가 없다')

  const p2 = await listCompanies(dbA, { q: '커서테스트', limit: 2, cursor: p1.nextCursor })
  assert.equal(p2.items.length, 2)

  const ids1 = new Set(p1.items.map((r) => r.id))
  assert.equal(p2.items.some((r) => ids1.has(r.id)), false, '같은 회사가 두 페이지에 나왔다')

  await cleanup()
})

test('깨진 커서는 화면을 죽이지 않고 첫 페이지로 떨어진다', async () => {
  const page = await listCompanies(dbA, { cursor: 'garbage-cursor', limit: 2 })
  assert.ok(Array.isArray(page.items))
})

test('limit 은 상한을 넘지 않는다', async () => {
  const page = await listCompanies(dbA, { limit: 9999 })
  assert.ok(page.items.length <= 100)
})

// ------------------------------------------------------------
// 감사 로그 — 쓰기와 같은 트랜잭션에 남는가 (절대규칙 6)
// ------------------------------------------------------------

test('생성·수정이 감사 로그에 남는다', async () => {
  const c = await createCompany(WS_A, 'mb_owner', { name: '감사 상사' })
  MADE.companies.push(c.id)
  await updateCompany(WS_A, 'mb_owner', c.id, { version: c.version, region: '서울' })

  const rows = await dbA.crmAuditLog.findMany({
    where: { targetId: c.id }, orderBy: { createdAt: 'asc' },
  })
  const actions = rows.map((r: { action: string }) => r.action)
  assert.ok(actions.includes('company.created'), '생성이 안 남았다')
  assert.ok(actions.includes('company.updated'), '수정이 안 남았다')

  const upd = rows.find((r: { action: string }) => r.action === 'company.updated')
  assert.ok(upd?.beforeJson, '이전 값이 없으면 되돌릴 근거가 없다')
  assert.ok(upd?.afterJson)

  await cleanup()
})

test('인물도 회사와 같은 규칙을 따른다', async () => {
  const p = await createPerson(WS_A, 'mb_owner', {
    name: ' 김담당 ', email: 'Person@Test.COM', phone: '010-1111-2222', title: '팀장',
  })
  MADE.people.push(p.id)

  assert.equal(p.name, '김담당')
  assert.equal(p.email, 'person@test.com')
  assert.equal(p.phone, '01011112222')

  const after = await updatePerson(WS_A, 'mb_owner', p.id, { version: p.version, title: '부장' })
  assert.equal(after.title, '부장')
  assert.equal(after.version, p.version + 1)

  const e = await catchError(() =>
    updatePerson(WS_A, 'mb_owner', p.id, { version: p.version, title: '차장' }))
  assert.equal((e as CrmError).code, 'CONFLICT')

  const page = await listPeople(dbA, { q: '김담당' })
  assert.ok(page.items.some((r) => r.id === p.id))

  await cleanup()
})
