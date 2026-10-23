/**
 * 키 범위와 만료 (P0158 I04)
 *
 * 실제 권한 = 계정 권한 ∩ 키 범위, 만료된 키는 403
 * 기존 공개 창구가 요구하는 범위가 기능 정의 표의 범위와 같은지도 본다
 * (정의는 read 라는데 창구가 write 를 요구하면 CLI 와 문서가 거짓말을 한다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideKeyAccess, effectiveScopes, parseScopes, scopeForMethod, isExpired } from './scopes.ts'
import { ALL_DEFS } from '../actions/defs/index.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOW = new Date('2026-10-23T00:00:00Z')

test('만료된 키는 범위와 상관없이 403 expired', () => {
  const r = decideKeyAccess({ role: 'admin', scopes: ['read', 'admin'], expiresAt: '2026-10-22T23:59:59Z', required: 'read', now: NOW })
  assert.deepEqual(r, { ok: false, status: 403, code: 'expired' })
  assert.equal(isExpired(null, NOW), false, '만료일 없는 옛 키는 만료가 아니다')
  assert.equal(isExpired('2026-10-24T00:00:00Z', NOW), false)
})

test('read 키로 settings PATCH(admin) 를 부르면 403 과 requiredScope admin', () => {
  const r = decideKeyAccess({ role: 'admin', scopes: ['read'], expiresAt: null, required: 'admin', now: NOW })
  assert.deepEqual(r, { ok: false, status: 403, code: 'scope', requiredScope: 'admin' })
})

test('실제 권한은 계정 권한 ∩ 키 범위다', () => {
  // 키에 admin 이 있어도 계정이 member 면 admin 은 없다
  assert.deepEqual(effectiveScopes('member', ['read', 'admin']), ['read'])
  // 외부용 api_user 는 delete send approve 를 가질 수 없다
  assert.deepEqual(effectiveScopes('api_user', ['read', 'write', 'delete', 'send']), ['read', 'write'])
  // 관리자 계정도 키가 read 뿐이면 read 뿐이다
  assert.deepEqual(effectiveScopes('admin', ['read']), ['read'])
  // 모르는 역할은 read 만
  assert.deepEqual(effectiveScopes('ghost', ['read', 'write']), ['read'])

  const denied = decideKeyAccess({ role: 'member', scopes: ['admin', 'read'], expiresAt: null, required: 'admin', now: NOW })
  assert.equal(denied.ok, false)
  const ok = decideKeyAccess({ role: 'admin', scopes: ['admin', 'read'], expiresAt: null, required: 'admin', now: NOW })
  assert.deepEqual(ok, { ok: true, scopes: ['admin', 'read'] })
})

test('DB 범위 값이 비거나 모르는 값이면 read 만 남는다', () => {
  assert.deepEqual(parseScopes(undefined), ['read'])
  assert.deepEqual(parseScopes([]), ['read'])
  assert.deepEqual(parseScopes(['root', 'write']), ['write'])
  assert.deepEqual(parseScopes(['read', 'read']), ['read'])
})

test('창구가 범위를 안 정하면 메서드가 정한다 (닫힌 쪽이 기본)', () => {
  assert.equal(scopeForMethod('GET'), 'read')
  assert.equal(scopeForMethod('post'), 'write')
  assert.equal(scopeForMethod('PATCH'), 'write')
  assert.equal(scopeForMethod('DELETE'), 'delete')
})

/** 라우트 파일 한 메서드의 몸통 */
function methodBody(src: string, method: string): string | null {
  const start = src.indexOf(`export async function ${method}(`)
  if (start < 0) return null
  const next = src.indexOf('export async function', start + 10)
  return src.slice(start, next < 0 ? src.length : next)
}

/** 그 메서드가 요구하는 범위, 인증 호출에 scope 가 없으면 메서드 기본값 */
function requiredOf(body: string, method: string): string {
  const m = body.match(/authenticatePublicApi\(request,\s*\{\s*scope:\s*'(\w+)'/)
  return m ? m[1] : scopeForMethod(method)
}

test('★ 기존 공개 창구가 요구하는 범위 = 기능 정의 표의 범위', () => {
  const rows = ALL_DEFS.filter((d) => /^\w+ \/api\/public\/v1\//.test(d.op) && !d.op.includes('openapi.json'))
  assert.ok(rows.length >= 20, `공개 v1 정의를 ${rows.length}개만 찾았다`)
  const wrong: string[] = []
  for (const d of rows) {
    const [method, path] = d.op.split(' ')
    const dir = path.replace('/api/public/v1/', '').replace(/\{(\w+)\}/g, '[$1]')
    const file = join(WEB, 'app', 'api', 'public', 'v1', dir, 'route.ts')
    if (!existsSync(file)) { wrong.push(`${d.op} 파일 없음`); continue }
    const body = methodBody(readFileSync(file, 'utf8'), method)
    if (!body) { wrong.push(`${d.op} 메서드 없음`); continue }
    const need = requiredOf(body, method)
    if (need !== d.scope) wrong.push(`${d.op} 창구 ${need} 정의 ${d.scope}`)
  }
  assert.deepEqual(wrong, [])
})

test('settings PATCH 는 admin, suppliers POST pool-stock POST 는 write 를 요구한다', () => {
  const read = (rel: string) => readFileSync(join(WEB, 'app', 'api', 'public', 'v1', rel), 'utf8')
  assert.equal(requiredOf(methodBody(read('settings/route.ts'), 'PATCH')!, 'PATCH'), 'admin')
  assert.equal(requiredOf(methodBody(read('suppliers/route.ts'), 'POST')!, 'POST'), 'write')
  assert.equal(requiredOf(methodBody(read('pool-stock/route.ts'), 'POST')!, 'POST'), 'write')
})

test('★ 키 인증이 범위 판정을 실제로 부르고 실패하면 막는다', () => {
  const src = readFileSync(join(WEB, 'lib', 'publicApiAuth.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function authenticatePublicApi('), src.indexOf('async function findKey('))
  const callAt = fn.search(/decideKeyAccess\(\{/)
  assert.ok(callAt >= 0, '범위 판정 호출이 없다')
  assert.match(fn, /required\s*=\s*options\.scope \?\? scopeForMethod\(request\.method\)/, '창구가 준 범위를 안 쓴다')
  assert.match(fn.slice(callAt), /if \(!access\.ok\)[\s\S]*?requiredScope: required/, '판정이 실패해도 막지 않는다')
  assert.match(fn, /scopes: access\.scopes/, '문맥에 실제 범위를 안 싣는다')
  // 범위 칼럼을 실제로 읽는다
  assert.match(src, /scopes, expires_at/, 'api_keys 에서 범위와 만료일을 안 읽는다')
  // 호출 기록과 한도 판정보다 먼저 막는다
  assert.ok(callAt < fn.indexOf("record_api_key_hit"), '범위 판정이 호출 기록보다 늦다')
})
