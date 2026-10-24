/**
 * 개발자센터 문서가 코드와 같은 말을 하는가 (P0164)
 *
 * 인증 절(lib/api-docs/auth-doc.ts)의 범위 표와 만료 표는 Scope 와 lib/terms 에서 파생된다
 * 손으로 옮겨 적은 줄이 생기면 범위나 기간이 바뀔 때 화면만 옛말을 한다, 그것을 여기서 막는다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCOPES } from '../actions/types.ts'
import { API_KEY_SCOPE, API_KEY_EXPIRY_OPTIONS, API_KEY_DEFAULT_EXPIRY_DAYS } from '../terms/api-key.ts'
import {
  AUTH_SCOPE_ROWS, AUTH_EXPIRY_ROWS, AUTH_ME_FIELDS, AUTH_ME_SAMPLE, AUTH_EXPIRED_MESSAGE, AUTH_SCOPE_403_SAMPLE, AUTH_DOC,
} from './auth-doc.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

test('범위 표의 줄은 Scope 의 구성원과 같고 문구는 API_KEY_SCOPE 에서 온다', () => {
  assert.deepEqual(AUTH_SCOPE_ROWS.map((r) => r.scope), [...SCOPES])
  for (const r of AUTH_SCOPE_ROWS) assert.equal(r.label, API_KEY_SCOPE[r.scope], r.scope)
  // Scope 형 자체와 SCOPES 배열이 갈라지면 표가 형에 없는 범위를 보인다
  const src = read('lib/actions/types.ts')
  const union = /export type Scope = ([^\n]+)/.exec(src)?.[1] ?? ''
  const members = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(members, [...SCOPES])
})

test('만료 표는 API_KEY_EXPIRY_OPTIONS 와 같고 기본값은 하나뿐이다', () => {
  assert.deepEqual(AUTH_EXPIRY_ROWS.map((r) => [r.days, r.label]), API_KEY_EXPIRY_OPTIONS.map((o) => [o.days, o.label]))
  const defaults = AUTH_EXPIRY_ROWS.filter((r) => r.isDefault)
  assert.equal(defaults.length, 1)
  assert.equal(defaults[0].days, API_KEY_DEFAULT_EXPIRY_DAYS)
  // 키 만들기 창구의 기본값과 화면이 말하는 기본값이 같아야 한다
  const create = read('lib/public-api/key-create.ts')
  const serverDefault = Number(/KEY_EXPIRY_DEFAULT_DAYS = (\d+)/.exec(create)?.[1])
  assert.equal(serverDefault, API_KEY_DEFAULT_EXPIRY_DAYS)
})

test('GET /me 의 필드와 예시는 me 라우트가 실제로 내보내는 이름이다', () => {
  const route = read('app/api/public/v1/me/route.ts')
  const okBody = /return ok\(\{([\s\S]*?)\}, \{/.exec(route)?.[1] ?? ''
  const emitted = [...okBody.matchAll(/^\s*([a-zA-Z]+):/gm)].map((m) => m[1])
  assert.ok(emitted.includes('expiresAt') && emitted.includes('remainingThisMinute'), '라우트에 두 필드가 있어야 한다')
  assert.deepEqual(AUTH_ME_FIELDS.map((f) => f.name), emitted)
  const sample = JSON.parse(AUTH_ME_SAMPLE) as { success: boolean; data: Record<string, unknown> }
  assert.equal(sample.success, true)
  assert.deepEqual(Object.keys(sample.data), emitted)
})

test('403 예시는 게이트웨이가 보내는 몸통과 같은 모양이다', () => {
  const dispatch = read('lib/actions/dispatch.ts')
  assert.match(dispatch, /error: `이 작업에는 \$\{decision\.requiredScope\} 범위가 필요합니다\.`, requiredScope: decision\.requiredScope/)
  const body = JSON.parse(AUTH_SCOPE_403_SAMPLE.replace(/^\/\/.*\n/, '')) as Record<string, unknown>
  assert.deepEqual(Object.keys(body), ['success', 'error', 'requiredScope'])
  assert.equal(body.error, `이 작업에는 ${String(body.requiredScope)} 범위가 필요합니다.`)
  // 만료 문구는 인증 코드의 문구 그대로
  assert.ok(read('lib/publicApiAuth.ts').includes(`'${AUTH_EXPIRED_MESSAGE}'`))
})

test('인증 절은 실제 권한과 403 과 만료와 한 번만 보이는 키와 /me 를 말한다', () => {
  const text = Object.values(AUTH_DOC).map((v) => (typeof v === 'string' ? v : '')).join('\n')
  for (const word of ['교집합', 'requiredScope', '403', '/api-keys', '한 번만', 'GET /me']) {
    assert.ok(text.includes(word), word)
  }
  const page = read('app/develop/page.tsx')
  assert.match(page, /<KeyScopeSection onCopy=\{onCopy\} copiedId=\{copiedId\} \/>/)
})
