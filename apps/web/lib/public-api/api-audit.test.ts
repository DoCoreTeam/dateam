/**
 * API(에이전트) 쓰기 기록 보기 (P0158 I11)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditScope, clampLimit, toAuditEntry, API_AUDIT_MAX } from './api-audit.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p: string[]) => readFileSync(join(WEB, ...p), 'utf8')

test('★ 본인 기록만, 관리자는 전부', () => {
  assert.deepEqual(auditScope({ userId: 'u1', role: 'member' }), { userId: 'u1' })
  assert.deepEqual(auditScope({ userId: 'u1', role: null }), { userId: 'u1' })
  assert.equal(auditScope({ userId: 'u1', role: 'admin' }), null)
})

test('건수는 100을 안 넘고, 이상한 값은 기본값', () => {
  assert.equal(clampLimit('500'), API_AUDIT_MAX)
  assert.equal(clampLimit('x'), 50)
  assert.equal(clampLimit('-3'), 50)
  assert.equal(clampLimit('20'), 20)
})

test('기록 한 줄이 변경 이력 줄 모양이 된다', () => {
  const e = toAuditEntry({
    id: 7, key_id: 'k', user_id: 'u', agent: 'claude-code', request_id: 'r1', action_name: 'crm.deal.create',
    method: 'POST', path: '/crm/deals', status: 202, dry_run: false, approval_id: 'a1', created_at: '2026-10-23T00:00:00Z',
  })
  assert.equal(e.actorType, 'API')
  assert.equal(e.actorName, 'claude-code')
  assert.equal(e.summary, 'crm.deal.create 202 (approval)')
  assert.equal(e.id, 'api-7')
})

test('★ 변경 이력 API 탭과 키별 요청 창구가 본인 범위를 건다', () => {
  const audit = read('app', 'api', 'crm', 'audit', 'route.ts')
  assert.match(audit, /p\.get\('actorType'\) === 'API'\) return listApiAudit\(p\)/)
  assert.match(audit, /if \(scope\) q = q\.eq\('user_id', scope\.userId\)/)
  const req = read('app', 'api', 'user', 'api-keys', '[id]', 'requests', 'route.ts')
  assert.match(req, /auth\.getUser\(\)/)
  assert.match(req, /scope && key\.user_id !== scope\.userId/)
  assert.match(req, /\.limit\(API_AUDIT_MAX\)/)
  const client = read('app', '(crm)', 'crm', 'audit', 'AuditClient.tsx')
  assert.match(client, /\{ id: 'API', label: API_AUDIT\.tab \}/)
  const page = read('app', '(member)', 'api-keys', 'page.tsx')
  assert.match(page, /<KeyRequests keyId=/)
})
