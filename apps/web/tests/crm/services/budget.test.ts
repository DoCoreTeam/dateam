/**
 * 예산 서비스 — 실 DB 검증 (dacrm T1-07, DI-14·15)
 *
 * DI-14 테스트가 "잠그지 않으면 한도를 넘는다"를 pg 두 클라이언트로 증명한다면,
 * 여기서는 **서비스가 실제로 그 잠금을 쓰는가**와 명세 3.6 의 나머지 규칙을 본다.
 *
 * 특히 확인하는 것: 차단은 AI 만 멈추고 코어 CRM 은 계속 돌아야 한다(DI-15).
 * 예산이 떨어졌다고 회사를 못 만들면 그건 더 큰 손해다.
 *
 * **전용 워크스페이스를 만들어 쓴다.** 이 파일은 상한을 0 으로 만드는 시험을 하는데,
 * 실사용 워크스페이스를 쓰면 옆에서 병렬로 도는 AI 테스트가 그 순간 통째로 막힌다(실측).
 * 예산은 워크스페이스 단위 상태라서, 테스트도 워크스페이스로 갈라야 안 부딪힌다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dbA, catchError } from '../integrity/_helpers.ts'
import { getCrmDb } from '../../../lib/crm/db/client.ts'
import {
  reserveBudget, settleBudget, setBudgetLimit, getBudget,
  currentMonthKey, DEFAULT_LIMIT_MINOR_USD, BUDGET_BLOCKED_MESSAGE,
} from '../../../lib/crm/services/budget.ts'
import { createCompany, deleteCompany } from '../../../lib/crm/services/company.ts'
import { CrmError } from '../../../lib/crm/domain/errors.ts'

/** 이 파일 전용 워크스페이스 — 실사용과 부딪히지 않게 격리한다 */
const WS_B = 'ws_budget_test'
const dbB = getCrmDb(WS_B)
const MONTH = currentMonthKey()

async function reset(limit: bigint, spent: bigint = BigInt(0)) {
  await dbB.crmAiBudget.deleteMany({ where: { month: MONTH } })
  await dbB.crmAiBudget.create({
    data: { workspaceId: WS_B, month: MONTH, limitMinorUsd: limit, spentMinorUsd: spent },
  })
}

async function cleanup() {
  await dbB.crmAiBudget.deleteMany({ where: { month: MONTH } })
  await dbB.crmAuditLog.deleteMany({ where: { action: 'budget.limit_changed' } })
}

test('시작 전 준비 — 전용 워크스페이스를 만든다', async () => {
  await dbA.$executeRawUnsafe(
    `INSERT INTO crm_workspace (id, name, "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT (id) DO NOTHING`,
    WS_B, '예산 테스트 전용',
  )
  await cleanup()
})

// ------------------------------------------------------------
// 잠금 — DI-14 의 실제 구현이 여기 있는가
// ------------------------------------------------------------

test('★ 예산 조회가 FOR UPDATE 로 잠근다 — 없으면 동시 요청이 한도를 넘는다', async () => {
  // 이 검사가 정적인 이유: 잠금이 빠져도 순차 실행에서는 테스트가 통과한다(DI-14 에서 실측).
  // 그래서 "그 문장이 실제로 있는가"를 직접 본다.
  const src = await readFile(new URL('../../../lib/crm/services/budget.ts', import.meta.url), 'utf8')
  assert.match(src, /FOR UPDATE/, '잠금 없이 잔액을 읽으면 두 요청이 같은 값을 보고 둘 다 통과한다')
  assert.equal((src.match(/FOR UPDATE/g) ?? []).length >= 2, true, '조회 경로 전부가 잠가야 한다')
})

test('예산 행이 없으면 기본 상한으로 만들어 준다 — 설정 안 했다고 AI 가 무제한이면 안 된다', async () => {
  await dbB.crmAiBudget.deleteMany({ where: { month: MONTH } })
  const r = await reserveBudget(WS_B, BigInt(0))
  assert.equal(r.budget.limitMinorUsd, DEFAULT_LIMIT_MINOR_USD)
  await cleanup()
})

// ------------------------------------------------------------
// 차단 — 100% 도달
// ------------------------------------------------------------

test('★ DI-15 한도에 닿으면 AI 호출이 막히고, 사용자가 무엇을 할지 알려 준다', async () => {
  await reset(BigInt(100), BigInt(100))
  const e = await catchError(() => reserveBudget(WS_B, BigInt(10)))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'BUDGET_BLOCKED')
  assert.equal((e as CrmError).message, BUDGET_BLOCKED_MESSAGE)
  assert.match((e as CrmError).message, /설정에서 상한을 조정/, '무엇을 하면 되는지 말해야 한다')
  await cleanup()
})

