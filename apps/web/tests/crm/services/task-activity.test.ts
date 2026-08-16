/**
 * 태스크·타임라인 서비스 — 실 DB 검증 (dacrm T1-04)
 *
 * 검증하는 것은 "함수가 값을 돌려주는가"가 아니라 **사용자가 겪는 일**이다:
 *   완료했는데 기록이 안 남는가 · 되돌리면 완료일이 남는가 ·
 *   오늘 적은 지난주 통화가 지난주 자리에 꽂히는가 · 아무 데도 안 붙은 기록이 사라지는가.
 *
 * 운영 DB 를 쓰므로 만든 것은 전부 끝에서 지운다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import {
  createTask, updateTask, listTasks, deleteTask, restoreTask, CLOSED_STATUSES,
} from '../../../lib/crm/services/task.ts'
import {
  createActivity, listActivities, deleteActivity, MANUAL_TYPES,
} from '../../../lib/crm/services/activity.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MADE: { companies: string[]; tasks: string[]; activities: string[] } = {
  companies: [], tasks: [], activities: [],
}

async function cleanup() {
  const ids = [...MADE.companies, ...MADE.tasks, ...MADE.activities]
  if (ids.length) await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: ids } } })
  if (MADE.activities.length) {
    await dbA.crmActivity.deleteMany({ where: { id: { in: MADE.activities } } })
  }
  if (MADE.tasks.length) await dbA.crmTask.deleteMany({ where: { id: { in: MADE.tasks } } })
  if (MADE.companies.length) {
    // 태스크 완료가 만든 활동까지 함께 치운다(id 를 우리가 모른다)
    await dbA.crmActivity.deleteMany({ where: { companyId: { in: MADE.companies } } })
    await dbA.crmCompany.deleteMany({ where: { id: { in: MADE.companies } } })
  }
  MADE.companies = []
  MADE.tasks = []
  MADE.activities = []
}

async function newCompany(name: string) {
  const c = await createCompany(WS_A, 'mb_owner', { name })
  MADE.companies.push(c.id)
  return c
}

async function newTask(companyId: string, title: string, dueAt?: string) {
  const t = await createTask(WS_A, 'mb_owner', { title, companyId, dueAt })
  MADE.tasks.push(t.id)
  return t
}

// ------------------------------------------------------------
// 태스크 — 완료는 사실이고, 사실은 기록으로 남는다
// ------------------------------------------------------------

test('할 일을 만들면 기본 상태는 TODO 이고 완료일은 없다', async () => {
  const co = await newCompany('태스크검증 A')
  const t = await newTask(co.id, '견적서 보내기')
  assert.equal(t.status, 'TODO')
  assert.equal(t.completedAt, null)
  await cleanup()
})

test('제목이 비면 사람 말로 거절한다', async () => {
  const co = await newCompany('태스크검증 B')
  const e = await catchError(() => createTask(WS_A, 'mb_owner', { title: '   ', companyId: co.id }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
  assert.match((e as CrmError).message, /제목/)
  await cleanup()
})

test('★ 완료하면 타임라인에 활동이 하나 남는다 (T1-04 완료 기준)', async () => {
  const co = await newCompany('태스크검증 C')
  const t = await newTask(co.id, '계약서 검토')

  const before = await listActivities(dbA, { companyId: co.id })
  assert.equal(before.items.length, 0)

  const done = await updateTask(WS_A, 'mb_owner', t.id, { status: 'DONE' })
  assert.equal(done.status, 'DONE')
  assert.ok(done.completedAt, '완료 시각이 찍혀야 한다')

  const after = await listActivities(dbA, { companyId: co.id })
  assert.equal(after.items.length, 1, '완료했는데 타임라인에 아무 일도 없다')
  assert.equal(after.items[0].type, 'SYSTEM')
  assert.match(after.items[0].title, /계약서 검토/)
  await cleanup()
})

test('완료를 되돌리면 완료일도 지워진다 — 완료 안 했는데 완료일이 남으면 거짓이다', async () => {
  const co = await newCompany('태스크검증 D')
  const t = await newTask(co.id, '샘플 발송')
  await updateTask(WS_A, 'mb_owner', t.id, { status: 'DONE' })
  const back = await updateTask(WS_A, 'mb_owner', t.id, { status: 'TODO' })
  assert.equal(back.status, 'TODO')
  assert.equal(back.completedAt, null)
  await cleanup()
})

test('이미 완료된 것을 또 완료해도 활동이 두 번 쌓이지 않는다', async () => {
  const co = await newCompany('태스크검증 E')
  const t = await newTask(co.id, '중복 완료')
  await updateTask(WS_A, 'mb_owner', t.id, { status: 'DONE' })
  await updateTask(WS_A, 'mb_owner', t.id, { status: 'DONE' })
  const acts = await listActivities(dbA, { companyId: co.id })
  assert.equal(acts.items.length, 1)
  await cleanup()
})

test('scope=open 은 끝난 것을 빼고 준다 — "다음에 할 일"이 그 목록이다', async () => {
  const co = await newCompany('태스크검증 F')
  const a = await newTask(co.id, '열린 것')
  const b = await newTask(co.id, '끝난 것')
  await updateTask(WS_A, 'mb_owner', b.id, { status: 'DONE' })

  const open = await listTasks(dbA, { companyId: co.id, scope: 'open' })
  assert.deepEqual(open.items.map((t) => t.id), [a.id])

  const all = await listTasks(dbA, { companyId: co.id, scope: 'all' })
  assert.equal(all.items.length, 2)
  await cleanup()
})

test('CLOSED_STATUSES 가 끝난 상태의 유일한 정의다', () => {
  assert.ok(CLOSED_STATUSES.has('DONE'))
  assert.ok(CLOSED_STATUSES.has('CANCELED'))
  assert.ok(!CLOSED_STATUSES.has('TODO'))
  assert.ok(!CLOSED_STATUSES.has('DOING'))
})

test('알 수 없는 상태는 조용히 통과하지 않는다', async () => {
  const co = await newCompany('태스크검증 G')
  const t = await newTask(co.id, '상태 검증')
  const e = await catchError(() => updateTask(WS_A, 'mb_owner', t.id, { status: 'FINISHED' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
  await cleanup()
})

test('휴지통으로 보내면 목록에서 사라지고 되살리면 돌아온다', async () => {
  const co = await newCompany('태스크검증 H')
  const t = await newTask(co.id, '되살릴 것')

  await deleteTask(WS_A, 'mb_owner', t.id, 'trash')
  assert.equal((await listTasks(dbA, { companyId: co.id })).items.length, 0)
  assert.equal((await listTasks(dbA, { companyId: co.id, trash: true })).items.length, 1)

  await restoreTask(WS_A, 'mb_owner', t.id)
  assert.equal((await listTasks(dbA, { companyId: co.id })).items.length, 1)
  await cleanup()
})

// ------------------------------------------------------------
// 타임라인 — 일어난 시각이 자리를 정한다
// ------------------------------------------------------------

test('★ 오늘 적은 지난주 통화는 지난주 자리에 꽂힌다 (occurredAt 정렬)', async () => {
  const co = await newCompany('활동검증 A')
  const recent = await createActivity(WS_A, 'mb_owner', {
    companyId: co.id, type: 'NOTE', title: '어제 메모', occurredAt: '2026-08-15T02:00:00.000Z',
  })
  const old = await createActivity(WS_A, 'mb_owner', {
    companyId: co.id, type: 'CALL', title: '지난주 통화', occurredAt: '2026-08-08T02:00:00.000Z',
  })
  MADE.activities.push(recent.id, old.id)

  const page = await listActivities(dbA, { companyId: co.id })
  assert.deepEqual(page.items.map((a) => a.title), ['어제 메모', '지난주 통화'],
    '만든 순서가 아니라 일어난 순서로 나와야 한다')
  await cleanup()
})

test('아무 데도 안 붙은 기록은 만들 수 없다 — 어느 타임라인에도 안 나타난다', async () => {
  const e = await catchError(() => createActivity(WS_A, 'mb_owner', { title: '떠도는 메모' }))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, /회사·인물·딜/)
})

test('사람이 EMAIL·SYSTEM 을 직접 만들 수 없다 — 연동이 만든 사실과 섞이면 안 된다', async () => {
  const co = await newCompany('활동검증 B')
  for (const type of ['EMAIL', 'SYSTEM']) {
    const e = await catchError(() => createActivity(WS_A, 'mb_owner', {
      companyId: co.id, type, title: '가짜 사실',
    }))
    assert.ok(e instanceof CrmError, `${type} 이 통과했다`)
  }
  assert.deepEqual([...MANUAL_TYPES].sort(), ['CALL', 'MEETING', 'NOTE'])
  await cleanup()
})

test('타입 필터가 그 종류만 준다', async () => {
  const co = await newCompany('활동검증 C')
  const n = await createActivity(WS_A, 'mb_owner', { companyId: co.id, type: 'NOTE', title: '메모' })
  const c = await createActivity(WS_A, 'mb_owner', { companyId: co.id, type: 'CALL', title: '통화' })
  MADE.activities.push(n.id, c.id)

  const only = await listActivities(dbA, { companyId: co.id, types: 'CALL' })
  assert.deepEqual(only.items.map((a) => a.title), ['통화'])

  const both = await listActivities(dbA, { companyId: co.id, types: 'CALL,NOTE' })
  assert.equal(both.items.length, 2)
  await cleanup()
})

test('알 수 없는 종류로 거르려 하면 거절한다 (조용히 빈 목록을 주지 않는다)', async () => {
  const e = await catchError(() => listActivities(dbA, { types: 'PHONECALL' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
})

test('시스템이 남긴 기록은 사람이 지울 수 없다', async () => {
  const co = await newCompany('활동검증 D')
  const t = await newTask(co.id, '완료가 만드는 기록')
  await updateTask(WS_A, 'mb_owner', t.id, { status: 'DONE' })

  const page = await listActivities(dbA, { companyId: co.id })
  const sys = page.items[0]
  assert.equal(sys.type, 'SYSTEM')

  const e = await catchError(() => deleteActivity(WS_A, 'mb_owner', sys.id, 'trash'))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, /사람이 남긴/)
  await cleanup()
})

test('사람이 남긴 기록은 휴지통으로 보낼 수 있고 목록에서 사라진다', async () => {
  const co = await newCompany('활동검증 E')
  const a = await createActivity(WS_A, 'mb_owner', { companyId: co.id, type: 'NOTE', title: '오기' })
  MADE.activities.push(a.id)

  await deleteActivity(WS_A, 'mb_owner', a.id, 'trash')
  const page = await listActivities(dbA, { companyId: co.id })
  assert.equal(page.items.length, 0)
  await cleanup()
})

test('더 보기는 이전 것만 준다 — 같은 항목이 두 번 나오지 않는다', async () => {
  const co = await newCompany('활동검증 F')
  for (let i = 0; i < 3; i += 1) {
    const a = await createActivity(WS_A, 'mb_owner', {
      companyId: co.id, type: 'NOTE', title: `기록 ${i}`,
      occurredAt: `2026-08-1${i + 1}T02:00:00.000Z`,
    })
    MADE.activities.push(a.id)
  }
  const first = await listActivities(dbA, { companyId: co.id, limit: 2 })
  assert.equal(first.items.length, 2)
  assert.ok(first.nextBefore)

  const next = await listActivities(dbA, { companyId: co.id, limit: 2, before: first.nextBefore })
  const ids = new Set([...first.items, ...next.items].map((a) => a.id))
  assert.equal(ids.size, 3, '페이지 사이에 중복이 있다')
  assert.equal(next.nextBefore, null)
  await cleanup()
})

test('기준 시각이 쓰레기면 빈 목록이 아니라 거절이다', async () => {
  const e = await catchError(() => listActivities(dbA, { before: '어제쯤' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
})
