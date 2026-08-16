/**
 * DI-12 제안 수락 — 필드 갱신·출처 기록·감사 3종이 한 트랜잭션에서 함께 일어난다
 * 근거: 통합기획서 947행 / 구현명세서 3.3 accept 처리 순서 / TASKS T1-06
 *
 * DI-13 이 "관문 판정 규칙"을 순수 함수로 검증한다면, DI-12 는 **실제 DB 에서
 * 그 판정이 값으로 이어지는가**를 본다. 규칙이 맞아도 배선이 틀리면 사용자에게는 같은 고장이다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dbA, WS_A, catchError } from './_helpers.ts'
import {
  createSuggestion, decideSuggestion, listSuggestions, expireSuggestions,
  SUGGESTION_TTL_DAYS,
} from '../../../lib/crm/services/suggestion.ts'
import { createCompany } from '../../../lib/crm/services/company.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

const MADE: { companies: string[]; runs: string[]; suggestions: string[] } = {
  companies: [], runs: [], suggestions: [],
}

async function cleanup() {
  const ids = [...MADE.companies, ...MADE.suggestions]
  if (ids.length) await dbA.crmAuditLog.deleteMany({ where: { targetId: { in: ids } } })
  await dbA.crmAiSuggestion.deleteMany({ where: { runId: { in: MADE.runs } } })
  if (MADE.runs.length) await dbA.crmAiRun.deleteMany({ where: { id: { in: MADE.runs } } })
  if (MADE.companies.length) {
    await dbA.crmCompany.deleteMany({ where: { id: { in: MADE.companies } } })
  }
  await dbA.crmAiFieldConfig.deleteMany({ where: { field: { startsWith: 'di12_' } } })
  MADE.companies = []
  MADE.runs = []
  MADE.suggestions = []
}

test('시작 전 잔여 정리', async () => {
  await dbA.crmAiRun.deleteMany({ where: { promptVersion: 'di12@test' } })
  await dbA.crmCompany.deleteMany({ where: { name: { startsWith: 'DI12 ' } } })
})

async function newRun(): Promise<string> {
  const run = await dbA.crmAiRun.create({
    data: {
      workspaceId: WS_A, kind: 'MEETING_EXTRACT', model: 'mock',
      promptVersion: 'di12@test', status: 'DONE', inputRef: {},
    },
    select: { id: true },
  })
  MADE.runs.push(run.id)
  return run.id
}

async function newCompany(name: string, patch: Record<string, unknown> = {}) {
  const c = await createCompany(WS_A, 'mb_owner', { name })
  MADE.companies.push(c.id)
  if (Object.keys(patch).length) {
    await dbA.crmCompany.update({ where: { id: c.id }, data: patch as never })
  }
  return c
}

const EVIDENCE = { quote: '저희는 제조업 쪽입니다', segmentIds: ['seg_1'] }

// ------------------------------------------------------------
// 제안 생성 — 관문 판정이 저장 여부를 가른다
// ------------------------------------------------------------

test('DI-12 근거 없는 제안은 만들 수 없다 — 판단할 재료가 없다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 근거없음')
  const e = await catchError(() => createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: {},
  }))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, /근거/)
  await cleanup()
})

test('DI-12 신뢰도 미달(0.6 미만)은 제안조차 저장하지 않는다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 저신뢰')
  const r = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.4, evidence: EVIDENCE,
  })
  assert.equal(r.suggestion, null)
  assert.equal(r.verdict.decision, 'DISCARD')

  const rows = await dbA.crmAiSuggestion.findMany({ where: { runId } })
  assert.equal(rows.length, 0, '인박스가 저신뢰 제안으로 차면 아무도 안 본다')
  await cleanup()
})

test('DI-12 자동 반영이 꺼져 있으면 값은 그대로고 제안만 쌓인다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 수동', { industry: 'IT' })
  const r = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.99, evidence: EVIDENCE,
  })
  assert.equal(r.suggestion?.status, 'PENDING')

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, 'IT', 'AI 가 코어 값을 직접 바꿨다')
  await cleanup()
})

test('★ DI-12 자동 반영이 켜져 있으면 값·상태·감사가 한꺼번에 남는다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 자동', { industry: 'IT' })
  await dbA.crmAiFieldConfig.create({
    data: { workspaceId: WS_A, targetType: 'company', field: 'industry', autoApply: true, minConfidence: 0.85 },
  })

  const r = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.95, evidence: EVIDENCE,
  })
  assert.equal(r.verdict.decision, 'AUTO_APPLIED')
  assert.equal(r.suggestion?.status, 'AUTO_APPLIED')

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, '제조', '자동 반영인데 값이 안 바뀌었다')

  const audit = await dbA.crmAuditLog.findFirst({
    where: { targetId: co.id, action: 'suggestion.auto_applied' },
  })
  assert.ok(audit, '자동 반영이 감사에 안 남았다')
  // 명세 3.3-4: 필드 단위 출처
  const src = (audit!.afterJson as Record<string, { source: string; runId: string; confidence: number }>).industry
  assert.equal(src.source, 'ai')
  assert.equal(src.runId, runId)
  assert.equal(src.confidence, 0.95)

  await dbA.crmAiFieldConfig.deleteMany({ where: { targetType: 'company', field: 'industry' } })
  await cleanup()
})

test('★ DI-13 사람이 확정한 필드는 autoApply 가 켜져 있어도 값이 안 바뀐다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 확정필드', { industry: 'IT', verifiedFields: ['industry'] })
  await dbA.crmAiFieldConfig.create({
    data: { workspaceId: WS_A, targetType: 'company', field: 'industry', autoApply: true, minConfidence: 0.5 },
  })

  const r = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 1.0, evidence: EVIDENCE,
  })
  assert.equal(r.verdict.decision, 'PENDING')
  assert.equal(r.verdict.reason, 'FIELD_VERIFIED_BY_HUMAN')

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, 'IT', '사람이 확정한 값을 AI 가 덮었다')

  await dbA.crmAiFieldConfig.deleteMany({ where: { targetType: 'company', field: 'industry' } })
  await cleanup()
})

// ------------------------------------------------------------
// 수락 — 값·상태·감사가 함께 움직인다
// ------------------------------------------------------------

test('★ DI-12 수락하면 필드 갱신·제안 상태·감사 3종이 함께 남는다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 수락', { industry: 'IT' })
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  const decided = await decideSuggestion(WS_A, 'mb_owner', suggestion!.id, { decision: 'accept' })

  assert.equal(decided.status, 'ACCEPTED')
  assert.ok(decided.decidedAt)
  assert.equal(decided.decidedById, 'mb_owner')

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, '제조')

  const applied = await dbA.crmAuditLog.findFirst({
    where: { targetId: co.id, action: 'suggestion.accepted' },
  })
  assert.ok(applied, '값 갱신 감사가 없다')

  const decidedAudit = await dbA.crmAuditLog.findFirst({
    where: { targetId: suggestion!.id, action: 'suggestion.accepted' },
  })
  assert.ok(decidedAudit, '판정 감사가 없다')
  await cleanup()
})

test('DI-12 사람이 고친 값이 제안값을 이긴다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 수정수락', { industry: 'IT' })
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  await decideSuggestion(WS_A, 'mb_owner', suggestion!.id, {
    decision: 'accept', editedValue: '정밀기계',
  })

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, '정밀기계')

  // 사람이 고쳐서 수락했다는 사실도 남는다(명세 3.3-5)
  const s = await dbA.crmAiSuggestion.findFirst({ where: { id: suggestion!.id } })
  assert.equal(s?.proposedValueJson, '정밀기계')
  await cleanup()
})

test('DI-12 거절하면 값은 그대로고 사유가 남는다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 거절', { industry: 'IT' })
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  const decided = await decideSuggestion(WS_A, 'mb_owner', suggestion!.id, {
    decision: 'reject', reason: '부정확',
  })
  assert.equal(decided.status, 'REJECTED')

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, 'IT')

  const audit = await dbA.crmAuditLog.findFirst({
    where: { targetId: suggestion!.id, action: 'suggestion.rejected' },
  })
  assert.equal((audit!.afterJson as { reason: string }).reason, '부정확')
  await cleanup()
})

test('★ DI-12 그 사이 사람이 값을 고쳤으면 수락이 멈춘다 (낙관적 잠금)', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 충돌', { industry: 'IT' })
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  // 화면이 version 1 을 들고 있는 사이 다른 사람이 고쳤다
  await dbA.crmCompany.update({
    where: { id: co.id }, data: { industry: '금융', version: { increment: 1 } },
  })

  const e = await catchError(() => decideSuggestion(WS_A, 'mb_owner', suggestion!.id, {
    decision: 'accept', version: co.version,
  }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'CONFLICT')

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, '금융', '충돌인데 AI 값이 덮었다')

  const s = await dbA.crmAiSuggestion.findFirst({ where: { id: suggestion!.id } })
  assert.equal(s?.status, 'PENDING', '실패했는데 제안이 수락으로 바뀌었다 (부분 반영)')
  await cleanup()
})

test('★ DI-12 금액·단계·성사는 수락으로도 못 바꾼다 — 함께 남아야 하는 기록이 있다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 금지필드')
  const deal = await dbA.crmDeal.findFirst({ where: { deletedAt: null } })
  if (!deal) { await cleanup(); return }

  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'RISK', targetType: 'deal', targetId: deal.id, field: 'amountMinor',
    proposedValue: 999, confidence: 0.99, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  const e = await catchError(() => decideSuggestion(WS_A, 'mb_owner', suggestion!.id, { decision: 'accept' }))
  assert.ok(e instanceof CrmError)
  assert.match((e as CrmError).message, /딜 화면에서 직접/)

  const after = await dbA.crmDeal.findFirst({ where: { id: deal.id } })
  assert.equal(after?.amountMinor, deal.amountMinor, 'AI 가 금액을 바꿨다')
  void co
  await cleanup()
})

test('DI-12 이미 판정한 제안은 다시 판정할 수 없다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 재판정', { industry: 'IT' })
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  await decideSuggestion(WS_A, 'mb_owner', suggestion!.id, { decision: 'accept' })
  const e = await catchError(() => decideSuggestion(WS_A, 'mb_owner', suggestion!.id, { decision: 'reject' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'INVALID_TRANSITION')
  await cleanup()
})

// ------------------------------------------------------------
// 만료 — 옛 사실이 오늘 반영되지 않게
// ------------------------------------------------------------

test('제안 유효기간은 7일이다 (명세 3.4)', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 만료기간')
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  const days = Math.round(
    (suggestion!.expiresAt.getTime() - suggestion!.createdAt.getTime()) / 86_400_000,
  )
  assert.equal(days, SUGGESTION_TTL_DAYS)
  await cleanup()
})

test('★ 만료된 제안은 수락할 수 없다 — 몇 주 전 값이 오늘 덮어쓰면 안 된다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 만료', { industry: 'IT' })
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  await dbA.crmAiSuggestion.update({
    where: { id: suggestion!.id }, data: { expiresAt: new Date(Date.now() - 1000) },
  })

  const e = await catchError(() => decideSuggestion(WS_A, 'mb_owner', suggestion!.id, { decision: 'accept' }))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'INVALID_TRANSITION')

  const after = await dbA.crmCompany.findFirst({ where: { id: co.id } })
  assert.equal(after?.industry, 'IT')
  await cleanup()
})

test('만료된 제안은 인박스에 뜨지 않는다 (상태 전환 전에도)', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 인박스')
  const { suggestion } = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(suggestion!.id)

  const before = await listSuggestions(dbA, { targetId: co.id })
  assert.equal(before.items.length, 1)

  await dbA.crmAiSuggestion.update({
    where: { id: suggestion!.id }, data: { expiresAt: new Date(Date.now() - 1000) },
  })
  const after = await listSuggestions(dbA, { targetId: co.id })
  assert.equal(after.items.length, 0)
  await cleanup()
})

test('만료 배치는 지난 PENDING 만 EXPIRED 로 옮긴다', async () => {
  const runId = await newRun()
  const co = await newCompany('DI12 배치')
  const old = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'industry',
    proposedValue: '제조', confidence: 0.9, evidence: EVIDENCE,
  })
  const fresh = await createSuggestion(WS_A, 'mb_owner', {
    runId, axis: 'WHAT', targetType: 'company', targetId: co.id, field: 'region',
    proposedValue: '부산', confidence: 0.9, evidence: EVIDENCE,
  })
  MADE.suggestions.push(old.suggestion!.id, fresh.suggestion!.id)

  await dbA.crmAiSuggestion.update({
    where: { id: old.suggestion!.id }, data: { expiresAt: new Date(Date.now() - 1000) },
  })

  const n = await expireSuggestions(WS_A)
  assert.ok(n >= 1)

  const a = await dbA.crmAiSuggestion.findFirst({ where: { id: old.suggestion!.id } })
  const b = await dbA.crmAiSuggestion.findFirst({ where: { id: fresh.suggestion!.id } })
  assert.equal(a?.status, 'EXPIRED')
  assert.equal(b?.status, 'PENDING', '만료 안 된 제안까지 치웠다')
  await cleanup()
})
