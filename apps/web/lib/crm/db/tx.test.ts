import test from 'node:test'
import assert from 'node:assert/strict'
import { withCrmTx, type TxCapableClient } from './tx.ts'
import { writeAudit, toAuditData } from './audit.ts'
import { CrmError } from '../domain/errors.ts'

const WS = 'ws_mine'

/**
 * 가짜 트랜잭션 클라이언트.
 * 실제 Postgres 처럼 동작시킨다: 콜백이 던지면 그 트랜잭션에서 일어난 쓰기를 전부 버린다.
 */
function makeFakeDb() {
  const calls: string[] = []
  const committed: Record<string, unknown>[] = []

  const client: TxCapableClient<any> = {
    async $transaction<R>(fn: (tx: any) => Promise<R>): Promise<R> {
      const staged: Record<string, unknown>[] = []
      const tx = {
        async $executeRawUnsafe(query: string, ...values: unknown[]) {
          calls.push(`raw:${query.trim()}|${values.join(',')}`)
          return 1
        },
        crmAuditLog: {
          async create(args: { data: Record<string, unknown> }) {
            calls.push('audit.create')
            staged.push(args.data)
            return args.data
          },
        },
        crmDeal: {
          async create(args: { data: Record<string, unknown> }) {
            calls.push('deal.create')
            staged.push(args.data)
            return args.data
          },
        },
      }
      try {
        const out = await fn(tx)
        committed.push(...staged) // COMMIT
        return out
      } catch (e) {
        throw e // ROLLBACK — staged 를 버린다
      }
    },
  }
  return { client, calls, committed }
}

// ------------------------------------------------------------
// 완료 기준 ①: 트랜잭션 내 set_config 확인
// ------------------------------------------------------------

test('업무 쓰기보다 먼저 set_config 를 호출한다', async () => {
  const { client, calls } = makeFakeDb()
  await withCrmTx(WS, async (tx: any) => {
    await tx.crmDeal.create({ data: { name: '딜' } })
  }, client)

  assert.equal(calls.length, 2)
  assert.ok(calls[0].startsWith('raw:'), '첫 호출이 set_config 가 아니다')
  assert.equal(calls[1], 'deal.create')
})

test('set_config 는 트랜잭션 로컬(세 번째 인자 true)로 건다', async () => {
  const { client, calls } = makeFakeDb()
  await withCrmTx(WS, async () => {}, client)
  const raw = calls[0]
  assert.match(raw, /set_config\('app\.workspace_id', \$1, true\)/,
    'true 가 아니면 세션 전역이 되어 풀에서 다음 요청이 남의 값을 물려받는다')
})

test('workspaceId 는 문자열 결합이 아니라 파라미터로 넘긴다', async () => {
  const { client, calls } = makeFakeDb()
  await withCrmTx(WS, async () => {}, client)
  const [query, values] = calls[0].slice(4).split('|')
  assert.equal(values, WS, 'workspaceId 가 바인딩 값으로 전달되지 않았다')
  assert.equal(query.includes(WS), false, 'workspaceId 가 SQL 문자열에 박혀 있다')
})

test('workspaceId 가 비면 트랜잭션을 열기 전에 던진다', async () => {
  const { client, calls } = makeFakeDb()
  await assert.rejects(
    () => withCrmTx('', async () => {}, client),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
  assert.equal(calls.length, 0, '빈 트랜잭션이 열렸다')
})

test('콜백의 반환값을 그대로 돌려준다', async () => {
  const { client } = makeFakeDb()
  const out = await withCrmTx(WS, async () => ({ id: 'd1' }), client)
  assert.deepEqual(out, { id: 'd1' })
})

// ------------------------------------------------------------
// 완료 기준 ②: 실패 시 audit 도 롤백
// ------------------------------------------------------------

test('업무 쓰기 후 예외가 나면 그 앞의 audit 도 커밋되지 않는다', async () => {
  const { client, committed } = makeFakeDb()
  await assert.rejects(
    () => withCrmTx(WS, async (tx: any) => {
      await tx.crmDeal.create({ data: { name: '딜' } })
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId: 'm1',
        action: 'deal.created', targetType: 'deal', targetId: 'd1',
      })
      throw new Error('업무 로직 실패')
    }, client),
    /업무 로직 실패/,
  )
  assert.equal(committed.length, 0, 'audit 또는 업무 쓰기가 살아남았다')
})

test('audit 기록이 실패하면 업무 쓰기도 커밋되지 않는다', async () => {
  const { client, committed } = makeFakeDb()
  await assert.rejects(
    () => withCrmTx(WS, async (tx: any) => {
      await tx.crmDeal.create({ data: { name: '딜' } })
      tx.crmAuditLog.create = async () => { throw new Error('audit 실패') }
      await writeAudit(tx, {
        actorType: 'HUMAN', action: 'deal.created', targetType: 'deal', targetId: 'd1',
      })
    }, client),
    /audit 실패/,
  )
  assert.equal(committed.length, 0, '업무 쓰기만 남았다 — 감사 없는 변경이 생긴다')
})

test('정상 종료면 업무 쓰기와 audit 이 함께 커밋된다', async () => {
  const { client, committed } = makeFakeDb()
  await withCrmTx(WS, async (tx: any) => {
    await tx.crmDeal.create({ data: { name: '딜' } })
    await writeAudit(tx, {
      actorType: 'HUMAN', action: 'deal.created', targetType: 'deal', targetId: 'd1',
    })
  }, client)
  assert.equal(committed.length, 2)
})

// ------------------------------------------------------------
// audit 헬퍼
// ------------------------------------------------------------

test('writeAudit 은 넘겨받은 tx 를 쓴다 (별도 클라이언트 금지)', async () => {
  const { client, calls } = makeFakeDb()
  await withCrmTx(WS, async (tx: any) => {
    await writeAudit(tx, {
      actorType: 'AI', actorId: 'run_1',
      action: 'suggestion.auto_applied', targetType: 'deal', targetId: 'd1',
    })
  }, client)
  assert.deepEqual(calls.map((c) => c.split(':')[0]), ['raw', 'audit.create'])
})

test('audit 데이터에 workspaceId 를 직접 넣지 않는다 (가드가 주입한다)', () => {
  const data = toAuditData({
    actorType: 'HUMAN', action: 'deal.created', targetType: 'deal', targetId: 'd1',
  })
  assert.equal('workspaceId' in data, false,
    '두 곳에서 값이 정해지면 어긋날 자리가 생긴다')
})

test('생략한 필드는 undefined 가 아니라 null 로 채운다', () => {
  const data = toAuditData({
    actorType: 'SYSTEM', action: 'job.ran', targetType: 'meeting', targetId: 'm1',
  })
  assert.equal(data.actorId, null)
  assert.equal(data.beforeJson, null)
  assert.equal(data.afterJson, null)
})

test('before/after 스냅샷을 그대로 싣는다 (되돌리기 근거)', () => {
  const data = toAuditData({
    actorType: 'HUMAN', action: 'deal.stage_moved', targetType: 'deal', targetId: 'd1',
    beforeJson: { stageId: 's1' }, afterJson: { stageId: 's2' },
  })
  assert.deepEqual(data.beforeJson, { stageId: 's1' })
  assert.deepEqual(data.afterJson, { stageId: 's2' })
})
