/**
 * 딜 참석자 — 실 DB 검증 (dacrm 정정판)
 *
 * `CrmDealContact` 는 스키마에 처음부터 있었는데 **화면이 한 번도 안 썼다.**
 * 딜 상세의 "연결" 칸은 이 관계가 아니라 회사의 인물 전체를 보여 주고 있었다.
 *
 * 그래서 이 테스트가 지키는 것은 하나다 —
 * **"이 딜의 사람"과 "그 회사의 사람"은 다르다.**
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import {
  listDealContacts, addDealContact, removeDealContact, ROLE_LABEL, DEAL_CONTACT_ROLES,
} from '../../../lib/crm/services/deal-contact.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { createPerson } from '../../../lib/crm/services/person.ts'
import { createDeal } from '../../../lib/crm/services/deal.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MARK = '참석자테스트'
const ACTOR = 'mb_owner'

async function makeDeal(name: string, companyId: string) {
  const pipeline = await dbA.crmPipeline.findFirst({ where: { isDefault: true }, select: { id: true } })
  const stage = await dbA.crmStage.findFirst({
    where: { pipelineId: pipeline!.id, kind: 'OPEN' }, orderBy: { position: 'asc' }, select: { id: true },
  })
  return createDeal(WS_A, ACTOR, { name, companyId, pipelineId: pipeline!.id, stageId: stage!.id })
}

async function cleanup() {
  const cIds = (await dbA.crmCompany.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })).map((c) => c.id)
  const pIds = (await dbA.crmPerson.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })).map((p) => p.id)
  await dbA.crmDealContact.deleteMany({ where: { personId: { in: pIds } } })
  await dbA.crmStageHistory.deleteMany({ where: { deal: { companyId: { in: cIds } } } })
  await dbA.crmDeal.deleteMany({ where: { companyId: { in: cIds } } })
  await dbA.crmPerson.deleteMany({ where: { id: { in: pIds } } })
  await dbA.crmCompany.deleteMany({ where: { id: { in: cIds } } })
  await dbA.crmAuditLog.deleteMany({ where: { action: { startsWith: 'deal.contact' } } })
}

test('시작 전 잔여 정리', async () => { await cleanup() })

test('★ 딜의 사람은 회사의 사람 전부가 아니다 — 그게 이 기능의 전부다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const inDeal = await createPerson(WS_A, ACTOR, { name: `${MARK}관여자`, companyId: co.id })
  await createPerson(WS_A, ACTOR, { name: `${MARK}무관자`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)

  await addDealContact(WS_A, ACTOR, deal.id, inDeal.id, 'DECISION_MAKER')

  const rows = await listDealContacts(dbA, deal.id)
  assert.equal(rows.length, 1, '회사 인물을 다 끌어왔다 — 그러면 "누구를 설득하나"에 답을 못 한다')
  assert.equal(rows[0].personId, inDeal.id)
  assert.equal(rows[0].role, 'DECISION_MAKER')
  await cleanup()
})

test('★ 결정권자가 맨 위로 온다 — 딜을 열면 가장 먼저 알아야 하는 사람이다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const deal = await makeDeal(`${MARK}딜`, co.id)
  const other = await createPerson(WS_A, ACTOR, { name: `${MARK}관련자`, companyId: co.id })
  const boss = await createPerson(WS_A, ACTOR, { name: `${MARK}결정권자`, companyId: co.id })

  await addDealContact(WS_A, ACTOR, deal.id, other.id, 'OTHER')
  await addDealContact(WS_A, ACTOR, deal.id, boss.id, 'DECISION_MAKER')

  const rows = await listDealContacts(dbA, deal.id)
  assert.equal(rows[0].personId, boss.id, '관련자가 결정권자보다 위에 있다')
  await cleanup()
})

test('같은 사람을 다시 넣으면 역할만 바뀐다 — 막으면 역할을 고칠 길이 없다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const p = await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)

  await addDealContact(WS_A, ACTOR, deal.id, p.id, 'PRACTITIONER')
  await addDealContact(WS_A, ACTOR, deal.id, p.id, 'BLOCKER')

  const rows = await listDealContacts(dbA, deal.id)
  assert.equal(rows.length, 1, '같은 사람이 두 줄로 들어갔다')
  assert.equal(rows[0].role, 'BLOCKER', '역할이 안 바뀌었다')
  await cleanup()
})

test('★ 반대하는 사람도 적을 수 있다 — 딜이 막히는 진짜 이유가 거기 있다', () => {
  assert.ok(DEAL_CONTACT_ROLES.includes('BLOCKER'))
  assert.equal(ROLE_LABEL.BLOCKER, '반대')
  assert.equal(ROLE_LABEL.CHAMPION, '우리 편')
})

test('없는 딜·없는 사람은 넣을 수 없다 — FK 가 없는 관계라 코드가 막아야 한다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const p = await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)

  const e1 = await catchError(() => addDealContact(WS_A, ACTOR, 'no_such_deal', p.id, 'OTHER'))
  assert.ok(e1 instanceof CrmError)
  assert.equal((e1 as CrmError).code, 'NOT_FOUND')

  const e2 = await catchError(() => addDealContact(WS_A, ACTOR, deal.id, 'no_such_person', 'OTHER'))
  assert.ok(e2 instanceof CrmError)
  assert.equal((e2 as CrmError).code, 'NOT_FOUND')
  await cleanup()
})

test('모르는 역할은 거절한다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const p = await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = await catchError(() => addDealContact(WS_A, ACTOR, deal.id, p.id, 'BOSS' as any))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
  await cleanup()
})

test('빼기는 그 사람만 뺀다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const a = await createPerson(WS_A, ACTOR, { name: `${MARK}가`, companyId: co.id })
  const b = await createPerson(WS_A, ACTOR, { name: `${MARK}나`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)

  await addDealContact(WS_A, ACTOR, deal.id, a.id, 'CHAMPION')
  await addDealContact(WS_A, ACTOR, deal.id, b.id, 'OTHER')
  await removeDealContact(WS_A, ACTOR, deal.id, a.id)

  const rows = await listDealContacts(dbA, deal.id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].personId, b.id)
  await cleanup()
})

test('안 넣은 사람을 빼려 하면 그 사실을 말한다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const deal = await makeDeal(`${MARK}딜`, co.id)
  const e = await catchError(() => removeDealContact(WS_A, ACTOR, deal.id, 'nobody'))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'NOT_FOUND')
  await cleanup()
})

test('사람이 지워지면 그 줄은 목록에서 빠진다 — id 만 남은 줄은 화면에서 유령이 된다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const p = await createPerson(WS_A, ACTOR, { name: `${MARK}사라질사람`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)
  await addDealContact(WS_A, ACTOR, deal.id, p.id, 'OTHER')

  await dbA.crmPerson.updateMany({ where: { id: p.id }, data: { deletedAt: new Date() } })

  const rows = await listDealContacts(dbA, deal.id)
  assert.equal(rows.length, 0, '지워진 사람이 목록에 유령으로 남았다')
  await cleanup()
})

test('참석자 변경이 감사에 남는다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const p = await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)
  await addDealContact(WS_A, ACTOR, deal.id, p.id, 'CHAMPION')

  const audit = await dbA.crmAuditLog.findFirst({ where: { action: 'deal.contact_added', targetId: deal.id } })
  assert.ok(audit, '누가 언제 넣었는지 기록이 없다')
  await cleanup()
})

test('끝난 뒤 잔여 없음', async () => {
  await cleanup()
  assert.equal(await dbA.crmCompany.count({ where: { name: { contains: MARK }, deletedAt: undefined } }), 0)
})
