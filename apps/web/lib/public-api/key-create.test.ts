/**
 * API 키 만들기 검증과 화면 배선 (P0158 I05)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareKeyCreate } from './key-create.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOW = new Date('2026-10-23T00:00:00Z')

test('범위를 안 주면 read, 만료를 안 주면 90일', () => {
  const r = prepareKeyCreate({ name: '스크립트' }, 'member', NOW)
  assert.ok(r.ok)
  assert.deepEqual(r.row.scopes, ['read'])
  assert.equal(r.row.expires_at, '2027-01-21T00:00:00.000Z')
  assert.equal(r.row.purpose, null)
})

test('모르는 범위와 범위 0개와 만료 범위 밖은 400', () => {
  for (const body of [
    { name: 'a', scopes: ['root'] },
    { name: 'a', scopes: [] },
    { name: 'a', expiresInDays: 0 },
    { name: 'a', expiresInDays: 366 },
    { name: '' },
    { name: 'a', purpose: 'x'.repeat(201) },
  ]) {
    const r = prepareKeyCreate(body, 'admin', NOW)
    assert.equal(r.ok, false, JSON.stringify(body))
    if (!r.ok) assert.equal(r.status, 400)
  }
})

test('계정 역할이 가질 수 없는 범위는 403', () => {
  const r = prepareKeyCreate({ name: 'a', scopes: ['read', 'admin'] }, 'member', NOW)
  assert.deepEqual(r, { ok: false, status: 403, error: 'scope_not_allowed', scopes: ['admin'] })
  const ok = prepareKeyCreate({ name: 'a', scopes: ['read', 'admin'], purpose: ' 배치 ' }, 'admin', NOW)
  assert.ok(ok.ok)
  assert.deepEqual(ok.row.scopes, ['read', 'admin'])
  assert.equal(ok.row.purpose, '배치')
})

test('★ 만들기 창구가 검증을 지나 범위 만료일 쓰는 곳을 저장하고, 키 값은 만든 응답에만', () => {
  const src = readFileSync(join(WEB, 'app', 'api', 'user', 'api-keys', 'route.ts'), 'utf8')
  const post = src.slice(src.indexOf('export async function POST('))
  assert.match(post, /prepareKeyCreate\(/)
  assert.match(post, /\.\.\.prep\.row/, '검증한 줄을 그대로 넣지 않는다')
  const get = src.slice(src.indexOf('export async function GET('), src.indexOf('export async function POST('))
  assert.match(get, /scopes/, '목록이 범위를 안 준다')
  assert.match(get, /expires_at/, '목록이 만료일을 안 준다')
  assert.doesNotMatch(get, /key_hash|\bkey\b:/, '목록이 키 값이나 해시를 준다')
})

test('★ 화면이 범위 만료 쓰는 곳을 보내고 목록에 보인다, 다시 복사할 수 있다는 거짓 안내가 없다', () => {
  const page = readFileSync(join(WEB, 'app', '(member)', 'api-keys', 'page.tsx'), 'utf8')
  assert.match(page, /scopes: newScopes/)
  assert.match(page, /expiresInDays/)
  assert.match(page, /purpose/)
  assert.match(page, /API_KEY_ONCE/)
  assert.doesNotMatch(page, /다시 복사할 수 있습니다/)
  const panel = readFileSync(join(WEB, 'app', 'admin', 'api', 'ApiKeysPanel.tsx'), 'utf8')
  assert.match(panel, /key: 'scopes'/)
  assert.match(panel, /key: 'expires_at'/)
})
