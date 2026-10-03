/**
 * 활동 목록 조회 — **조건과 커서가 서로를 덮지 않는다**
 *
 * 왜 생겼나: 활동 421건을 목록으로 보는 화면이 생기면서 조회에 조건 셋(종류·담당자·기간)과
 * 전체 건수 셈이 더해졌다. 기간과 커서가 같은 칸(`occurredAt`)을 쓰므로 한쪽이 다른 쪽을
 * 덮으면 조용히 틀린다 — 「9월만 보기」가 다음 쪽에서 9월을 넘어가거나, 「더 보기」를
 * 누를 때마다 전체 건수가 줄어드는 식이다. 그 둘을 여기서 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listActivities } from './activity.ts'

/** 질의를 받아 적는 가짜 DB. 돌려주는 값보다 **무엇을 물었나**가 중요하다 */
function spyDb(rows: unknown[] = [], count = 0) {
  const seen: { findMany: Record<string, unknown>[]; count: Record<string, unknown>[] } = { findMany: [], count: [] }
  return {
    seen,
    db: {
      crmActivity: {
        findMany: async (args: Record<string, unknown>) => { seen.findMany.push(args); return rows },
        count: async (args: Record<string, unknown>) => { seen.count.push(args); return count },
      },
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any

test('종류·담당자 조건이 그대로 질의에 들어간다', async () => {
  const { db, seen } = spyDb()
  await listActivities(anyDb(db), { types: 'NOTE,CALL', createdById: 'm_1' })
  const where = seen.findMany[0].where as Record<string, unknown>
  assert.deepEqual(where.type, { in: ['NOTE', 'CALL'] })
  assert.equal(where.createdById, 'm_1')
})

test('모르는 종류는 조용히 넘기지 않는다', async () => {
  const { db } = spyDb()
  await assert.rejects(() => listActivities(anyDb(db), { types: 'NOTE,TELEPATHY' }), /활동 종류/)
})

test('★ 기간은 KST 로 자르고 끝 날짜를 포함한다', async () => {
  const { db, seen } = spyDb()
  await listActivities(anyDb(db), { from: '2026-09-01', to: '2026-09-30' })
  const at = (seen.findMany[0].where as { occurredAt: { gte: Date; lt: Date } }).occurredAt
  assert.equal(at.gte.toISOString(), '2026-08-31T15:00:00.000Z', '9월 1일 0시 KST 다')
  assert.equal(at.lt.toISOString(), '2026-09-30T15:00:00.000Z', '10월 1일 0시 KST 직전까지 — 9월 30일이 들어간다')
})

test('★ 커서와 끝 날짜가 같이 오면 더 이른 쪽이 이긴다', async () => {
  /*
    덮어쓰면 다음 쪽이 고른 기간을 넘어간다. 「9월만」이라고 걸어 놓고 더 보기를 누르면
    8월 것이 섞여 나오는데, 화면은 여전히 「9월」이라고 적혀 있다.
  */
  const { db, seen } = spyDb()
  await listActivities(anyDb(db), { from: '2026-09-01', to: '2026-09-30', before: '2026-09-10T00:00:00.000Z' })
  const at = (seen.findMany[0].where as { occurredAt: { gte: Date; lt: Date } }).occurredAt
  assert.equal(at.lt.toISOString(), '2026-09-10T00:00:00.000Z', '커서가 더 이르므로 커서가 이긴다')

  const second = spyDb()
  await listActivities(anyDb(second.db), { from: '2026-09-01', to: '2026-09-30', before: '2026-11-01T00:00:00.000Z' })
  const at2 = (second.seen.findMany[0].where as { occurredAt: { lt: Date } }).occurredAt
  assert.equal(at2.lt.toISOString(), '2026-09-30T15:00:00.000Z', '커서가 기간 밖이면 기간이 이긴다')
})

test('★ 전체 건수는 커서를 빼고 센다', async () => {
  /*
    커서까지 넣고 세면 「더 보기」를 누를 때마다 전체 수가 줄어 「421건 중 50건」이
    「371건 중 50건」이 된다. 전체란 조건에 걸린 전부이고, 어디까지 읽었는지와 무관하다.
  */
  const { db, seen } = spyDb([], 421)
  const page = await listActivities(anyDb(db), {
    from: '2026-09-01', to: '2026-09-30', before: '2026-09-10T00:00:00.000Z', withTotal: true,
  })
  assert.equal(page.total, 421)
  const countWhere = seen.count[0].where as { occurredAt: { gte: Date; lt: Date } }
  assert.equal(countWhere.occurredAt.lt.toISOString(), '2026-09-30T15:00:00.000Z', '셈에 커서가 섞였다')
  assert.equal(countWhere.occurredAt.gte.toISOString(), '2026-08-31T15:00:00.000Z')
})

test('전체 건수를 안 켜면 세지 않고 null 이다 — 0 이 아니다', async () => {
  const { db, seen } = spyDb([], 999)
  const page = await listActivities(anyDb(db), {})
  assert.equal(page.total, null, '0 으로 주면 화면이 「0건 중」이라고 적는다')
  assert.equal(seen.count.length, 0, '안 켰는데 셈이 돌면 목록마다 질의가 한 번 더 간다')
})

test('기간을 안 주면 occurredAt 조건 자체가 없다', async () => {
  const { db, seen } = spyDb()
  await listActivities(anyDb(db), { types: 'NOTE' })
  assert.equal('occurredAt' in (seen.findMany[0].where as object), false)
})
