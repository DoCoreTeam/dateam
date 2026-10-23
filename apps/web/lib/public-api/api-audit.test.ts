/**
 * API(에이전트) 쓰기 기록 보기 (P0158 I11)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
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

/*
 * 공개 쓰기 창구는 빠짐없이 기록된다 (P0162 I03b)
 * app/api/public/v1 아래 모든 route.ts 의 쓰기 메서드는 둘 중 하나여야 한다
 *   관문(lib/actions/dispatch.ts 의 dispatchPublicApi)을 그대로 내보내거나
 *   몸통이 withWriteAudit 을 지나고 그 안에서 authenticatePublicApi 를 부른다
 */
const V1 = join(WEB, 'app', 'api', 'public', 'v1')
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
const AUDIT_EXEMPT: Record<string, string> = {
  'quote/route.ts POST': '견적 계산만 한다, 저장하는 것이 없고 읽기 범위로 부른다',
}
/** 지금 센 쓰기 처리기 수, 걷기가 비면 통과하지 못하게 */
const MIN_WRITE_HANDLERS = 30
const MIN_AUDITED = 12

function v1Routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return v1Routes(p)
    return name === 'route.ts' ? [p] : []
  })
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

type Verdict = 'gateway' | 'audited' | 'exempt' | 'missing'

function judge(src: string, method: string, key: string): Verdict | null {
  if (key in AUDIT_EXEMPT) return 'exempt'
  const fromGateway = /from\s*['"]@\/lib\/actions\/dispatch['"]/.test(src)
  const reexport = src.match(new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`))
  if (reexport) return /lib\/actions\/dispatch|\[\.\.\.path\]\/route/.test(reexport[1]) ? 'gateway' : 'missing'
  const asConst = src.match(new RegExp(`export\\s+const\\s+${method}\\s*=\\s*(\\w+)`))
  if (asConst) {
    if (asConst[1] === 'dispatchPublicApi' && fromGateway) return 'gateway'
    if (asConst[1] === 'enter' && /const enter = \(request: NextRequest\) => dispatchPublicApi\(request\)/.test(src) && fromGateway) return 'gateway'
    return 'missing'
  }
  const at = src.search(new RegExp(`export\\s+async\\s+function\\s+${method}\\b`))
  if (at < 0) return null
  const rest = src.slice(at + 1)
  const next = rest.search(/\nexport\s/)
  const body = src.slice(at, next < 0 ? src.length : at + 1 + next)
  const wrapAt = body.search(/return withWriteAudit\('public\.[\w.-]+', async \(\) => \{/)
  const authAt = body.indexOf('authenticatePublicApi(')
  return wrapAt >= 0 && authAt > wrapAt && /\}\)\(request, undefined\)\s*\}\s*$/.test(body.trimEnd() + '\n') ? 'audited' : 'missing'
}

test('★ 공개 쓰기 창구는 관문을 내보내거나 withWriteAudit 을 지난다', () => {
  const files = v1Routes(V1)
  assert.ok(files.length >= 20, `공개 v1 창구를 ${files.length}개만 찾았다`)
  const counts: Record<Verdict, number> = { gateway: 0, audited: 0, exempt: 0, missing: 0 }
  const missing: string[] = []
  const names: string[] = []
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'))
    const rel = relative(V1, file)
    for (const method of WRITE_METHODS) {
      const key = `${rel} ${method}`
      const v = judge(src, method, key)
      if (!v) continue
      counts[v]++
      if (v === 'missing') missing.push(key)
    }
    names.push(...[...src.matchAll(/withWriteAudit\('([^']+)'/g)].map((m) => m[1]))
  }
  assert.deepEqual(missing, [], `기록 없이 쓰는 공개 창구 ${missing.length}개`)
  const total = counts.gateway + counts.audited + counts.exempt
  assert.ok(total >= MIN_WRITE_HANDLERS, `쓰기 처리기를 ${total}개만 찾았다, 걷기가 헛돈다`)
  assert.ok(counts.audited >= MIN_AUDITED, `withWriteAudit 을 지나는 처리기가 ${counts.audited}개뿐이다`)
  assert.equal(new Set(names).size, names.length, `감사 이름이 겹친다: ${names.join(' ')}`)
})

test('감사 면제 목록이 실제 처리기를 가리킨다', () => {
  for (const [key, reason] of Object.entries(AUDIT_EXEMPT)) {
    const [rel, method] = key.split(' ')
    const src = readFileSync(join(V1, rel), 'utf8')
    assert.match(src, new RegExp(`export async function ${method}\\(`), key)
    assert.doesNotMatch(src, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, `${key} 가 저장한다, 면제가 아니다`)
    assert.ok(reason.length > 10, `${key} 의 이유가 너무 짧다`)
  }
})
