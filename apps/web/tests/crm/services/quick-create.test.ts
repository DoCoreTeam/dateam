/**
 * 원터치 생성 — 실 DB 검증 (dacrm T1-05)
 *
 * 이 기능의 위험은 추출 정확도가 아니라 **중복 생성**이다.
 * 명함 받을 때마다 같은 회사가 늘어나면 그때부터 매출 합계가 거짓이 된다.
 * 그래서 검증의 절반이 "이미 있는 것과 부딪혔을 때 어떻게 되는가"다.
 *
 * mock 어댑터를 쓴다 — 실제 모델 키는 T1-09(HUMAN GATE) 이후에 들어온다.
 * 어댑터가 바뀌어도 여기 규칙(중복 판정·트랜잭션·갭)은 그대로여야 한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from '../integrity/_helpers.ts'
import { quickCreate } from '../../../lib/crm/services/quick-create.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { mockAdapter } from '../../../lib/crm/ai/adapters/mock.ts'
import { parseQuickCreate } from '../../../lib/crm/ai/schemas/quick-create.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MADE: { companies: string[]; people: string[]; deals: string[] } = {
  companies: [], people: [], deals: [],
}

function track(result: { created: { type: string; id: string }[] }) {
  for (const r of result.created) {
    if (r.type === 'company') MADE.companies.push(r.id)
    if (r.type === 'person') MADE.people.push(r.id)
    if (r.type === 'deal') MADE.deals.push(r.id)
  }
}

/**
 * 이 파일이 만드는 것을 전부 지운다.
 *
 * id 목록만으로 지우지 않고 **이름·도메인으로도** 훑는 이유:
 * 테스트가 실패하면 그 뒤 cleanup 이 실행되지 않아 잔여가 남고,
 * 그 잔여가 다음 실행에서 "이미 있는 회사"로 잡혀 **다른 테스트를 연쇄로 무너뜨린다**(실측).
 * 실패한 실행이 다음 실행을 오염시키지 않게 하는 것이 여기서 제일 중요하다.
 */
async function cleanup() {
  const ids = [...MADE.companies, ...MADE.people, ...MADE.deals]
  if (ids.length) await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: ids } } })
  if (MADE.deals.length) {
    await dbA.crmStageHistory.deleteMany({ where: { dealId: { in: MADE.deals } } })
    await dbA.crmDeal.deleteMany({ where: { id: { in: MADE.deals } } })
  }
  if (MADE.companies.length) {
    await dbA.crmActivity.deleteMany({ where: { companyId: { in: MADE.companies } } })
  }
  if (MADE.people.length) {
    await dbA.crmActivity.deleteMany({ where: { personId: { in: MADE.people } } })
    await dbA.crmPerson.deleteMany({ where: { id: { in: MADE.people } } })
  }
  if (MADE.companies.length) {
    await dbA.crmCompany.deleteMany({ where: { id: { in: MADE.companies } } })
  }
  // 이름·도메인으로 한 번 더 훑는다 — 앞선 실패가 남긴 것까지 치운다
  const strays = await dbA.crmCompany.findMany({
    where: { OR: [{ domain: { contains: 'quick-create-test' } }, { name: { contains: '퀵생성' } }, { name: '기존 회사' }] },
    select: { id: true },
  })
  const strayIds = strays.map((c) => c.id)
  if (strayIds.length) {
    await dbA.crmActivity.deleteMany({ where: { companyId: { in: strayIds } } })
    await dbA.crmPerson.deleteMany({ where: { companyId: { in: strayIds } } })
    await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: strayIds } } })
    await dbA.crmCompany.deleteMany({ where: { id: { in: strayIds } } })
  }
  await dbA.crmPerson.deleteMany({ where: { email: { contains: 'quick-create-test' } } })
  await dbA.crmAiRun.deleteMany({ where: { model: 'mock' } })
  MADE.companies = []
  MADE.people = []
  MADE.deals = []
}

/** 앞선 실행이 남긴 것 위에서 시작하지 않는다 */
test('시작 전 잔여 정리', async () => { await cleanup() })

const CARD = `㈜퀵생성테스트
홍길동 팀장
hong@quick-create-test.example
02-1234-5678`

// ------------------------------------------------------------
// 출력 스키마 — 지어낸 값이 들어오는 문을 닫는다
// ------------------------------------------------------------

