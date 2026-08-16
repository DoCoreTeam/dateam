/**
 * Gmail 자동 캡처 — 실 DB 검증 (dacrm T1-10, DI-21)
 *
 * TASKS 완료 기준: **mock 픽스처로 DI-21 통과** + 실계정 스모크 1회(T1-09 대기).
 *
 * DI-21 은 한 줄이다 — "같은 메시지가 두 번 와도 활동은 1건".
 * 그런데 이게 깨지면 증상이 조용하다. 타임라인에 같은 메일이 두 줄 있어도
 * 사람은 "아 두 번 보냈나 보다"라고 읽는다. 그래서 코드가 지켜야 한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A } from '../integrity/_helpers.ts'
import {
  syncGmail, mockGmailAdapter, failingGmailAdapter,
} from '../../../lib/crm/integrations/gmail.ts'
import type { GmailMessage } from '../../../lib/crm/integrations/gmail.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { createPerson } from '../../../lib/crm/services/person.ts'
import { createDeal } from '../../../lib/crm/services/deal.ts'

const MARK = '메일테스트'
const ACTOR = 'mb_owner'
const CONN = 'conn_gmail_test'

function msg(id: string, participants: string[], subject = `${MARK} 제목`): GmailMessage {
  return {
    id, participants, subject,
    snippet: '본문 미리보기',
    occurredAt: '2026-08-16T01:00:00.000Z',
  }
}

async function makeDeal(name: string, companyId: string) {
  const pipeline = await dbA.crmPipeline.findFirst({ where: { isDefault: true }, select: { id: true } })
  const stage = await dbA.crmStage.findFirst({
    where: { pipelineId: pipeline!.id }, orderBy: { position: 'asc' }, select: { id: true },
  })
  return createDeal(WS_A, ACTOR, { name, companyId, pipelineId: pipeline!.id, stageId: stage!.id })
}

async function resetConnection() {
  await dbA.$executeRawUnsafe(
    `INSERT INTO crm_integration_connection
       (id, "workspaceId", "memberId", provider, scopes, "accessTokenEnc", "refreshTokenEnc", status, "gmailHistoryId", "updatedAt")
     VALUES ($1, $2, $3, 'google', 'gmail.readonly', 'enc', 'enc', 'active', NULL, now())
     ON CONFLICT (id) DO UPDATE SET status = 'active', "gmailHistoryId" = NULL`,
    CONN, WS_A, ACTOR,
  )
}

async function cleanup() {
  const cIds = (await dbA.crmCompany.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })).map((c) => c.id)
  const pIds = (await dbA.crmPerson.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })).map((p) => p.id)

  await dbA.crmActivity.deleteMany({ where: { gmailMessageId: { startsWith: 'm-test-' } } })
  await dbA.crmDealContact.deleteMany({ where: { personId: { in: pIds } } })
  await dbA.crmStageHistory.deleteMany({ where: { deal: { companyId: { in: cIds } } } })
  await dbA.crmDeal.deleteMany({ where: { companyId: { in: cIds } } })
  await dbA.crmPerson.deleteMany({ where: { id: { in: pIds } } })
  await dbA.crmCompany.deleteMany({ where: { id: { in: cIds } } })
  await dbA.crmAuditLog.deleteMany({ where: { action: { in: ['activity.captured', 'integration.errored'] } } })
}

test('시작 전 준비', async () => {
  await cleanup()
  await resetConnection()
})

// ------------------------------------------------------------
// DI-21 — 같은 메일이 두 번 와도 활동은 1건
// ------------------------------------------------------------

test('★ DI-21: 같은 메시지를 두 번 동기화해도 활동은 1건이다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, email: 'sync@mail-test.example', companyId: co.id })

  const messages = [msg('m-test-1', ['sync@mail-test.example'])]

  await resetConnection()
  const first = await syncGmail(WS_A, CONN, mockGmailAdapter(messages), 'tok')
  assert.equal(first.created, 1)
  assert.equal(first.duplicates, 0)

  // 커서를 되돌려 같은 메시지를 다시 준다 — 잡이 겹치거나 커서가 밀린 상황
  await resetConnection()
  const second = await syncGmail(WS_A, CONN, mockGmailAdapter(messages), 'tok')
  assert.equal(second.created, 0, '같은 메일로 활동이 또 생겼다')
  assert.equal(second.duplicates, 1)

  const rows = await dbA.crmActivity.findMany({ where: { gmailMessageId: 'm-test-1' } })
  assert.equal(rows.length, 1, 'DI-21 위반 — 타임라인에 같은 메일이 두 줄이다')
  await cleanup()
})

test('★ 우리 명부에 없는 사람의 메일은 저장하지 않는다 (§3.5-5)', async () => {
  await resetConnection()
  const res = await syncGmail(WS_A, CONN,
    mockGmailAdapter([msg('m-test-2', ['stranger@nowhere-test.example'])]), 'tok')

  assert.equal(res.created, 0)
  assert.equal(res.unknown, 1)
  assert.equal(await dbA.crmActivity.count({ where: { gmailMessageId: 'm-test-2' } }), 0,
    '모르는 사람의 메일을 담았다 — 이건 CRM 이 아니라 사찰이다')
  await cleanup()
})

test('이메일 대소문자가 달라도 같은 사람으로 본다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, email: 'case@mail-test.example', companyId: co.id })

  await resetConnection()
  const res = await syncGmail(WS_A, CONN,
    mockGmailAdapter([msg('m-test-3', ['CASE@Mail-Test.Example'])]), 'tok')

  assert.equal(res.created, 1, '대소문자 때문에 아는 사람을 모르는 사람으로 봤다')
  await cleanup()
})

// ------------------------------------------------------------
// 딜 연결 — 확실할 때만
// ------------------------------------------------------------

test('★ 열린 딜이 하나면 자동으로 붙인다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const person = await createPerson(WS_A, ACTOR, {
    name: `${MARK}담당자`, email: 'one@mail-test.example', companyId: co.id,
  })
  const deal = await makeDeal(`${MARK}딜`, co.id)
  await dbA.crmDealContact.create({ data: { dealId: deal.id, personId: person.id, role: 'DECISION_MAKER' } })

  await resetConnection()
  const res = await syncGmail(WS_A, CONN,
    mockGmailAdapter([msg('m-test-4', ['one@mail-test.example'])]), 'tok')

  assert.equal(res.linked, 1)
  const act = await dbA.crmActivity.findFirst({ where: { gmailMessageId: 'm-test-4' } })
  assert.equal(act!.dealId, deal.id)
  await cleanup()
})

test('★ 열린 딜이 둘이면 붙이지 않고 사람에게 넘긴다 — 틀린 딜에 붙은 메일은 지워도 기억이 남는다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const person = await createPerson(WS_A, ACTOR, {
    name: `${MARK}담당자`, email: 'two@mail-test.example', companyId: co.id,
  })
  const d1 = await makeDeal(`${MARK}딜하나`, co.id)
  const d2 = await makeDeal(`${MARK}딜둘`, co.id)
  await dbA.crmDealContact.create({ data: { dealId: d1.id, personId: person.id, role: 'OTHER' } })
  await dbA.crmDealContact.create({ data: { dealId: d2.id, personId: person.id, role: 'OTHER' } })

  await resetConnection()
  const res = await syncGmail(WS_A, CONN,
    mockGmailAdapter([msg('m-test-5', ['two@mail-test.example'])]), 'tok')

  assert.equal(res.created, 1, '애매하다고 메일까지 버리면 안 된다')
  assert.equal(res.ambiguous, 1)
  assert.equal(res.linked, 0)
  const act = await dbA.crmActivity.findFirst({ where: { gmailMessageId: 'm-test-5' } })
  assert.equal(act!.dealId, null, '어느 딜인지 모르는데 하나를 골라 붙였다')
  await cleanup()
})

test('딜이 하나도 없으면 인물·회사에만 붙는다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const person = await createPerson(WS_A, ACTOR, {
    name: `${MARK}담당자`, email: 'none@mail-test.example', companyId: co.id,
  })

  await resetConnection()
  await syncGmail(WS_A, CONN, mockGmailAdapter([msg('m-test-6', ['none@mail-test.example'])]), 'tok')

  const act = await dbA.crmActivity.findFirst({ where: { gmailMessageId: 'm-test-6' } })
  assert.equal(act!.personId, person.id)
  assert.equal(act!.companyId, co.id)
  assert.equal(act!.dealId, null)
  await cleanup()
})

// ------------------------------------------------------------
// 커서와 실패 — 조용히 사라지는 게 가장 나쁜 실패다
// ------------------------------------------------------------

test('★ 커서는 성공했을 때만 옮긴다 — 실패했는데 앞서 나가면 그 구간 메일이 영영 안 들어온다', async () => {
  await resetConnection()
  const res = await syncGmail(WS_A, CONN, failingGmailAdapter(), 'tok')

  assert.equal(res.created, 0)
  const conn = await dbA.crmIntegrationConnection.findFirst({ where: { id: CONN } })
  assert.equal(conn!.gmailHistoryId, null, '실패했는데 커서가 움직였다')
  await cleanup()
})

test('★ 토큰이 죽으면 조용히 멈추지 않고 상태를 error 로 남긴다 (§3.5-6)', async () => {
  await resetConnection()
  await syncGmail(WS_A, CONN, failingGmailAdapter('invalid_grant'), 'tok')

  const conn = await dbA.crmIntegrationConnection.findFirst({ where: { id: CONN } })
  assert.equal(conn!.status, 'error', '연결이 끊겼는데 화면이 알 방법이 없다')

  const audit = await dbA.crmAuditLog.findFirst({ where: { action: 'integration.errored' } })
  assert.ok(audit, '왜 끊겼는지 기록이 없다')
  await cleanup()
})

test('끊긴 연결은 다시 동기화하지 않는다 — 사람이 다시 연결할 때까지 기다린다', async () => {
  await resetConnection()
  await dbA.crmIntegrationConnection.updateMany({ where: { id: CONN }, data: { status: 'error' } })

  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, email: 'off@mail-test.example', companyId: co.id })

  const res = await syncGmail(WS_A, CONN, mockGmailAdapter([msg('m-test-7', ['off@mail-test.example'])]), 'tok')
  assert.equal(res.scanned, 0)
  assert.equal(res.created, 0)
  await cleanup()
})

test('성공하면 커서가 다음 위치로 옮겨진다 — 안 옮기면 매번 처음부터 다시 읽는다', async () => {
  await resetConnection()
  const res = await syncGmail(WS_A, CONN, mockGmailAdapter([], 'h-42'), 'tok')
  assert.equal(res.cursor, 'h-42')

  const conn = await dbA.crmIntegrationConnection.findFirst({ where: { id: CONN } })
  assert.equal(conn!.gmailHistoryId, 'h-42')
  await cleanup()
})

test('커서 뒤의 것만 읽는다 — 증분 동기화가 매번 전체를 훑으면 쿼터가 녹는다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  await createPerson(WS_A, ACTOR, { name: `${MARK}담당자`, email: 'inc@mail-test.example', companyId: co.id })

  const all = [
    msg('m-test-8', ['inc@mail-test.example']),
    msg('m-test-9', ['inc@mail-test.example']),
  ]
  await resetConnection()
  await dbA.crmIntegrationConnection.updateMany({ where: { id: CONN }, data: { gmailHistoryId: 'm-test-8' } })

  const res = await syncGmail(WS_A, CONN, mockGmailAdapter(all), 'tok')
  assert.equal(res.scanned, 1, '이미 읽은 구간을 다시 읽었다')
  assert.equal(res.created, 1)
  await cleanup()
})

test('없는 연결을 동기화해도 터지지 않는다', async () => {
  const res = await syncGmail(WS_A, 'conn_nope', mockGmailAdapter([]), 'tok')
  assert.equal(res.scanned, 0)
  assert.equal(res.created, 0)
})

test('끝난 뒤 잔여 없음', async () => {
  await cleanup()
  await dbA.$executeRawUnsafe(`DELETE FROM crm_integration_connection WHERE id = $1`, CONN)
  assert.equal(await dbA.crmActivity.count({ where: { gmailMessageId: { startsWith: 'm-test-' } } }), 0)
})
