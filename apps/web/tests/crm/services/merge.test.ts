/**
 * 병합 — 실 DB 검증 (dacrm T1-11, DI-10·11)
 *
 * TASKS 완료 기준: **참조 전부 재연결 + 30일 내 취소로 원상 복구.**
 *
 * 병합은 되돌릴 수 없다고 느껴지면 아무도 안 누른다. 그래서 여기서 증명해야 하는 건
 * "합쳐진다"가 아니라 **"합쳐도 아무것도 안 사라진다"**이다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import {
  mergeRecords, undoMerge, scanDuplicates, saveDuplicates, listDuplicates,
  dismissDuplicate, MERGE_UNDO_DAYS,
} from '../../../lib/crm/services/merge.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { createPerson } from '../../../lib/crm/services/person.ts'
import { createDeal } from '../../../lib/crm/services/deal.ts'
import { createActivity } from '../../../lib/crm/services/activity.ts'
import { createTask } from '../../../lib/crm/services/task.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MARK = '병합테스트'
const ACTOR = 'mb_owner'

async function cleanup() {
  const companies = await dbA.crmCompany.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })
  const people = await dbA.crmPerson.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })
  const cIds = companies.map((c) => c.id)
  const pIds = people.map((p) => p.id)

  await dbA.crmActivity.deleteMany({ where: { OR: [{ companyId: { in: cIds } }, { personId: { in: pIds } }] } })
  await dbA.crmTask.deleteMany({ where: { OR: [{ companyId: { in: cIds } }, { personId: { in: pIds } }] } })
  await dbA.crmDealContact.deleteMany({ where: { personId: { in: pIds } } })
  await dbA.crmStageHistory.deleteMany({ where: { deal: { companyId: { in: cIds } } } })
  await dbA.crmDeal.deleteMany({ where: { companyId: { in: cIds } } })
  await dbA.crmPerson.deleteMany({ where: { id: { in: pIds } } })
  await dbA.crmCompany.deleteMany({ where: { id: { in: cIds } } })
  await dbA.crmMergeLog.deleteMany({
    where: { OR: [{ survivorId: { in: [...cIds, ...pIds] } }, { mergedId: { in: [...cIds, ...pIds] } }] },
  })
  await dbA.crmDuplicateCandidate.deleteMany({
    where: { OR: [{ aId: { in: [...cIds, ...pIds] } }, { bId: { in: [...cIds, ...pIds] } }] },
  })
  await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: [...cIds, ...pIds] } } })
}

/** 딜은 파이프라인·단계가 있어야 만들어진다 — 매 테스트가 같은 준비를 반복하지 않게 모은다 */
async function makeDeal(name: string, companyId: string) {
  const pipeline = await dbA.crmPipeline.findFirst({ where: { isDefault: true }, select: { id: true } })
  const stage = await dbA.crmStage.findFirst({
    where: { pipelineId: pipeline!.id }, orderBy: { position: 'asc' }, select: { id: true },
  })
  return createDeal(WS_A, ACTOR, {
    name, companyId, pipelineId: pipeline!.id, stageId: stage!.id,
  })
}

/** 소프트 삭제된 것까지 보려면 명시해야 한다(가드가 기본으로 숨긴다) */
function withDeleted(id: string) {
  return dbA.crmCompany.findFirst({ where: { id, deletedAt: undefined } })
}

test('시작 전 잔여 정리', async () => { await cleanup() })

// ------------------------------------------------------------
// DI-10 — 참조가 전부 생존자로 옮겨진다
// ------------------------------------------------------------

