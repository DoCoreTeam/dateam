// 키 주인 세션을 앱 인증 쿠키로 (P0159 I01)
//
// 재는 것: 만든 쿠키를 @supabase/ssr 이 그대로 되읽는가(화면 미들웨어가 쓰는 그 읽기),
// 문맥 밖은 요청 쿠키 그대로인가, 문맥 안은 요청 쿠키를 버리는가, 2단계 장치는 거절하는가,
// 그리고 토큰을 찍는 길이 소스에 없는가.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServerClient, MAX_CHUNK_SIZE } from '@supabase/ssr'
import { authCookieName, sessionAuthCookies, exportCookiesFor, SSR_BASE64_PREFIX } from './acting-cookies.ts'
import type { ActingSession } from './acting-session.ts'

const WEB = fileURLToPath(new URL('../..', import.meta.url))
const SUPABASE_URL = 'https://abcdefghij.supabase.co'
const NOW = 1_800_000_000

/** JWT 모양의 가짜 토큰, 서명은 안 본다(getSession 은 저장된 값을 돌려줄 뿐) */
function fakeJwt(extraLen = 0): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const payload = { sub: 'user-1', aal: 'aal1', exp: NOW + 3600, pad: 'x'.repeat(extraLen) }
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

function session(extraLen = 0): ActingSession {
  return { accessToken: fakeJwt(extraLen), refreshToken: 'refresh-abc', expiresAt: NOW + 3600 }
}

/** 화면 쪽 서버 클라이언트가 그 쿠키로 무엇을 보는가 */
async function readBack(cookies: { name: string; value: string }[]) {
  // 저장된 세션에 user 가 없으면 auth-js 가 시작할 때 사용자를 한 번 묻는다, 시험은 망을 안 탄다
  const offline = async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
  const client = createServerClient(SUPABASE_URL, 'anon-key', {
    cookies: { getAll: () => cookies, setAll: () => {} },
    global: { fetch: offline },
  })
  const { data, error } = await client.auth.getSession()
  return { session: data.session, error }
}

test('쿠키 이름은 supabase-js 기본 저장 키와 같다', () => {
  assert.equal(authCookieName(SUPABASE_URL), 'sb-abcdefghij-auth-token')
})

test('★ 만든 쿠키를 @supabase/ssr 이 되읽어 같은 세션을 본다', async () => {
  const s = session()
  const cookies = sessionAuthCookies(SUPABASE_URL, s, NOW)
  assert.equal(cookies.length, 1)
  assert.ok(cookies[0].value.startsWith(SSR_BASE64_PREFIX))
  const back = await readBack(cookies)
  assert.equal(back.error, null)
  assert.equal(back.session?.access_token, s.accessToken)
  assert.equal(back.session?.refresh_token, s.refreshToken)
  assert.equal(back.session?.expires_at, s.expiresAt)
})

test('긴 토큰은 조각으로 나뉘고 조각을 모아 같은 세션을 본다', async () => {
  const s = session(MAX_CHUNK_SIZE * 2)
  const cookies = sessionAuthCookies(SUPABASE_URL, s, NOW)
  assert.ok(cookies.length >= 3, `조각 수 ${cookies.length}`)
  assert.deepEqual(cookies.map((c) => c.name).slice(0, 2), ['sb-abcdefghij-auth-token.0', 'sb-abcdefghij-auth-token.1'])
  for (const c of cookies) assert.ok(c.value.length <= MAX_CHUNK_SIZE)
  const back = await readBack(cookies)
  assert.equal(back.session?.access_token, s.accessToken)
})

test('문맥 밖이면 요청 쿠키를 그대로 넘긴다, 웹 경로는 바뀌지 않는다', () => {
  const requestCookies = [{ name: 'sb-abcdefghij-auth-token', value: 'web-session' }, { name: 'other', value: '1' }]
  const r = exportCookiesFor({ requestCookies, supabaseUrl: SUPABASE_URL, nowSec: NOW })
  assert.deepEqual(r, { ok: true, cookies: requestCookies })
})

test('★ 문맥 안이면 요청 쿠키를 버리고 키 주인 쿠키만 넘긴다', async () => {
  const s = session()
  const planted = [{ name: 'sb-abcdefghij-auth-token', value: 'someone-else' }, { name: 'evil', value: '1' }]
  const r = exportCookiesFor({ requestCookies: planted, acting: { session: s }, verifiedFactors: 0, supabaseUrl: SUPABASE_URL, nowSec: NOW })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.cookies.map((c) => c.name), ['sb-abcdefghij-auth-token'])
  assert.ok(!r.cookies.some((c) => c.value === 'someone-else' || c.name === 'evil'))
  assert.equal((await readBack(r.cookies)).session?.access_token, s.accessToken)
})

test('★ 2단계 장치가 있는 키 주인은 굽기 전에 거절하고 토큰을 싣지 않는다', () => {
  const r = exportCookiesFor({ requestCookies: [], acting: { session: session() }, verifiedFactors: 1, supabaseUrl: SUPABASE_URL, nowSec: NOW })
  assert.deepEqual(r, { ok: false, reason: 'second_factor' })
  assert.ok(!JSON.stringify(r).includes('refresh-abc'))
})

test('★ 모듈은 토큰을 찍지 않고 출처를 스스로 정하지 않는다', () => {
  const src = readFileSync(join(WEB, 'lib', 'actions', 'acting-cookies.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /console\./)
  assert.doesNotMatch(code, /\b(domain|url)\s*:/, '심을 출처는 render-document 가 믿은 출처 하나다')
  assert.doesNotMatch(code, /throw new Error\([^)]*(token|session)/i)
})
