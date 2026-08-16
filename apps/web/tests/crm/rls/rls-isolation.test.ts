/**
 * RLS 격리 검증 (dacrm T0-10)
 *
 * 완료 기준(TASKS): "2개 워크스페이스 시드, service role 에서 set_config 만으로 격리되는지"
 *
 * 그대로는 성립하지 않는다 — 이 DB 의 postgres 롤은 rolbypassrls = true 라
 * 정책을 아무리 잘못 써도 통과한다(T0-03 발견). 그래서 마이그레이션 200 이 만든
 * crm_rls_probe(NOLOGIN · NOBYPASSRLS)로 `SET LOCAL ROLE` 해서 확인한다.
 * 새 접속 경로를 만들지 않으므로 시크릿이 늘지 않는다.
 *
 * 여기서 검증하는 것은 **앱 가드가 아니라 DB 정책**이다.
 * 앱 가드(getCrmDb)는 T0-04·DI-09 가 검증한다. 두 벽은 각각 따로 서 있어야 한다 —
 * 앱 가드를 우회하는 경로(psql, 다른 서비스, 실수)가 생겨도 DB 가 남아 있어야 한다.
 *
 * 모든 쓰기는 트랜잭션 안에서 하고 마지막에 반드시 롤백한다(운영 DB).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

function dbUrl(): string {
  if (process.env.DIRECT_URL || process.env.DATABASE_URL) {
    return (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string
  }
  const path = join(import.meta.dirname, '..', '..', '..', '.env.local')
  const env: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  // pgbouncer 파라미터는 pg 드라이버가 모른다 — 떼고 쓴다
  return (env.DIRECT_URL ?? env.DATABASE_URL).split('?')[0]
}

const WS_A = 'ws_rls_a'
const WS_B = 'ws_rls_b'

/**
 * 두 워크스페이스를 시드하고, probe 롤로 갈아입은 뒤 fn 을 실행한다.
 * 끝나면 무조건 롤백한다.
 */
async function withTwoWorkspaces(
  fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString: dbUrl() })
  await client.connect()
  const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows
  try {
    await client.query('BEGIN')

    // 워크스페이스 2개 + 각각 회사 1건 (postgres 권한으로 심는다)
    for (const [ws, name] of [[WS_A, 'RLS A사'], [WS_B, 'RLS B사']]) {
      await q(
        `INSERT INTO "crm_workspace"("id","name","updatedAt") VALUES ($1,$2,now())`, [ws, ws])
      await q(
        `INSERT INTO "crm_company"("id","workspaceId","name","updatedAt")
         VALUES ($1,$2,$3,now())`, [`co_${ws}`, ws, name])
      await q(
        `INSERT INTO "crm_pipeline"("id","workspaceId","name") VALUES ($1,$2,$3)`,
        [`pl_${ws}`, ws, `${ws} 파이프라인`])
      await q(
        `INSERT INTO "crm_stage"("id","pipelineId","name","position") VALUES ($1,$2,'제안',1)`,
        [`st_${ws}`, `pl_${ws}`])
    }

    // 여기서부터 RLS 를 우회하지 않는 롤로 갈아입는다
    await client.query('SET LOCAL ROLE crm_rls_probe')
    await fn(q)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }
}

const count = async (q: any, table: string): Promise<number> =>
  Number((await q(`SELECT count(*)::int AS n FROM "${table}"`))[0].n)

test('T0-10 app.workspace_id 를 안 걸면 아무것도 안 보인다 (기본 거부)', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', '', true)`)
    assert.equal(await count(q, 'crm_company'), 0, '설정 없이 회사가 보인다')
    assert.equal(await count(q, 'crm_workspace'), 0)
    assert.equal(await count(q, 'crm_pipeline'), 0)
  })
})

test('T0-10 set_config 만으로 A 는 A 것만 본다', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_A])
    const rows = await q(`SELECT "id","name" FROM "crm_company" ORDER BY id`)
    assert.equal(rows.length, 1, `A 에게 ${rows.length}건이 보인다`)
    assert.equal(rows[0].id, `co_${WS_A}`)
    assert.equal(rows[0].name, 'RLS A사')
  })
})

test('T0-10 값만 바꾸면 B 것으로 갈아탄다 (같은 세션, 같은 쿼리)', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_B])
    const rows = await q(`SELECT "id" FROM "crm_company"`)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, `co_${WS_B}`)
  })
})

test('T0-10 남의 id 를 정확히 지정해도 안 보인다 (존재 여부 노출 금지)', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_A])
    const rows = await q(`SELECT "id" FROM "crm_company" WHERE "id" = $1`, [`co_${WS_B}`])
    assert.equal(rows.length, 0, 'id 를 직접 찍으니 남의 것이 보인다')
  })
})

test('T0-10 자식 테이블(스테이지)도 부모를 통해 격리된다', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_A])
    const rows = await q(`SELECT "id" FROM "crm_stage"`)
    assert.equal(rows.length, 1, `자식 테이블에 ${rows.length}건이 보인다`)
    assert.equal(rows[0].id, `st_${WS_A}`)
  })
})

test('T0-10 쓰기도 막힌다 — 남의 워크스페이스로는 INSERT 되지 않는다', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_A])
    let blocked = false
    try {
      await q(
        `INSERT INTO "crm_company"("id","workspaceId","name","updatedAt")
         VALUES ('co_steal', $1, '탈취', now())`, [WS_B])
    } catch (e: any) {
      blocked = /row-level security|정책|policy/i.test(String(e.message))
    }
    assert.ok(blocked, '남의 워크스페이스로 행이 들어갔다')
  })
})

test('T0-10 UPDATE 도 남의 행에 닿지 않는다', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_A])
    const rows = await q(
      `UPDATE "crm_company" SET "name" = '변조' WHERE "id" = $1 RETURNING "id"`, [`co_${WS_B}`])
    assert.equal(rows.length, 0, '남의 행이 갱신됐다')
  })
})

test('T0-10 DELETE 도 남의 행에 닿지 않는다', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_A])
    const rows = await q(`DELETE FROM "crm_company" WHERE "id" = $1 RETURNING "id"`, [`co_${WS_B}`])
    assert.equal(rows.length, 0, '남의 행이 삭제됐다')
  })
})

test('T0-10 환율은 워크스페이스와 무관하게 공용이다 (TENANT_FREE)', async () => {
  await withTwoWorkspaces(async (q) => {
    await q(`SELECT set_config('app.workspace_id', $1, true)`, [WS_A])
    // 정책이 USING(true) 라 조회 자체가 막히지 않아야 한다(행이 0건인 것과는 다른 문제)
    const rows = await q(`SELECT count(*)::int AS n FROM "crm_exchange_rate"`)
    assert.equal(typeof rows[0].n, 'number')
  })
})

test('T0-10 검증 롤은 로그인할 수 없고 RLS 를 우회하지 못한다', async () => {
  const client = new Client({ connectionString: dbUrl() })
  await client.connect()
  try {
    const { rows } = await client.query(
      `SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'crm_rls_probe'`)
    assert.equal(rows.length, 1, 'crm_rls_probe 롤이 없다 — 마이그레이션 200 을 확인할 것')
    assert.equal(rows[0].rolcanlogin, false, '로그인 가능한 롤이 되면 새 공격면이다')
    assert.equal(rows[0].rolbypassrls, false, 'BYPASSRLS 면 이 테스트 전체가 무의미하다')
  } finally {
    await client.end()
  }
})