test('★ 회사 병합: 딜·인물·활동·태스크가 전부 생존자로 옮겨진다', async () => {
  const keep = await createCompany(WS_A, ACTOR, { name: `${MARK}살릴회사`, domain: 'keep-merge.example' })
  const gone = await createCompany(WS_A, ACTOR, { name: `${MARK}사라질회사`, domain: 'gone-merge.example' })

  const person = await createPerson(WS_A, ACTOR, { name: `${MARK}인물`, companyId: gone.id })
  const deal = await makeDeal(`${MARK}딜`, gone.id)
  const act = await createActivity(WS_A, ACTOR, { type: 'NOTE', title: '메모', body: '내용', companyId: gone.id })
  const task = await createTask(WS_A, ACTOR, { title: `${MARK}할일`, companyId: gone.id })

  const res = await mergeRecords(WS_A, ACTOR, 'company', keep.id, gone.id)

  assert.equal((await dbA.crmPerson.findFirst({ where: { id: person.id } }))!.companyId, keep.id)
  assert.equal((await dbA.crmDeal.findFirst({ where: { id: deal.id } }))!.companyId, keep.id)
  assert.equal((await dbA.crmActivity.findFirst({ where: { id: act.id } }))!.companyId, keep.id)
  assert.equal((await dbA.crmTask.findFirst({ where: { id: task.id } }))!.companyId, keep.id)

  // 사라진 쪽은 목록에서 빠진다 — 지워진 게 아니라 숨겨진 것
  assert.equal(await dbA.crmCompany.findFirst({ where: { id: gone.id } }), null)
  assert.ok((await withDeleted(gone.id))!.deletedAt, '되돌릴 수 있게 행은 남아 있어야 한다')

  assert.ok(res.mergeLogId)
  assert.equal(res.moved['crmDeal.companyId'], 1)
  await cleanup()
})

test('★ 인물 병합: 활동·태스크·딜 참석자가 옮겨진다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const keep = await createPerson(WS_A, ACTOR, { name: `${MARK}살릴사람`, email: 'keep@merge.example', companyId: co.id })
  const gone = await createPerson(WS_A, ACTOR, { name: `${MARK}사라질사람`, email: 'gone@merge.example', companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)

  await dbA.crmDealContact.create({ data: { dealId: deal.id, personId: gone.id, role: 'DECISION_MAKER' } })
  const act = await createActivity(WS_A, ACTOR, { type: 'CALL', title: '통화', body: '내용', personId: gone.id })
  const task = await createTask(WS_A, ACTOR, { title: `${MARK}연락`, personId: gone.id })

  await mergeRecords(WS_A, ACTOR, 'person', keep.id, gone.id)

  assert.equal((await dbA.crmActivity.findFirst({ where: { id: act.id } }))!.personId, keep.id)
  assert.equal((await dbA.crmTask.findFirst({ where: { id: task.id } }))!.personId, keep.id)
  const dc = await dbA.crmDealContact.findFirst({ where: { dealId: deal.id } })
  assert.equal(dc!.personId, keep.id, '딜 참석자가 안 옮겨졌다 — 딜에서 사람이 사라진다')
  await cleanup()
})

test('★ 같은 딜에 둘 다 있으면 중복만 지운다 — 복합 키 충돌로 병합이 죽으면 안 된다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const keep = await createPerson(WS_A, ACTOR, { name: `${MARK}살릴사람`, companyId: co.id })
  const gone = await createPerson(WS_A, ACTOR, { name: `${MARK}사라질사람`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)

  await dbA.crmDealContact.create({ data: { dealId: deal.id, personId: keep.id, role: 'DECISION_MAKER' } })
  await dbA.crmDealContact.create({ data: { dealId: deal.id, personId: gone.id, role: 'PRACTITIONER' } })

  const res = await mergeRecords(WS_A, ACTOR, 'person', keep.id, gone.id)

  const rows = await dbA.crmDealContact.findMany({ where: { dealId: deal.id } })
  assert.equal(rows.length, 1, '중복이 남았거나 둘 다 사라졌다')
  assert.equal(rows[0].personId, keep.id)
  assert.equal(rows[0].role, 'DECISION_MAKER', '생존자의 역할이 덮였다')
  assert.equal(res.moved['crmDealContact.dropped'], 1)
  await cleanup()
})

