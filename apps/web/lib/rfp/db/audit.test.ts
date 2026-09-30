/**
 * 감사 로그 가드
 *
 * 표도 정책도 있는데 **쓰는 곳이 하나도 없었다**(실측 2026-09-30: rfp_audit_logs 0행).
 * 여기서 세 가지를 잠근다 — 누가·무엇을·언제가 다 들어가나, 실패가 본 작업을 막지 않나,
 * 케이스를 만드는 **두 경로 모두**가 부르나.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recordAudit, type AuditDbClient } from './audit.ts'

const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function spy(error: unknown = null) {
  const rows: Record<string, unknown>[] = []
  const db: AuditDbClient = {
    from: () => ({
      insert: async (v: unknown) => { rows.push(v as Record<string, unknown>); return { error } },
    }),
  }
  return { db, rows }
}

test('누가 무엇을 어디에 했는지가 다 실린다', async () => {
  const { db, rows } = spy()
  const r = await recordAudit(db, {
    orgId: UUID_A, userId: UUID_B, action: 'case.create',
    targetType: 'case', targetId: UUID_A, detail: { via: 'manual' },
  })
  assert.equal(r.ok, true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].org_id, UUID_A)
  assert.equal(rows[0].user_id, UUID_B, '누가 한 일인지가 없다')
  assert.equal(rows[0].action, 'case.create', '무엇을 했는지가 없다')
  assert.equal(rows[0].target_id, UUID_A, '무엇에 했는지가 없다')
  assert.deepEqual(rows[0].detail, { via: 'manual' })
  // 언제는 표가 created_at 기본값으로 박는다 — 코드가 보내면 기기 시계를 믿는 것이 된다
  assert.ok(!('created_at' in rows[0]), '시각을 코드가 보내면 기기 시계를 믿는 것이 된다')
})

test('기계가 한 일은 사람을 지어내지 않는다', async () => {
  const { db, rows } = spy()
  await recordAudit(db, {
    orgId: UUID_A, userId: null, action: 'case.create', targetType: 'case', targetId: null,
  })
  assert.equal(rows[0].user_id, null)
  assert.equal(rows[0].target_id, null)
  assert.deepEqual(rows[0].detail, {}, 'detail 이 NOT NULL 이라 빈 객체라도 보내야 한다')
})

test('uuid 가 아닌 값은 안 싣는다', async () => {
  const { db, rows } = spy()
  await recordAudit(db, {
    orgId: UUID_A, userId: 'not-a-uuid', action: 'case.create',
    targetType: 'case', targetId: 'also-not',
  })
  // 칸이 uuid 라 아무 글자나 넣으면 줄 전체가 죽는다. 기록 한 줄 때문에 본 작업을 잃지 않는다
  assert.equal(rows[0].user_id, null)
  assert.equal(rows[0].target_id, null)
})

test('기록이 실패해도 던지지 않고 사유를 준다', async () => {
  const { db } = spy({ message: '정책 위반' })
  const r = await recordAudit(db, {
    orgId: UUID_A, userId: UUID_B, action: 'case.create', targetType: 'case', targetId: UUID_A,
  })
  assert.equal(r.ok, false)
  assert.match(String(r.reason), /정책 위반/, '조용히 넘어가는 것과 같아진다')
})

test('insert 가 던져도 잡아서 사유로 바꾼다', async () => {
  const db: AuditDbClient = {
    from: () => ({ insert: async () => { throw new Error('연결 끊김') } }),
  }
  const r = await recordAudit(db, {
    orgId: UUID_A, userId: null, action: 'case.create', targetType: null, targetId: null,
  })
  assert.equal(r.ok, false)
  assert.match(String(r.reason), /연결 끊김/)
})

test('케이스를 만드는 두 경로가 모두 기록한다', () => {
  // 한쪽만 적으면 「이 케이스는 어디서 왔지」에 답할 수 있는 케이스와 없는 케이스가 섞인다
  const manual = stripComments(readFileSync(
    new URL('../../../app/api/rfp/cases/route.ts', import.meta.url), 'utf8'))
  const adopt = stripComments(readFileSync(
    new URL('../intake/adopt-ports.ts', import.meta.url), 'utf8'))

  for (const [name, src] of [['사람이 직접 만드는 창구', manual], ['레이더·링크', adopt]] as const) {
    assert.match(src, /\brecordAudit\s*\(/, `${name} 가 감사 기록을 안 남긴다`)
    assert.match(src, /action:\s*'case\.create'/, `${name} 의 행위 이름이 없다`)
  }
})

test('감사 기록에 서비스롤을 쓰지 않는다', () => {
  // 서비스롤은 넣기 정책(org_id in rfp_my_orgs())을 지나간다.
  // 그러면 남의 조직 이름으로 기록을 심을 수 있고, 감사 로그가 감사의 대상이 된다
  const audit = stripComments(readFileSync(new URL('./audit.ts', import.meta.url), 'utf8'))
  assert.doesNotMatch(audit, /createAdminClient|service_role|SERVICE_ROLE/, '감사 모듈이 서비스롤을 든다')
})

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}