test('★ DI-15 차단돼도 코어 CRM 은 계속 돌아간다 — 영업이 멈추면 더 큰 손해다', async () => {
  await reset(BigInt(100), BigInt(100))

  const co = await createCompany(WS_B, 'mb_owner', { name: '예산차단중 회사' })
  assert.ok(co.id, '예산이 떨어졌다고 회사를 못 만들면 안 된다')

  await deleteCompany(WS_B, 'mb_owner', co.id, 'purge')
  await dbB.crmAuditLog.deleteMany({ where: { targetId: co.id } })
  await cleanup()
})

test('차단 상태가 기록에 남는다 — 언제부터 막혔는지 알 수 있어야 한다', async () => {
  await reset(BigInt(100), BigInt(100))
  await catchError(() => reserveBudget(WS_B, BigInt(1)))
  const b = await dbB.crmAiBudget.findFirst({ where: { month: MONTH } })
  assert.ok(b?.blockedAt)
  await cleanup()
})

test('★ 선점하면 한도를 넘는 호출은 아예 보내지 않는다 — "넘으면 다음부터"는 사후 통보다', async () => {
  await reset(BigInt(100), BigInt(90)) // 잔여 10
  const e = await catchError(() => reserveBudget(WS_B, BigInt(50))) // 예상 50 → 140 이 된다
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'BUDGET_BLOCKED')

  const after = await dbB.crmAiBudget.findFirst({ where: { month: MONTH } })
  assert.equal(after?.spentMinorUsd, BigInt(90), '안 보낸 호출의 돈을 쓴 것으로 셌다')
  await cleanup()
})

test('잔여 안에 들어오는 호출은 그대로 통과한다 (과차단 방지)', async () => {
  await reset(BigInt(100), BigInt(90))
  const r = await reserveBudget(WS_B, BigInt(9))
  assert.equal(r.budget.spentMinorUsd, BigInt(99))
  await cleanup()
})

// ------------------------------------------------------------
// 경보 — 80% 1회
// ------------------------------------------------------------

test('80% 에 닿으면 경보 시각이 찍히고, 두 번 찍히지 않는다', async () => {
  await reset(BigInt(100), BigInt(0))

  await reserveBudget(WS_B, BigInt(80))
  const first = await dbB.crmAiBudget.findFirst({ where: { month: MONTH } })
  assert.ok(first?.alertSentAt, '80% 인데 경보가 없다')

  await reserveBudget(WS_B, BigInt(5))
  const second = await dbB.crmAiBudget.findFirst({ where: { month: MONTH } })
  assert.equal(second?.alertSentAt?.getTime(), first?.alertSentAt?.getTime(),
    '경보가 매번 다시 나가면 알림으로서 의미가 없다')
  await cleanup()
})

// ------------------------------------------------------------
// 선점과 정산
// ------------------------------------------------------------

test('예상 비용을 미리 잡고, 실제가 나오면 차액만 움직인다', async () => {
  await reset(BigInt(1000), BigInt(0))

  await reserveBudget(WS_B, BigInt(100)) // 예상 100 선점
  const mid = await dbB.crmAiBudget.findFirst({ where: { month: MONTH } })
  assert.equal(mid?.spentMinorUsd, BigInt(100))

  await settleBudget(WS_B, BigInt(100), BigInt(30)) // 실제는 30
  const after = await dbB.crmAiBudget.findFirst({ where: { month: MONTH } })
  assert.equal(after?.spentMinorUsd, BigInt(30))
  await cleanup()
})

test('정산이 두 번 들어와도 잔액이 늘어나지 않는다 (음수 방지)', async () => {
  await reset(BigInt(1000), BigInt(10))
  await settleBudget(WS_B, BigInt(100), BigInt(0))
  await settleBudget(WS_B, BigInt(100), BigInt(0))
  const after = await dbB.crmAiBudget.findFirst({ where: { month: MONTH } })
  assert.equal(after?.spentMinorUsd, BigInt(0), '쓴 돈이 마이너스가 되면 다음 달 예산이 부풀려진다')
  await cleanup()
})

// ------------------------------------------------------------
// 상한 조정 — 즉시 해제
// ------------------------------------------------------------

test('★ DI-15 상한을 올리면 즉시 풀린다 — 다음 호출까지 기다리게 하지 않는다', async () => {
  await reset(BigInt(100), BigInt(100))
  await catchError(() => reserveBudget(WS_B, BigInt(1)))

  const b = await setBudgetLimit(WS_B, 'mb_owner', BigInt(1000))
  assert.equal(b.blockedAt, null, '상한을 올렸는데 여전히 막혀 있다')

  // 이제 호출이 된다
  const r = await reserveBudget(WS_B, BigInt(10))
  assert.equal(r.verdict.level, 'ok')
  await cleanup()
})