test('빈 칸은 채우고, 이미 있는 값은 덮지 않는다 — 생존자를 고른 판단을 뒤집지 않는다', async () => {
  const keep = await createCompany(WS_A, ACTOR, { name: `${MARK}살릴회사`, domain: 'keep-merge.example' })
  const gone = await createCompany(WS_A, ACTOR, {
    name: `${MARK}사라질회사`, domain: 'gone-merge.example', industry: '제조', region: '부산',
  })

  await mergeRecords(WS_A, ACTOR, 'company', keep.id, gone.id)

  const after = await dbA.crmCompany.findFirst({ where: { id: keep.id } })
  assert.equal(after!.domain, 'keep-merge.example', '생존자의 도메인이 덮였다')
  assert.equal(after!.industry, '제조', '빈 칸이 안 채워졌다 — 정보를 버렸다')
  assert.equal(after!.region, '부산')
  await cleanup()
})

test('자기 자신과는 병합할 수 없다', async () => {
  const c = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const e = await catchError(() => mergeRecords(WS_A, ACTOR, 'company', c.id, c.id))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
  await cleanup()
})

test('없는 레코드를 병합하려 하면 사람 말로 거절한다', async () => {
  const c = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const e = await catchError(() => mergeRecords(WS_A, ACTOR, 'company', c.id, 'no_such_id'))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'NOT_FOUND')
  await cleanup()
})

// ------------------------------------------------------------
// DI-11 — 30일 안에 되돌리면 원상 복구
// ------------------------------------------------------------

test('★ 병합 취소: 참조도 값도 삭제도 전부 되돌아간다', async () => {
  const keep = await createCompany(WS_A, ACTOR, { name: `${MARK}살릴회사`, domain: 'keep-merge.example' })
  const gone = await createCompany(WS_A, ACTOR, {
    name: `${MARK}사라질회사`, domain: 'gone-merge.example', industry: '제조',
  })
  const deal = await makeDeal(`${MARK}딜`, gone.id)
  const act = await createActivity(WS_A, ACTOR, { type: 'NOTE', title: '메모', body: '내용', companyId: gone.id })

  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'company', keep.id, gone.id)
  await undoMerge(WS_A, ACTOR, mergeLogId)

  assert.equal((await dbA.crmDeal.findFirst({ where: { id: deal.id } }))!.companyId, gone.id, '딜이 안 돌아왔다')
  assert.equal((await dbA.crmActivity.findFirst({ where: { id: act.id } }))!.companyId, gone.id)
  assert.ok(await dbA.crmCompany.findFirst({ where: { id: gone.id } }), '사라진 회사가 안 살아났다')
  assert.equal((await dbA.crmCompany.findFirst({ where: { id: keep.id } }))!.industry, null, '채웠던 빈 칸이 안 비워졌다')
  await cleanup()
})

test('★ 인물 병합 취소: 딜 참석자도 원래 사람에게 돌아간다', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const keep = await createPerson(WS_A, ACTOR, { name: `${MARK}살릴사람`, companyId: co.id })
  const gone = await createPerson(WS_A, ACTOR, { name: `${MARK}사라질사람`, companyId: co.id })
  const deal = await makeDeal(`${MARK}딜`, co.id)
  await dbA.crmDealContact.create({ data: { dealId: deal.id, personId: gone.id, role: 'PRACTITIONER' } })

  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'person', keep.id, gone.id)
  await undoMerge(WS_A, ACTOR, mergeLogId)

  const dc = await dbA.crmDealContact.findFirst({ where: { dealId: deal.id } })
  assert.equal(dc!.personId, gone.id)
  await cleanup()
})

test('★ 병합 뒤 새로 생긴 참조는 되돌리지 않는다 — 그 사이의 일이 사라지면 안 된다', async () => {
  const keep = await createCompany(WS_A, ACTOR, { name: `${MARK}살릴회사` })
  const gone = await createCompany(WS_A, ACTOR, { name: `${MARK}사라질회사` })
  const before = await makeDeal(`${MARK}병합전딜`, gone.id)

  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'company', keep.id, gone.id)
  const after = await makeDeal(`${MARK}병합후딜`, keep.id)

  await undoMerge(WS_A, ACTOR, mergeLogId)

  assert.equal((await dbA.crmDeal.findFirst({ where: { id: before.id } }))!.companyId, gone.id)
  assert.equal((await dbA.crmDeal.findFirst({ where: { id: after.id } }))!.companyId, keep.id,
    '병합 뒤에 만든 딜까지 되돌렸다')
  await cleanup()
})

