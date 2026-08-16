/**
 * 필드 확정·자동 반영 설정 — 실 DB 검증 (dacrm 정정판)
 *
 * 이 두 스위치가 없어서 제품의 약속 두 개가 **한 번도 실행되지 않았다**.
 *   · 절대규칙 2 "사람이 확인한 값은 AI 가 못 덮는다" — 확정할 자리가 없어 판정은 늘 빈 목록을 받았다
 *   · 자동 반영 — 설정 행이 0이라 인박스의 '자동 반영됨' 탭이 구조적으로 영원히 비어 있었다
 *
 * 그래서 여기서 증명할 것은 **"같은 조건에서 확정 하나로 결과가 갈린다"**이다.
 *
 * **전용 워크스페이스를 쓴다.** 자동 반영 설정은 워크스페이스 단위 상태라
 * 실사용 워크스페이스에 켜 두면 옆에서 도는 DI-12·13 테스트가 통째로 깨진다(실측).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, catchError } from '../integrity/_helpers.ts'
import { getCrmDb } from '../../../lib/crm/db/client.ts'
import { setFieldVerified, listVerified, verifiableFields } from '../../../lib/crm/services/verify.ts'
import { setFieldConfig, listFieldConfigs } from '../../../lib/crm/services/field-config.ts'
import { createSuggestion } from '../../../lib/crm/services/suggestion.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const WS = 'ws_verify_test'
const db = getCrmDb(WS)
const ACTOR = 'mb_owner'

async function ensureWorkspace() {
  await dbA.$executeRawUnsafe(
    `INSERT INTO crm_workspace (id, name, "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT (id) DO NOTHING`, WS, '확정 테스트 전용',
  )
}

async function makeCompany(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmCompany.create({ data: { name }, select: { id: true } })
}

async function makeRun() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmAiRun.create({
    data: {
      kind: 'QUICK_CREATE', model: 'test', promptVersion: 'test@v1',
      status: 'DONE', tokensIn: 0, tokensOut: 0, costMinorUsd: BigInt(0),
      inputRef: {} as never,
    },
    select: { id: true },
  })
}

async function cleanup() {
  await dbA.$executeRawUnsafe(`DELETE FROM crm_ai_suggestion WHERE "workspaceId" = $1`, WS)
  await dbA.$executeRawUnsafe(`DELETE FROM crm_ai_run WHERE "workspaceId" = $1`, WS)
  await dbA.$executeRawUnsafe(`DELETE FROM crm_ai_field_config WHERE "workspaceId" = $1`, WS)
  await dbA.$executeRawUnsafe(`DELETE FROM crm_audit_log WHERE "workspaceId" = $1`, WS)
  await dbA.$executeRawUnsafe(`DELETE FROM crm_company WHERE "workspaceId" = $1`, WS)
}

test('시작 전 준비 — 전용 워크스페이스', async () => {
  await ensureWorkspace()
  await cleanup()
})

// ------------------------------------------------------------
// 확정 — 켜고 끌 수 있어야 아무도 무서워하지 않는다
// ------------------------------------------------------------

test('확정하고 풀 수 있다 — 못 풀면 아무도 안 누른다', async () => {
  const co = await makeCompany('확정테스트회사')

  await setFieldVerified(WS, ACTOR, 'company', co.id, 'industry', true)
  assert.deepEqual(await listVerified(db, 'company', co.id), ['industry'])

  await setFieldVerified(WS, ACTOR, 'company', co.id, 'industry', false)
  assert.deepEqual(await listVerified(db, 'company', co.id), [])
  await cleanup()
})

test('필드 단위다 — 레코드 전체를 잠그면 한 칸 때문에 나머지 보강까지 죽는다', async () => {
  const co = await makeCompany('확정테스트회사')
  await setFieldVerified(WS, ACTOR, 'company', co.id, 'industry', true)
  await setFieldVerified(WS, ACTOR, 'company', co.id, 'region', true)
  const list = await listVerified(db, 'company', co.id)
  assert.equal(list.length, 2)
  await setFieldVerified(WS, ACTOR, 'company', co.id, 'industry', false)
  assert.deepEqual(await listVerified(db, 'company', co.id), ['region'], '하나를 풀었는데 다른 것도 풀렸다')
  await cleanup()
})

test('없는 필드는 확정할 수 없다 — 오타가 조용히 저장되면 "잠근 줄 알았는데 안 잠긴" 상태가 된다', async () => {
  const co = await makeCompany('확정테스트회사')
  const e = await catchError(() => setFieldVerified(WS, ACTOR, 'company', co.id, 'industryy', true))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
  await cleanup()
})

test('★ 원래 자동 반영이 안 되는 칸은 확정 대상이 아니다 — 잠글 게 없는데 잠금 버튼을 두면 오해를 부른다', async () => {
  const co = await makeCompany('확정테스트회사')
  // 딜의 금액은 절대규칙 3으로 이미 항상 사람 확인이다
  const e = await catchError(() => setFieldVerified(WS, ACTOR, 'deal', co.id, 'amountMinor', true))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, /따로 확정하지 않아도/)
  await cleanup()
})

test('없는 레코드는 확정할 수 없다', async () => {
  const e = await catchError(() => setFieldVerified(WS, ACTOR, 'company', 'no_such', 'industry', true))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'NOT_FOUND')
})

test('확정 대상 목록이 세 모델에 다 있다 — 화면이 어디에 자물쇠를 그릴지 알아야 한다', () => {
  assert.ok(verifiableFields('company').includes('industry'))
  assert.ok(verifiableFields('person').includes('email'))
  assert.ok(verifiableFields('deal').includes('name'))
  assert.deepEqual(verifiableFields('nope'), [])
})

// ------------------------------------------------------------
// 자동 반영 설정 — 신뢰의 범위
// ------------------------------------------------------------

test('설정이 하나도 없어도 목록이 나온다 — 기본은 전부 "사람 확인"이다', async () => {
  const rows = await listFieldConfigs(db)
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.autoApply === false), '기본값이 자동 반영으로 켜져 있다')
  await cleanup()
})

test('★ 금액·통화는 켤 수 없다 — 사업 판단이 걸린 칸은 항상 사람이 본다(절대규칙 3)', async () => {
  const rows = await listFieldConfigs(db)
  const amount = rows.find((r) => r.targetType === 'deal' && r.field === 'amountMinor')
  assert.ok(amount)
  assert.equal(amount!.configurable, false)
  assert.ok(amount!.reason, '못 켜는 이유를 안 밝히면 사용자는 없는 스위치를 찾는다')

  const e = await catchError(() =>
    setFieldConfig(WS, ACTOR, 'deal', 'amountMinor', { autoApply: true }))
  assert.ok(e instanceof CrmError)
  await cleanup()
})

test('기준 확신도는 범위를 벗어날 수 없다 — 0이면 아무 값이나 들어오고 1.0 은 영영 안 걸린다', async () => {
  const tooLow = await catchError(() =>
    setFieldConfig(WS, ACTOR, 'company', 'industry', { minConfidence: 0.1 }))
  assert.ok(tooLow instanceof CrmError)
  const tooHigh = await catchError(() =>
    setFieldConfig(WS, ACTOR, 'company', 'industry', { minConfidence: 1 }))
  assert.ok(tooHigh instanceof CrmError)
  await cleanup()
})

// ------------------------------------------------------------
// 둘이 만나는 지점 — 확정 하나로 결과가 갈린다
// ------------------------------------------------------------

test('★ 같은 조건에서 확정 하나로 결과가 갈린다 — 이게 절대규칙 2의 전부다', async () => {
  const co = await makeCompany('확정테스트회사')
  const run = await makeRun()
  await setFieldConfig(WS, ACTOR, 'company', 'industry', { autoApply: true, minConfidence: 0.7 })

  // ① 확정 안 함 → 자동 반영된다
  const open = await createSuggestion(WS, ACTOR, {
    runId: run.id, axis: 'WHAT', targetType: 'company', targetId: co.id,
    field: 'industry', currentValue: null, proposedValue: '반도체 장비',
    confidence: 0.9, evidence: { quote: '반도체 장비 업종입니다' },
  })
  assert.equal(open.verdict.decision, 'AUTO_APPLIED', '자동 반영을 켰는데 안 들어갔다')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterAuto = await (db as any).crmCompany.findFirst({ where: { id: co.id }, select: { industry: true } })
  assert.equal(afterAuto.industry, '반도체 장비', '판정은 AUTO_APPLIED 인데 값이 안 들어갔다')

  // ② 값을 비우고 확정한 뒤 같은 제안 → 막힌다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).crmCompany.updateMany({ where: { id: co.id }, data: { industry: null } })
  await setFieldVerified(WS, ACTOR, 'company', co.id, 'industry', true)

  const locked = await createSuggestion(WS, ACTOR, {
    runId: run.id, axis: 'WHAT', targetType: 'company', targetId: co.id,
    field: 'industry', currentValue: null, proposedValue: '반도체 장비',
    confidence: 1, evidence: { quote: '반도체 장비 업종입니다' },
  })
  assert.equal(locked.verdict.decision, 'PENDING', '확정한 값을 AI 가 덮었다')
  assert.equal(locked.verdict.reason, 'FIELD_VERIFIED_BY_HUMAN')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterLock = await (db as any).crmCompany.findFirst({ where: { id: co.id }, select: { industry: true } })
  assert.equal(afterLock.industry, null, '확정했는데 값이 바뀌었다')
  await cleanup()
})

test('확정해도 제안은 온다 — 잠그는 것은 자동 반영이지 제안이 아니다', async () => {
  const co = await makeCompany('확정테스트회사')
  const run = await makeRun()
  await setFieldConfig(WS, ACTOR, 'company', 'industry', { autoApply: true, minConfidence: 0.7 })
  await setFieldVerified(WS, ACTOR, 'company', co.id, 'industry', true)

  const r = await createSuggestion(WS, ACTOR, {
    runId: run.id, axis: 'WHAT', targetType: 'company', targetId: co.id,
    field: 'industry', currentValue: null, proposedValue: '반도체 장비',
    confidence: 0.9, evidence: { quote: '근거' },
  })
  assert.ok(r.suggestion, '제안조차 안 만들었다 — 사람이 볼 기회가 사라진다')
  assert.equal(r.suggestion!.status, 'PENDING')
  await cleanup()
})

test('확정 변경이 감사에 남는다 — 누가 언제 잠갔는지 모르면 되돌릴 근거가 없다', async () => {
  const co = await makeCompany('확정테스트회사')
  await setFieldVerified(WS, ACTOR, 'company', co.id, 'industry', true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audit = await (db as any).crmAuditLog.findFirst({
    where: { action: 'field.verified', targetId: co.id },
  })
  assert.ok(audit)
  await cleanup()
})

test('끝난 뒤 전용 워크스페이스를 치운다', async () => {
  await cleanup()
  await dbA.$executeRawUnsafe(`DELETE FROM crm_workspace WHERE id = $1`, WS)
})
