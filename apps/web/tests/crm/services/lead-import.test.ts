/**
 * 리드 이관 — 실 DB 검증 (dacrm 정정판)
 *
 * 이 기능이 없어서 옛 "프로젝트관리" 메뉴를 못 치우고 있었다.
 * 거래처·담당자·영업기회 14건은 이미 옮겼는데 **리드 1,517건**만 갈 곳이 없었다.
 *
 * 이관에서 가장 무서운 것은 **중복**이다. 1,517건을 옮기다가 회사가 두 배가 되면
 * 그 다음에 병합하느라 이관보다 큰 일이 된다. 그래서 여기서 제일 많이 확인하는 것도 그것이다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import { planImport, importLead } from '../../../lib/crm/services/lead-import.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MARK = '리드이관테스트'
const ACTOR = 'mb_owner'
const LEAD_ID = '00000000-0000-4000-8000-000000000001'

async function pipelineAndStage() {
  const pipeline = await dbA.crmPipeline.findFirst({ where: { isDefault: true }, select: { id: true } })
  const stage = await dbA.crmStage.findFirst({
    where: { pipelineId: pipeline!.id, kind: 'OPEN' }, orderBy: { position: 'asc' }, select: { id: true },
  })
  return { pipelineId: pipeline!.id, stageId: stage!.id }
}

async function cleanup() {
  const cIds = (await dbA.crmCompany.findMany({
    where: { name: { contains: MARK }, deletedAt: undefined }, select: { id: true },
  })).map((c) => c.id)
  const pIds = (await dbA.crmPerson.findMany({
    where: { OR: [{ name: { contains: MARK } }, { email: { contains: 'lead-import-test' } }], deletedAt: undefined },
    select: { id: true },
  })).map((p) => p.id)

  await dbA.crmActivity.deleteMany({ where: { OR: [{ companyId: { in: cIds } }, { personId: { in: pIds } }] } })
  await dbA.crmDealContact.deleteMany({ where: { personId: { in: pIds } } })
  await dbA.crmStageHistory.deleteMany({ where: { deal: { companyId: { in: cIds } } } })
  await dbA.crmDeal.deleteMany({ where: { companyId: { in: cIds } } })
  await dbA.crmPerson.deleteMany({ where: { id: { in: pIds } } })
  await dbA.crmCompany.deleteMany({ where: { id: { in: cIds } } })
  await dbA.crmAuditLog.deleteMany({ where: { action: 'lead.imported' } })
}

test('시작 전 잔여 정리', async () => { await cleanup() })

// ------------------------------------------------------------
// 미리보기 — 누르기 전에 무엇이 생길지 안다
// ------------------------------------------------------------

test('★ 회사 이름이 없으면 옮길 수 없다고 먼저 말한다', () => {
  const p = planImport({ contact_name: '김아무개' })
  assert.equal(p.ok, false)
  assert.match(p.reason!, /회사 이름/)
})

test('억 원 단위를 원(minor)으로 바꾼다 — 8억이 8원이 되면 파이프라인이 거짓말한다', () => {
  const p = planImport({ company_name: '가나다', deal_value_billion: 8 })
  assert.equal(p.amountMinor, '800000000')
})

test('금액이 없거나 0이면 금액 없는 딜이다 — 0원으로 만들면 합계가 틀어진다', () => {
  assert.equal(planImport({ company_name: '가나다' }).amountMinor, null)
  assert.equal(planImport({ company_name: '가나다', deal_value_billion: 0 }).amountMinor, null)
})

test('딜 이름에 무엇을 파는지가 들어간다 — 회사명만이면 목록에서 구분이 안 된다', () => {
  const p = planImport({ company_name: '가나다', product_recommendation: 'H100 30장' })
  assert.match(p.dealName!, /가나다/)
  assert.match(p.dealName!, /H100/)
})

// ------------------------------------------------------------
// 이관 — 중복을 만들지 않는다
// ------------------------------------------------------------

test('★ 같은 이름 회사가 이미 있으면 새로 만들지 않고 붙인다', async () => {
  const existing = await createCompany(WS_A, ACTOR, { name: `${MARK}이미있는회사` })

  const res = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}이미있는회사`,
    contact_name: `${MARK}담당자`,
  })

  assert.equal(res.companyId, existing.id, '같은 회사를 또 만들었다 — 이관하다 회사가 두 배가 된다')
  assert.equal(res.reusedCompany, true)
  await cleanup()
})

test('★ 회사 메일 도메인으로도 기존 회사를 찾는다', async () => {
  const existing = await createCompany(WS_A, ACTOR, {
    name: `${MARK}도메인회사`, domain: 'lead-import-test.example',
  })

  const res = await importLead(WS_A, ACTOR, LEAD_ID, {
    // 이름은 다르게 적혀 있지만 도메인이 같다 — 같은 회사다
    company_name: `${MARK}도메인회사(주)`,
    contact_email: 'someone@lead-import-test.example',
  })

  assert.equal(res.companyId, existing.id)
  await cleanup()
})

test('★ 개인 메일 도메인은 회사 도메인으로 쓰지 않는다 — gmail.com 이 회사가 되면 안 된다', async () => {
  const res = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}지메일회사`,
    contact_email: 'someone@gmail.com',
  })

  const co = await dbA.crmCompany.findFirst({ where: { id: res.companyId } })
  assert.equal(co!.domain, null, 'gmail.com 이 회사 도메인으로 들어갔다')
  await cleanup()
})

test('딜은 요청했을 때만 만든다 — 리드 1,517건이 전부 딜이 되면 파이프라인이 쓰레기로 찬다', async () => {
  const noDeal = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}딜없음`, product_recommendation: 'H100',
  })
  assert.equal(noDeal.dealId, null)

  const { pipelineId, stageId } = await pipelineAndStage()
  const withDeal = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}딜있음`, product_recommendation: 'H100',
  }, { pipelineId, stageId })
  assert.ok(withDeal.dealId)
  await cleanup()
})

test('★ 딜을 만들면 단계 이력도 함께 남는다 — 없으면 "언제 이 단계에 들어왔나"를 모른다', async () => {
  const { pipelineId, stageId } = await pipelineAndStage()
  const res = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}이력회사`, product_recommendation: 'A100',
  }, { pipelineId, stageId })

  const history = await dbA.crmStageHistory.findMany({ where: { dealId: res.dealId! } })
  assert.equal(history.length, 1)
  assert.equal(history[0].toStageId, stageId)
  await cleanup()
})

test('★ 리드 원문이 활동으로 남는다 — 요약만 남기면 왜 넣었는지 근거가 사라진다', async () => {
  const res = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}원문회사`,
    deal_description: 'PoC 후 12개월 약정 논의 중',
    fit_score: 97,
  })

  const act = await dbA.crmActivity.findFirst({ where: { companyId: res.companyId } })
  assert.ok(act, '원문이 사라졌다')
  assert.match(act!.body!, /PoC 후 12개월/)
  assert.match(act!.body!, /적합도: 97/)
  assert.equal(act!.source, 'IMPORT', '어디서 왔는지 표시가 없다')
  await cleanup()
})

test('사람도 이미 있으면 다시 만들지 않는다', async () => {
  const first = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}회사`, contact_name: `${MARK}사람`,
    contact_email: 'dup@lead-import-test.example',
  })
  const second = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}회사`, contact_name: `${MARK}사람 이름다름`,
    contact_email: 'dup@lead-import-test.example',
  })
  assert.equal(second.personId, first.personId, '같은 메일로 사람이 두 번 만들어졌다')
  await cleanup()
})

test('딜에 담당자가 참석자로 붙는다', async () => {
  const { pipelineId, stageId } = await pipelineAndStage()
  const res = await importLead(WS_A, ACTOR, LEAD_ID, {
    company_name: `${MARK}참석회사`, contact_name: `${MARK}참석자`,
    product_recommendation: 'L40S',
  }, { pipelineId, stageId })

  const contacts = await dbA.crmDealContact.findMany({ where: { dealId: res.dealId! } })
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].personId, res.personId)
  await cleanup()
})

test('회사 이름 없는 리드는 이관을 거절한다', async () => {
  const e = await catchError(() => importLead(WS_A, ACTOR, LEAD_ID, { contact_name: '아무개' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
})

test('이관이 감사에 남는다', async () => {
  const res = await importLead(WS_A, ACTOR, LEAD_ID, { company_name: `${MARK}감사회사` })
  const audit = await dbA.crmAuditLog.findFirst({
    where: { action: 'lead.imported', targetId: res.companyId },
  })
  assert.ok(audit, '누가 언제 옮겼는지 기록이 없다')
  await cleanup()
})

test('끝난 뒤 잔여 없음', async () => {
  await cleanup()
  assert.equal(await dbA.crmCompany.count({ where: { name: { contains: MARK }, deletedAt: undefined } }), 0)
})