test('같은 병합을 두 번 되돌릴 수 없다', async () => {
  const keep = await createCompany(WS_A, ACTOR, { name: `${MARK}살릴회사` })
  const gone = await createCompany(WS_A, ACTOR, { name: `${MARK}사라질회사` })
  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'company', keep.id, gone.id)

  await undoMerge(WS_A, ACTOR, mergeLogId)
  const e = await catchError(() => undoMerge(WS_A, ACTOR, mergeLogId))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, /이미 되돌린/)
  await cleanup()
})

test(`★ ${MERGE_UNDO_DAYS}일이 지나면 되돌릴 수 없고, 그 사실을 사람 말로 알려 준다`, async () => {
  const keep = await createCompany(WS_A, ACTOR, { name: `${MARK}살릴회사` })
  const gone = await createCompany(WS_A, ACTOR, { name: `${MARK}사라질회사` })
  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'company', keep.id, gone.id)

  const later = new Date(Date.now() + (MERGE_UNDO_DAYS + 1) * 86_400_000)
  const e = await catchError(() => undoMerge(WS_A, ACTOR, mergeLogId, later))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, new RegExp(`${MERGE_UNDO_DAYS}일`))

  // 경계 안쪽은 여전히 된다
  const inTime = new Date(Date.now() + (MERGE_UNDO_DAYS - 1) * 86_400_000)
  await undoMerge(WS_A, ACTOR, mergeLogId, inTime)
  await cleanup()
})

test('병합과 취소가 감사에 남는다 — 누가 합쳤는지 모르면 되돌릴 근거도 없다', async () => {
  const keep = await createCompany(WS_A, ACTOR, { name: `${MARK}살릴회사` })
  const gone = await createCompany(WS_A, ACTOR, { name: `${MARK}사라질회사` })
  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'company', keep.id, gone.id)

  const merged = await dbA.crmAuditLog.findFirst({ where: { action: 'record.merged', targetId: keep.id } })
  assert.ok(merged)

  await undoMerge(WS_A, ACTOR, mergeLogId)
  const undone = await dbA.crmAuditLog.findFirst({ where: { action: 'record.merge_undone', targetId: keep.id } })
  assert.ok(undone)
  await cleanup()
})

// ------------------------------------------------------------
// 중복 후보 — 근거 없이 "중복입니다"만 뜨면 사람이 판단할 수 없다
// ------------------------------------------------------------

test('★ 도메인이 한쪽만 있는 같은 이름은 높은 점수, 도메인이 갈리면 낮은 점수', async () => {
  // DB 가 도메인에 유니크를 걸어 두어 "같은 도메인 두 행"은 애초에 만들 수 없다.
  // 그래서 현실의 중복은 늘 이 모양이다 — 이름은 같은데 한쪽이 도메인을 안 적었다.
  const a = await createCompany(WS_A, ACTOR, { name: `${MARK}데이터얼라이언스`, domain: 'dup-a.example' })
  const b = await createCompany(WS_A, ACTOR, { name: `㈜${MARK}데이터얼라이언스` })
  const c = await createCompany(WS_A, ACTOR, { name: `${MARK}다른곳`, domain: 'dup-c.example' })
  const d = await createCompany(WS_A, ACTOR, { name: `${MARK} 다른곳 주식회사`, domain: 'dup-d.example' })

  const pairs = await scanDuplicates(dbA, 'company')
  const ids = new Set([a.id, b.id, c.id, d.id])
  const mine = pairs.filter((p) => ids.has(p.aId) && ids.has(p.bId))

  const oneSided = mine.find((p) => [p.aId, p.bId].includes(a.id) && [p.aId, p.bId].includes(b.id))
  assert.ok(oneSided, '㈜ 표기만 다른 같은 회사를 못 찾았다')
  assert.ok(oneSided!.score >= 0.85)

  const split = mine.find((p) => [p.aId, p.bId].includes(c.id) && [p.aId, p.bId].includes(d.id))
  assert.ok(split, '이름이 같은 쌍을 아예 못 찾았다')
  assert.ok(split!.score < oneSided!.score, '도메인이 갈리는데 같은 확신을 줬다')
  assert.match(split!.reason, /도메인이 다름/)
  await cleanup()
})

