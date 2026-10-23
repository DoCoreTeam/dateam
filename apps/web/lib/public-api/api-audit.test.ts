/**
 * API(에이전트) 쓰기 기록 보기 (P0158 I11)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditScope, clampLimit, toAuditEntry, API_AUDIT_MAX,
  agentOf, ipOf, rememberIdentity, identityOf, writeAuditRow,
} from './api-audit.ts'

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

/* 예전 공개 쓰기 창구 감사 장치 (P0162 I03) */

test('부른 쪽 이름은 x-agent 가 먼저, 200자에서 자르고 없으면 null', () => {
  assert.equal(agentOf(new Headers({ 'x-agent': 'claude-code', 'user-agent': 'curl/8' })), 'claude-code')
  assert.equal(agentOf(new Headers({ 'user-agent': 'curl/8' })), 'curl/8')
  assert.equal(agentOf(new Headers({ 'x-agent': 'a'.repeat(300) }))?.length, 200)
  assert.equal(agentOf(new Headers()), null)
  assert.equal(agentOf(new Headers({ 'x-agent': '' })), null)
})

test('주소는 x-forwarded-for 첫 값, 없으면 x-real-ip, 둘 다 없으면 null', () => {
  assert.equal(ipOf(new Headers({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8', 'x-real-ip': '9.9.9.9' })), '1.2.3.4')
  assert.equal(ipOf(new Headers({ 'x-real-ip': '9.9.9.9' })), '9.9.9.9')
  assert.equal(ipOf(new Headers()), null)
})

test('★ 신원은 같은 요청 객체에서만 보이고 WeakMap 에 둔다', () => {
  const req = {}
  const other = {}
  rememberIdentity(req, { keyId: 'k1', userId: 'u1' })
  assert.deepEqual(identityOf(req), { keyId: 'k1', userId: 'u1' })
  assert.equal(identityOf(other), null)
  const src = read('lib', 'public-api', 'api-audit.ts')
  assert.match(src, /const identities = new WeakMap</)
  assert.doesNotMatch(src, /new Map</)
})

test('★ 쓰기 기록 한 줄의 값, 본문과 키 값은 없다', () => {
  const row = writeAuditRow({
    identity: { keyId: 'k1', userId: 'u1' },
    name: 'public.settings.patch',
    method: 'PATCH',
    url: 'https://ax.example/api/public/v1/settings?x=1',
    headers: new Headers({ 'x-api-key': 'ax_live_secret', 'x-agent': 'claude-code', 'x-forwarded-for': '1.2.3.4' }),
    status: 200,
    requestId: 'r1',
  })
  assert.deepEqual(row, {
    key_id: 'k1', user_id: 'u1', agent: 'claude-code', ip: '1.2.3.4', request_id: 'r1',
    action_name: 'public.settings.patch', method: 'PATCH', path: '/api/public/v1/settings',
    status: 200, dry_run: false, approval_id: null,
  })
  for (const k of ['key', 'key_hash', 'api_key', 'body']) assert.equal(k in row, false, k)
  assert.equal(JSON.stringify(row).includes('ax_live_secret'), false)
})

test('★ 인증은 키와 계정을 다 확인한 뒤에만 신원을 남긴다', () => {
  const src = read('lib', 'publicApiAuth.ts')
  const fn = src.slice(src.indexOf('export async function authenticatePublicApi'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2)
  const calls = body.match(/rememberIdentity\(/g) ?? []
  assert.equal(calls.length, 1)
  const at = body.indexOf('rememberIdentity(request, { keyId: key.id, userId: key.user_id })')
  assert.ok(at > 0)
  // 폐기와 계정 확인보다 뒤, 만료 범위 한도 판정보다 앞 (거절된 쓰기 시도도 기록되게)
  assert.ok(at > body.indexOf("'폐기된 API 키"), '폐기 확인보다 뒤')
  assert.ok(at > body.indexOf("'이 키를 발급한 계정"), '계정 확인보다 뒤')
  assert.ok(at < body.indexOf("'만료된 API 키"), '만료 판정보다 앞')
  assert.ok(at < body.indexOf('Retry-After'), '한도 판정보다 앞')
  assert.ok(body.indexOf('return { ctx }') > at)
  assert.doesNotMatch(body, /rememberIdentity\([^)]*(hash|authHeader|rawKey)/)
})

test('관문도 같은 꺼내기 함수를 쓴다', () => {
  const src = read('lib', 'actions', 'dispatch.ts')
  assert.match(src, /import \{ agentOf, ipOf \} from '@\/lib\/public-api\/api-audit'/)
  assert.doesNotMatch(src, /function agentOf|function ipOf/)
  assert.match(src, /agent: agentOf\(request\.headers\), ip: ipOf\(request\.headers\)/)
})

test('★ 감사 장치는 서버 전용이고 응답 상태와 함께 넣되 본문을 안 읽는다', () => {
  const src = read('lib', 'public-api', 'write-audit.ts')
  assert.match(src, /^import 'server-only'/m)
  assert.match(src, /\} finally \{\s*await insertAudit\(name, request, status\)/)
  assert.match(src, /status = response\.status/)
  assert.match(src, /let status = 500/)
  assert.match(src, /from\('api_write_audit'\)\.insert\(row\)/)
  assert.match(src, /const identity = identityOf\(request\)\s*if \(!identity\) return/)
  assert.doesNotMatch(src, /\bbody\b|\.text\(\)|\.json\(\)|x-api-key|authorization/i)
})
