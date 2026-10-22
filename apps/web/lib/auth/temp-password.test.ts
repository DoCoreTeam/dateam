/**
 * 초기화 비밀번호가 사람마다 다르고, 빈 비밀번호 로그인 길이 다시 생기지 않는지 본다
 *
 * **왜**: 초기화한 계정 전부가 코드에 적힌 같은 비밀번호였고, 로그인 화면은 빈칸이면
 *   그 값으로 대신 로그인했다. 이메일만 알면 초기화 상태 계정에 들어갈 수 있었다(감사 2026-10-23).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateTempPassword, TEMP_PASSWORD_SHAPE } from './temp-password.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

test('임시 비밀번호는 4글자 네 묶음이고 정해진 글자만 쓴다', () => {
  const pw = generateTempPassword()
  assert.match(pw, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/)
  for (const ch of pw.replace(/-/g, '')) assert.ok(TEMP_PASSWORD_SHAPE.alphabet.includes(ch), ch)
})

test('임시 비밀번호는 뽑을 때마다 다르다 (1,000번에 겹침 0)', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 1000; i++) seen.add(generateTempPassword())
  assert.equal(seen.size, 1000)
})

test('세기가 80비트 이상이다', () => {
  const { alphabet, groups, groupSize } = TEMP_PASSWORD_SHAPE
  const bits = Math.log2(alphabet.length) * groups * groupSize
  assert.ok(bits >= 80, `${bits.toFixed(1)}비트`)
})

test('★ 코드 어디에도 공용 초기화 비밀번호가 없다', () => {
  for (const rel of ['app/(auth)/login/actions.ts', 'app/admin/users/actions.ts']) {
    const src = read(rel)
    assert.doesNotMatch(src, /AX_RESET_REQUIRED/, rel)
    assert.doesNotMatch(src, /RESET_SENTINEL/, rel)
  }
})

test('★ 로그인은 빈 비밀번호를 인증 서버에 보내지 않고 거절한다', () => {
  const src = read('app/(auth)/login/actions.ts')
  const guard = src.indexOf('if (!password)')
  const call = src.indexOf('signInWithPassword(')
  assert.ok(guard > 0, '빈 비밀번호 거절 줄이 없다')
  assert.ok(call > guard, '거절이 인증 호출보다 앞에 있어야 한다')
  assert.match(src, /signInWithPassword\(\{ email, password \}\)/)
})

test('★ 초기화와 초대는 매번 새 임시 비밀번호를 만든다', () => {
  const src = read('app/admin/users/actions.ts')
  const uses = src.match(/password: generateTempPassword\(\)|password: tempPassword/g) ?? []
  assert.ok(uses.length >= 2, `임시 비밀번호를 쓰는 자리 ${uses.length}곳`)
  assert.equal((src.match(/generateTempPassword\(\)/g) ?? []).length >= 2, true)
})