test('같은 회사에 같은 이름이면 후보로 올린다 — 메일이 한쪽만 있으면 더 높게', async () => {
  const co = await createCompany(WS_A, ACTOR, { name: `${MARK}회사` })
  const a = await createPerson(WS_A, ACTOR, { name: `${MARK}김하나`, email: 'one@dup-merge.example', companyId: co.id })
  const b = await createPerson(WS_A, ACTOR, { name: `${MARK} 김하나 `, companyId: co.id })

  const pairs = await scanDuplicates(dbA, 'person')
  const hit = pairs.find((p) => [p.aId, p.bId].includes(a.id) && [p.aId, p.bId].includes(b.id))
  assert.ok(hit, '공백만 다른 같은 이름을 놓쳤다')
  assert.ok(hit!.score >= 0.9)
  await cleanup()
})

test('회사가 다르면 같은 이름이어도 묶지 않는다 — 동명이인을 합치면 되돌려도 흔적이 남는다', async () => {
  const co1 = await createCompany(WS_A, ACTOR, { name: `${MARK}가회사` })
  const co2 = await createCompany(WS_A, ACTOR, { name: `${MARK}나회사` })
  const a = await createPerson(WS_A, ACTOR, { name: `${MARK}이동명`, companyId: co1.id })
  const b = await createPerson(WS_A, ACTOR, { name: `${MARK}이동명`, companyId: co2.id })

  const pairs = await scanDuplicates(dbA, 'person')
  assert.ok(!pairs.some((p) => [p.aId, p.bId].includes(a.id) && [p.aId, p.bId].includes(b.id)),
    '다른 회사의 동명이인을 중복으로 묶었다')
  await cleanup()
})

test('이름이 다르면 묶지 않는다 — 오탐은 후보일 뿐이어도 비용이다', async () => {
  const a = await createCompany(WS_A, ACTOR, { name: `${MARK}에이클라우드` })
  const b = await createCompany(WS_A, ACTOR, { name: `${MARK}비클라우드` })

  const pairs = await scanDuplicates(dbA, 'company')
  assert.ok(!pairs.some((p) => [p.aId, p.bId].includes(a.id) && [p.aId, p.bId].includes(b.id)))
  await cleanup()
})

test('후보를 저장하고 다시 훑어도 같은 쌍이 쌓이지 않는다', async () => {
  const a = await createCompany(WS_A, ACTOR, { name: `${MARK}가나다`, domain: 'dup-merge.example' })
  const b = await createCompany(WS_A, ACTOR, { name: `${MARK}가나다(주)` })

  const pairs = (await scanDuplicates(dbA, 'company'))
    .filter((p) => [p.aId, p.bId].every((id) => [a.id, b.id].includes(id)))
  assert.equal(pairs.length, 1)
  assert.equal(await saveDuplicates(WS_A, pairs), 1)
  assert.equal(await saveDuplicates(WS_A, pairs), 0, '같은 쌍이 두 번 쌓였다')

  const list = await listDuplicates(dbA, 'company')
  assert.ok(list.some((c: { aId: string }) => [a.id, b.id].includes(c.aId)))
  await cleanup()
})