test('"알 수 없음" 같은 말은 값이 아니라 null 로 접힌다', () => {
  const out = parseQuickCreate(JSON.stringify({
    company: { name: '알 수 없음', domain: '  ', industry: 'n/a', region: 'IT' },
    person: null, deal: null, notes: null,
  }))
  assert.equal(out.company?.name, null)
  assert.equal(out.company?.domain, null)
  assert.equal(out.company?.industry, null)
  assert.equal(out.company?.region, 'IT', '진짜 값은 남아야 한다')
})

test('금액 문자열의 콤마를 풀고, 음수·소수는 거절한다', () => {
  const ok = parseQuickCreate(JSON.stringify({
    company: null, person: null, deal: { name: 'A', amountMinor: '1,200,000', currency: 'KRW' }, notes: null,
  }))
  assert.equal(ok.deal?.amountMinor, 1_200_000)

  assert.throws(() => parseQuickCreate(JSON.stringify({
    company: null, person: null, deal: { name: 'A', amountMinor: -5, currency: 'KRW' }, notes: null,
  })))
})

test('코드펜스로 감싸 와도 파싱한다 — 멀쩡한 답을 두 번 묻지 않는다', () => {
  const out = parseQuickCreate('```json\n{"company":null,"person":null,"deal":null,"notes":"x"}\n```')
  assert.equal(out.notes, 'x')
})

test('JSON 이 아니면 던진다 — 반쯤 읽은 값으로 레코드를 만들지 않는다', () => {
  assert.throws(() => parseQuickCreate('회사는 퀵생성테스트입니다'))
})

// ------------------------------------------------------------
// mock 어댑터 — AI 인 척하지 않고, 모르는 것은 비워 둔다
// ------------------------------------------------------------

test('명함에서 이메일·전화·도메인을 뽑고, 모르는 것은 null 로 둔다', async () => {
  const a = mockAdapter()
  const res = await a.complete(`"""\n${CARD}\n"""`)
  const out = parseQuickCreate(res.text)
  assert.equal(out.person?.email, 'hong@quick-create-test.example')
  assert.ok(out.person?.phone)
  assert.equal(out.company?.domain, 'quick-create-test.example')
  assert.equal(out.company?.industry, null, '산업을 추측하면 안 된다')
  assert.equal(out.deal, null, '명함 한 장으로 딜을 만들지 않는다')
})

test('무료 메일 도메인은 회사 도메인으로 쓰지 않는다', async () => {
  const a = mockAdapter()
  const res = await a.complete('"""\n김철수\nchulsoo@gmail.com\n"""')
  const out = parseQuickCreate(res.text)
  assert.equal(out.company, null)
  assert.equal(out.person?.email, 'chulsoo@gmail.com')
})

// ------------------------------------------------------------
// 서비스 — 이미 있는 것과 부딪혔을 때
// ------------------------------------------------------------

test('붙여넣기 한 번으로 회사와 담당자가 만들어진다', async () => {
  const r = await quickCreate(WS_A, 'mb_owner', { text: CARD })
  track(r)
  const kinds = r.created.map((c) => c.type).sort()
  assert.deepEqual(kinds, ['company', 'person'])
  assert.ok(r.runId, 'AI 실행이 기록돼야 한다')
  await cleanup()
})

test('★ 같은 도메인의 회사가 이미 있으면 새로 만들지 않고 이어 붙인다', async () => {
  const existing = await createCompany(WS_A, 'mb_owner', {
    name: '기존 회사', domain: 'quick-create-test.example',
  })
  MADE.companies.push(existing.id)

  const r = await quickCreate(WS_A, 'mb_owner', { text: CARD })
  track(r)

  assert.equal(r.created.filter((c) => c.type === 'company').length, 0, '회사가 새로 생겼다')
  assert.equal(r.linked.find((c) => c.type === 'company')?.id, existing.id)

  const all = await dbA.crmCompany.findMany({ where: { domain: 'quick-create-test.example' } })
  assert.equal(all.length, 1, '같은 도메인 회사가 둘이 됐다')
  await cleanup()
})

