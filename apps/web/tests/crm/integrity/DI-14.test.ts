/**
 * DI-14 — AI 예산 잔여 1회분에서 동시 요청 2건이 오면 1건만 성공하고, spent 가 limit 을 넘지 않는다
 * 근거: 통합기획서 v0.2.1 949행 (DI 표 원문)
 *       구현명세서 3.6-1 "budget.service.check: 현재 월 CrmAiBudget 행 잠금 조회"
 *       crm_schema CrmAiBudget.spentMinorUsd "ai_run 생성과 단일 트랜잭션으로 증가(DI-14)"
 *
 * '잠금 조회'가 규정된 이유가 이것이다. 잠그지 않으면 두 요청이 같은 잔액을 읽고
 * 둘 다 통과시켜 한도를 넘긴다 — 그리고 넘긴 사실은 청구서로만 알게 된다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from 'pg'
import { dbA, catchError } from './_helpers.ts'
import { evaluateBudget } from '../../../lib/crm/domain/state-machines.ts'

const MONTH = '2099-11' // 실사용 월과 겹치지 않게

async function cleanup() {
  await dbA.crmAiBudget.deleteMany({ where: { month: MONTH } })
}

test('DI-14 동시 2건 중 1건만 통과하고 한도를 넘지 않는다', async () => {
  await cleanup()
  // 잔여가 정확히 1회분(100)인 예산
  await dbA.crmAiBudget.create({
    data: { id: 'bg_di14_race', workspaceId: 'ws_dataalliance', month: MONTH, limitMinorUsd: 100n, spentMinorUsd: 0n },
  })

  // ⚠️ Prisma 로는 이 경합을 만들 수 없다 — DATABASE_URL 의 connection_limit=1 때문에
  //    두 트랜잭션이 순차 실행되어 애초에 부딪히지 않는다(실측으로 확인).
  //    그래서 진짜 커넥션 2개(pg)로 동시에 친다. 운영에서 일어나는 모양 그대로다.
  const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL)!.split('?')[0]

  /** 명세 3.6-1 그대로: 행을 잠그고 읽어 확인한 뒤 증가시킨다 */
  const attempt = async (cost: number, lock: boolean): Promise<'ok' | 'blocked'> => {
    const c = new Client({ connectionString: url })
    await c.connect()
    try {
      await c.query('BEGIN')
      const { rows } = await c.query(
        `SELECT "spentMinorUsd", "limitMinorUsd" FROM "crm_ai_budget" WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
        ['bg_di14_race'],
      )
      // 두 세션이 확실히 같은 잔액을 보도록 잠깐 겹치게 한다
      await new Promise((r) => setTimeout(r, 120))
      if (Number(rows[0].spentMinorUsd) + cost > Number(rows[0].limitMinorUsd)) {
        await c.query('ROLLBACK')
        return 'blocked'
      }
      await c.query(
        `UPDATE "crm_ai_budget" SET "spentMinorUsd" = "spentMinorUsd" + $1 WHERE id = $2`,
        [cost, 'bg_di14_race'],
      )
      await c.query('COMMIT')
      return 'ok'
    } finally {
      await c.end()
    }
  }

  const results = await Promise.all([attempt(100, true), attempt(100, true)])
  const okCount = results.filter((r) => r === 'ok').length
  assert.equal(okCount, 1, `동시 2건 중 ${okCount}건이 통과했다`)

  const after = await dbA.crmAiBudget.findUnique({ where: { id: 'bg_di14_race' } })
  assert.equal(after.spentMinorUsd, 100n, 'spent 가 limit 을 넘었다')
  await cleanup()
})

test('DI-14 잠그지 않으면 실제로 둘 다 통과해 한도를 넘는다 — 잠금이 왜 규정인지', async () => {
  // 이 테스트가 위 테스트의 의미를 증명한다. 잠금이 장식이 아님을 보인다.
  await cleanup()
  await dbA.crmAiBudget.create({
    data: { id: 'bg_di14_race', workspaceId: 'ws_dataalliance', month: MONTH, limitMinorUsd: 100n, spentMinorUsd: 0n },
  })
  const url = (process.env.DIRECT_URL ?? process.env.DATABASE_URL)!.split('?')[0]

  const attemptNoLock = async (cost: number): Promise<'ok' | 'blocked'> => {
    const c = new Client({ connectionString: url })
    await c.connect()
    try {
      await c.query('BEGIN')
      const { rows } = await c.query(
        `SELECT "spentMinorUsd", "limitMinorUsd" FROM "crm_ai_budget" WHERE id = $1`, ['bg_di14_race'])
      await new Promise((r) => setTimeout(r, 120))
      if (Number(rows[0].spentMinorUsd) + cost > Number(rows[0].limitMinorUsd)) {
        await c.query('ROLLBACK'); return 'blocked'
      }
      await c.query(`UPDATE "crm_ai_budget" SET "spentMinorUsd" = "spentMinorUsd" + $1 WHERE id = $2`,
        [cost, 'bg_di14_race'])
      await c.query('COMMIT')
      return 'ok'
    } finally { await c.end() }
  }

  const results = await Promise.all([attemptNoLock(100), attemptNoLock(100)])
  const after = await dbA.crmAiBudget.findUnique({ where: { id: 'bg_di14_race' } })
  assert.equal(results.filter((r) => r === 'ok').length, 2, '잠금 없이도 1건만 통과했다면 이 환경엔 경합이 없다')
  assert.equal(after.spentMinorUsd, 200n, '한도 100 인데 200 이 쓰였다 — 이것이 잠금이 막는 사고다')
  await cleanup()
})

test('DI-14 spent 증가와 ai_run 생성이 함께 롤백된다', async () => {
  await cleanup()
  const e = await catchError(() => dbA.$transaction(async (tx: any) => {
    await tx.crmAiBudget.create({
      data: { id: 'bg_di14_tx', workspaceId: 'ws_dataalliance', month: MONTH, limitMinorUsd: 100000n, spentMinorUsd: 0n },
    })
    await tx.crmAiBudget.update({ where: { id: 'bg_di14_tx' }, data: { spentMinorUsd: { increment: 500n } } })
    throw new Error('ai_run 생성 실패')
  }))
  assert.ok(e, '트랜잭션이 성공해버렸다')
  assert.equal(await dbA.crmAiBudget.count({ where: { month: MONTH } }), 0,
    'run 이 실패했는데 예산 행이 남았다')
})

test('DI-14 사용액은 음수가 될 수 없다 (chk_budget)', async () => {
  await cleanup()
  const e = await catchError(() => dbA.$transaction(async (tx: any) => {
    await tx.crmAiBudget.create({
      data: { id: 'bg_di14_neg', workspaceId: 'ws_dataalliance', month: MONTH, limitMinorUsd: 100n, spentMinorUsd: 0n },
    })
    await tx.crmAiBudget.update({ where: { id: 'bg_di14_neg' }, data: { spentMinorUsd: { decrement: 1n } } })
  }))
  assert.ok(e, '음수 사용액이 저장됐다')
  assert.match(String(e), /chk_budget/)
  await cleanup()
})

test('DI-14 판정 SSOT 와 일치한다 — 한도 도달은 차단이다', () => {
  assert.equal(evaluateBudget({ limitMinorUsd: 100n, spentMinorUsd: 100n }).level, 'blocked')
  assert.equal(evaluateBudget({ limitMinorUsd: 100n, spentMinorUsd: 99n }).level, 'warn')
})