test('"이건 다른 회사다"라고 판단하면 다시 뜨지 않는다', async () => {
  const a = await createCompany(WS_A, ACTOR, { name: `${MARK}마바사`, domain: 'dup-merge.example' })
  const b = await createCompany(WS_A, ACTOR, { name: `${MARK}마바사(주)` })
  await saveDuplicates(WS_A, (await scanDuplicates(dbA, 'company'))
    .filter((p) => [p.aId, p.bId].every((id) => [a.id, b.id].includes(id))))

  const before = await listDuplicates(dbA, 'company')
  const mine = before.find((c: { aId: string; bId: string }) => [a.id, b.id].includes(c.aId))
  await dismissDuplicate(WS_A, mine.id)

  const after = await listDuplicates(dbA, 'company')
  assert.ok(!after.some((c: { id: string }) => c.id === mine.id), '치운 후보가 다시 떴다')
  await cleanup()
})

test('★ 병합하면 그 쌍의 후보가 닫힌다 — 처리한 것이 계속 뜨면 아무도 안 본다', async () => {
  const a = await createCompany(WS_A, ACTOR, { name: `${MARK}아자차`, domain: 'dup-merge.example' })
  const b = await createCompany(WS_A, ACTOR, { name: `${MARK}아자차(주)` })
  await saveDuplicates(WS_A, (await scanDuplicates(dbA, 'company'))
    .filter((p) => [p.aId, p.bId].every((id) => [a.id, b.id].includes(id))))

  const before = await listDuplicates(dbA, 'company')
  const mine = before.find((c: { aId: string }) => [a.id, b.id].includes(c.aId))
  assert.ok(mine)

  await mergeRecords(WS_A, ACTOR, 'company', a.id, b.id)

  const left = await listDuplicates(dbA, 'company')
  assert.ok(!left.some((c: { id: string }) => c.id === mine.id), '병합했는데 후보로 계속 남았다')
  await cleanup()
})

test('★ 되돌리면 후보가 다시 열린다 — 안 그러면 다시 합칠 길이 영영 사라진다', async () => {
  const a = await createCompany(WS_A, ACTOR, { name: `${MARK}카타파`, domain: 'dup-merge.example' })
  const b = await createCompany(WS_A, ACTOR, { name: `${MARK}카타파(주)` })
  await saveDuplicates(WS_A, (await scanDuplicates(dbA, 'company'))
    .filter((p) => [p.aId, p.bId].every((id) => [a.id, b.id].includes(id))))

  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'company', a.id, b.id)
  assert.equal((await listDuplicates(dbA, 'company'))
    .filter((c: { aId: string }) => [a.id, b.id].includes(c.aId)).length, 0)

  await undoMerge(WS_A, ACTOR, mergeLogId)

  const back = (await listDuplicates(dbA, 'company'))
    .filter((c: { aId: string }) => [a.id, b.id].includes(c.aId))
  assert.equal(back.length, 1, '되돌렸는데 후보가 안 돌아왔다 — 다시 합칠 방법이 없다')
  await cleanup()
})

test('사람이 "아니다"라고 치운 것은 되돌려도 다시 열지 않는다 — 그건 사고가 아니라 판단이다', async () => {
  const a = await createCompany(WS_A, ACTOR, { name: `${MARK}하허호`, domain: 'dup-merge.example' })
  const b = await createCompany(WS_A, ACTOR, { name: `${MARK}하허호(주)` })
  await saveDuplicates(WS_A, (await scanDuplicates(dbA, 'company'))
    .filter((p) => [p.aId, p.bId].every((id) => [a.id, b.id].includes(id))))

  const mine = (await listDuplicates(dbA, 'company'))
    .find((c: { aId: string }) => [a.id, b.id].includes(c.aId))
  await dismissDuplicate(WS_A, mine.id)

  const { mergeLogId } = await mergeRecords(WS_A, ACTOR, 'company', a.id, b.id)
  await undoMerge(WS_A, ACTOR, mergeLogId)

  const row = await dbA.crmDuplicateCandidate.findFirst({ where: { id: mine.id } })
  assert.equal(row!.status, 'DISMISSED', '사람의 판단을 시스템이 뒤집었다')
  await cleanup()
})

test('끝난 뒤 잔여 없음', async () => {
  await cleanup()
  const left = await dbA.crmCompany.count({ where: { name: { contains: MARK }, deletedAt: undefined } })
  assert.equal(left, 0)
})
