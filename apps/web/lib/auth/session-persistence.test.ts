/**
 * 「로그인 상태 유지」를 끈 세션이 브라우저를 닫으면 끝나는지 본다
 *
 * **왜**: `@supabase/ssr` 은 인증 쿠키를 쓸 때마다 maxAge 를 400일로 덮는다.
 *   토큰은 미들웨어·서버·브라우저 세 자리에서 갱신되므로 한 자리만 빠져도
 *   끈 세션이 약 1시간 뒤 첫 갱신에서 400일짜리로 바뀐다. 화면에는 아무 표시가 없다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applySessionPersistence,
  isSessionOnly,
  wantsPersistentLogin,
} from './session-persistence.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

const SSR_SET = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 }

test('유지 안 함이면 수명이 빠져 세션 쿠키가 된다', () => {
  const out = applySessionPersistence({ ...SSR_SET, expires: new Date() }, true)
  assert.equal('maxAge' in out, false)
  assert.equal('expires' in out, false)
  assert.equal(out.path, '/')
  assert.equal(out.sameSite, 'lax')
})

test('유지면 옵션을 그대로 둔다', () => {
  assert.deepEqual(applySessionPersistence(SSR_SET, false), SSR_SET)
})

test('지우기(maxAge 0)는 유지 안 함이어도 그대로 둔다 — 빼면 지운 쿠키가 되살아난다', () => {
  const remove = { ...SSR_SET, maxAge: 0 }
  assert.deepEqual(applySessionPersistence(remove, true), remove)
})

test('원본 옵션을 고치지 않는다', () => {
  const input = { ...SSR_SET }
  applySessionPersistence(input, true)
  assert.equal(input.maxAge, SSR_SET.maxAge)
})

test('선호 쿠키는 정확히 1 일 때만 유지 안 함, 그 밖은 기본값인 유지', () => {
  assert.equal(isSessionOnly('1'), true)
  for (const v of [undefined, null, '', '0', 'true', '1 ', '11']) {
    assert.equal(isSessionOnly(v), false, `${String(v)} 를 유지 안 함으로 읽으면 안 된다`)
  }
})

test('폼 체크박스는 on 일 때만 유지', () => {
  assert.equal(wantsPersistentLogin('on'), true)
  assert.equal(wantsPersistentLogin(null), false)
  assert.equal(wantsPersistentLogin('off'), false)
})

test('인증 쿠키를 쓰는 세 자리가 모두 정책을 지난다', () => {
  for (const rel of ['middleware.ts', 'lib/supabase/server.ts', 'lib/supabase/client.ts']) {
    const src = read(rel)
    assert.match(
      src,
      /applySessionPersistence\(\s*options\s*,\s*sessionOnly/,
      `${rel} 가 쿠키를 그대로 쓰면 유지 안 함 세션이 첫 토큰 갱신 때 400일짜리가 된다`,
    )
    assert.match(src, /SESSION_ONLY_COOKIE/, `${rel} 가 선호 쿠키를 안 읽는다`)
  }
})

test('브라우저 클라이언트가 쿠키 쓰기를 기본 구현에 맡기지 않는다', () => {
  assert.match(
    read('lib/supabase/client.ts'),
    /cookies:\s*\{\s*getAll:\s*readCookies,\s*setAll:\s*writeCookies\s*\}/,
    '기본 구현은 갱신 때마다 400일로 쓴다',
  )
})
