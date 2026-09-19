/**
 * 2단계 인증이 실제로 강제되는지 본다
 *
 * **왜**: 2026-09-20 실측 — 계정 40개 중 2단계를 쓰는 사람이 0명이었고 그중 둘이 관리자였다.
 *   표 잠금도 창구 게이트도 결국 로그인 하나에 매달린다.
 *   그런데 이 게이트는 **지워도 화면이 멀쩡하다.** 등록한 사람만 조용히 그냥 통과할 뿐이다.
 *   그래서 여기서 붙잡는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { needsChallenge } from './mfa-level.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

test('비밀번호만 통과한 세션은 아직 들어오지 못한다', () => {
  assert.equal(needsChallenge({ currentLevel: 'aal1', nextLevel: 'aal2' }), true)
})

test('이미 코드까지 넣었거나 등록이 없으면 막지 않는다', () => {
  // 코드까지 통과
  assert.equal(needsChallenge({ currentLevel: 'aal2', nextLevel: 'aal2' }), false)
  // 등록한 장치가 없는 사람 — 여기서 막으면 못 들어오는 사람이 생긴다
  assert.equal(needsChallenge({ currentLevel: 'aal1', nextLevel: 'aal1' }), false)
  // 토큰을 아직 못 읽은 상태
  assert.equal(needsChallenge({ currentLevel: null, nextLevel: null }), false)
})

test('미들웨어가 2단계를 강제한다', () => {
  const mw = read('middleware.ts')
  assert.match(
    mw,
    /getAuthenticatorAssuranceLevel\(\)/,
    '미들웨어가 단계를 안 보면 등록한 사람도 비밀번호만으로 들어온다',
  )
  assert.match(
    mw,
    /currentLevel === 'aal1' && aal\?\.nextLevel === 'aal2'/,
    '두 단계를 비교하지 않으면 판정이 틀린다',
  )
  assert.match(mw, /url\.pathname = '\/mfa'/, '막기만 하고 보낼 곳이 없으면 사람이 갇힌다')
})

test('등록하러 갈 길과 코드 넣을 길은 열려 있다', () => {
  const mw = read('middleware.ts')
  const gate = mw.slice(mw.indexOf('getAuthenticatorAssuranceLevel') - 400, mw.indexOf('getAuthenticatorAssuranceLevel'))
  for (const open of ["'/mfa'", "'/security'", "'/change-password'"]) {
    assert.ok(
      gate.includes(open),
      `${open} 을 게이트에서 빼지 않으면 그 화면으로 갈 수 없어 사람이 갇힌다`,
    )
  }
})

test('장치를 잃은 사람을 되돌리는 길이 있다', () => {
  const actions = read('app/admin/users/actions.ts')
  assert.match(actions, /export async function resetUserMfa/, '관리자 해제가 없으면 휴대폰을 잃은 계정은 영영 못 들어온다')
  assert.match(actions, /deleteFactor/, '실제로 떼지 않으면 버튼만 있는 것이다')
  // 관리자 확인 없이 떼면 그것이 곧 우회로다
  const fn = actions.slice(actions.indexOf('export async function resetUserMfa'))
  assert.match(fn.slice(0, 500), /requireAdmin\(\)/, '관리자 확인 없이 2단계를 뗄 수 있으면 게이트가 없는 것과 같다')

  // 부르는 자리를 본다 — import 만 남기고 지워도 통과하면 안 된다(실측으로 걸렸다)
  const table = read('app/admin/users/UserTable.tsx')
  assert.match(table, /<ResetMfaButton\s/, '서버에만 있고 화면이 안 부르면 기능이 없는 것이다')
})

test('스스로 뗄 때는 2단계를 지난 세션이어야 한다', () => {
  const src = read('app/security/actions.ts')
  const fn = src.slice(src.indexOf('export async function removeFactor'))
  assert.match(
    fn,
    /currentLevel !== 'aal2'/,
    '비밀번호만 아는 사람이 남의 장치를 떼고 들어갈 수 있으면 2단계가 없는 것과 같다',
  )
})