test('상한을 내려서 이미 초과했으면 그 자리에서 막힌다', async () => {
  await reset(BigInt(1000), BigInt(500))
  const b = await setBudgetLimit(WS_B, 'mb_owner', BigInt(100))
  assert.ok(b.blockedAt, '한도를 이미 넘었는데 안 막혔다')

  const e = await catchError(() => reserveBudget(WS_B, BigInt(1)))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'BUDGET_BLOCKED')
  await cleanup()
})

test('상한 변경은 감사에 남는다 — 누가 언제 올렸는지 답할 수 있어야 한다', async () => {
  await reset(BigInt(100), BigInt(0))
  await setBudgetLimit(WS_B, 'mb_owner', BigInt(9999))
  const audit = await dbB.crmAuditLog.findFirst({ where: { action: 'budget.limit_changed' } })
  assert.ok(audit)
  assert.equal((audit!.afterJson as { limitMinorUsd: string }).limitMinorUsd, '9999')
  await cleanup()
})

test('음수 상한은 거절한다', async () => {
  const e = await catchError(() => setBudgetLimit(WS_B, 'mb_owner', BigInt(-1)))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'VALIDATION_FAILED')
})

test('상한 0 은 "AI 를 쓰지 않겠다" — 한 푼이라도 쓰면 막힌다', async () => {
  await reset(BigInt(0), BigInt(0))
  const e = await catchError(() => reserveBudget(WS_B, BigInt(1)))
  assert.ok(e instanceof CrmError)
  assert.equal((e as CrmError).code, 'BUDGET_BLOCKED')
  await cleanup()
})

// ------------------------------------------------------------
// 조회 — 화면이 읽는 값
// ------------------------------------------------------------

test('화면용 조회는 쓰기 없이 현재 상태를 준다', async () => {
  await reset(BigInt(1000), BigInt(850))
  const v = await getBudget(WS_B)
  assert.equal(v.limitMinorUsd, BigInt(1000))
  assert.equal(v.spentMinorUsd, BigInt(850))
  assert.equal(v.verdict.level, 'warn')
  assert.equal(v.month, MONTH)
  await cleanup()
})

test('예산을 한 번도 안 정한 워크스페이스도 조회에서 터지지 않는다', async () => {
  await dbB.crmAiBudget.deleteMany({ where: { month: MONTH } })
  const v = await getBudget(WS_B)
  assert.equal(v.limitMinorUsd, DEFAULT_LIMIT_MINOR_USD)
  assert.equal(v.spentMinorUsd, BigInt(0))
  await cleanup()
})

test('이번 달은 KST 기준이다 — UTC 로 자르면 매월 1일 오전이 지난달로 잡힌다', () => {
  // 2026-09-01 00:30 KST = 2026-08-31 15:30 UTC
  assert.equal(currentMonthKey(new Date('2026-08-31T15:30:00.000Z')), '2026-09')
  assert.equal(currentMonthKey(new Date('2026-08-31T14:30:00.000Z')), '2026-08')
})

// ------------------------------------------------------------
// 러너 배선 — 만들어 놓고 안 부르면 없는 것과 같다
// ------------------------------------------------------------

test('★ AI 러너가 예산을 실제로 부른다 — 배선이 빠지면 예산은 장식이다', async () => {
  const src = await readFile(new URL('../../../lib/crm/ai/runner.ts', import.meta.url), 'utf8')
  assert.match(src, /reserveBudget\(/, '러너가 예산 확인을 안 한다')
  assert.match(src, /settleBudget\(/, '러너가 정산을 안 한다')
})

test('★ 상한 0 이면 비용을 모르는 호출도 막힌다 — "AI 끄기"를 뚫으면 안 된다', async () => {
  await reset(BigInt(0), BigInt(0))
  // 러너가 넘기는 기본 선점(최소 1센트)으로 부른 것과 같은 상황
  const e = await catchError(() => reserveBudget(WS_B))
  assert.ok(e instanceof CrmError, '예상 비용을 안 주면 상한 0 을 지나간다')
  assert.equal((e as CrmError).code, 'BUDGET_BLOCKED')
  await cleanup()
})

test('끝난 뒤 전용 워크스페이스를 치운다', async () => {
  await cleanup()
  await dbA.$executeRawUnsafe(`DELETE FROM crm_workspace WHERE id = $1`, WS_B)
})