test('★ 같은 이메일의 인물이 이미 있으면 이어 붙이고, 빈 소속만 채운다', async () => {
  const first = await quickCreate(WS_A, 'mb_owner', { text: CARD })
  track(first)
  const personId = first.created.find((c) => c.type === 'person')?.id
  assert.ok(personId)

  const again = await quickCreate(WS_A, 'mb_owner', { text: CARD })
  track(again)
  assert.equal(again.created.filter((c) => c.type === 'person').length, 0)
  assert.equal(again.linked.find((c) => c.type === 'person')?.id, personId)
  await cleanup()
})

test('AI 가 만든 레코드는 감사 기록에 AI 로 남는다 — 사람이 넣은 것과 구분된다', async () => {
  const r = await quickCreate(WS_A, 'mb_owner', { text: CARD })
  track(r)
  const co = r.created.find((c) => c.type === 'company')
  const audit = await dbA.crmAuditLog.findFirst({ where: { targetId: co!.id } })
  assert.equal(audit?.actorType, 'AI')
  await cleanup()
})

test('붙여넣은 원문이 타임라인에 남는다 — 추출이 놓친 문장을 나중에 확인할 수 있다', async () => {
  const r = await quickCreate(WS_A, 'mb_owner', { text: CARD })
  track(r)
  const co = r.created.find((c) => c.type === 'company')
  const acts = await dbA.crmActivity.findMany({ where: { companyId: co!.id } })
  assert.equal(acts.length, 1)
  assert.equal(acts[0].source, 'AI')
  assert.ok(acts[0].body?.includes('hong@quick-create-test.example'))
  await cleanup()
})

test('회사도 사람도 못 찾으면 무엇이 필요한지 말한다 (빈 성공 금지)', async () => {
  const r = await quickCreate(WS_A, 'mb_owner', { text: '내일 점심 먹기' })
  track(r)
  assert.equal(r.created.length, 0)
  assert.equal(r.linked.length, 0)
  assert.ok(r.gaps.some((g) => g.field === 'name' && g.blocking))
  await cleanup()
})

test('딜은 금액이 드러날 때만 만들고, 이름이 없으면 사람에게 묻는다', async () => {
  const pipeline = await dbA.crmPipeline.findFirst({ where: { isDefault: true } })
  const stage = await dbA.crmStage.findFirst({
    where: { pipelineId: pipeline!.id, kind: 'OPEN' }, orderBy: { position: 'asc' },
  })
  const r = await quickCreate(WS_A, 'mb_owner', {
    text: `${CARD}\n도입 규모는 3억원 정도로 보고 있습니다`,
    createDeal: true, pipelineId: pipeline!.id, stageId: stage!.id,
  })
  track(r)
  // 금액은 읽었지만 딜 이름은 사람이 정한다 — AI 가 이름을 지어내면 목록이 비슷해진다
  assert.ok(r.gaps.some((g) => g.target === 'deal' && g.field === 'name'))
  assert.equal(r.created.filter((c) => c.type === 'deal').length, 0)
  await cleanup()
})

test('빈 입력과 너무 긴 입력은 사람 말로 거절한다', async () => {
  const empty = await catchError(() => quickCreate(WS_A, 'mb_owner', { text: '   ' }))
  assert.ok(empty instanceof CrmError)
  assert.equal((empty as CrmError).code, 'VALIDATION_FAILED')

  const long = await catchError(() => quickCreate(WS_A, 'mb_owner', { text: 'ㄱ'.repeat(9000) }))
  assert.ok(long instanceof CrmError)
  assert.match((long as CrmError).message, /너무 깁니다/)
})

test('AI 가 두 번 다 실패하면 레코드를 만들지 않고 원문을 지키라고 말한다', async () => {
  const broken = {
    model: 'mock',
    async complete() { return { text: '이건 JSON 이 아니다', tokensIn: 1, tokensOut: 1 } },
  }
  const e = await catchError(() => quickCreate(WS_A, 'mb_owner', { text: CARD }, broken))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'AI_PARSE_FAILED')

  const leaked = await dbA.crmCompany.findMany({ where: { domain: 'quick-create-test.example' } })
  assert.equal(leaked.length, 0, '실패했는데 회사가 만들어졌다')

  // 실패도 기록에 남는다 — 남지 않으면 "왜 안 됐지"를 사용자에게 물어보게 된다
  const failed = await dbA.crmAiRun.findFirst({ where: { status: 'FAILED', model: 'mock' } })
  assert.ok(failed, '실패가 기록되지 않았다')
  await cleanup()
})
