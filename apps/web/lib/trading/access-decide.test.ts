/**
 * 소유자 전용 문이 정말 잠기는가
 *
 * 특히 **관리자가 막히는가**를 본다. 이 저장소의 다른 판정은 전부 관리자를 먼저 통과시키고,
 * 그것이 그쪽의 옳은 규칙이다. 그래서 이 판정을 읽는 사람은 자연히 「관리자는 되겠지」로
 * 짐작한다 — 짐작이 규칙이 되지 않게 그 경우를 제일 먼저 시험한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideTradingAccess } from './access-decide.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OWNER = '11111111-1111-4111-8111-111111111111'
const SOMEONE = '22222222-2222-4222-8222-222222222222'

test('소유자는 들어간다', () => {
  const d = decideTradingAccess({ userId: OWNER, isAdmin: false }, OWNER)
  assert.equal(d.allowed, true)
  assert.equal(d.reason, 'owner')
})

test('★ 관리자도 소유자가 아니면 막힌다', () => {
  const d = decideTradingAccess({ userId: SOMEONE, isAdmin: true }, OWNER)
  assert.equal(d.allowed, false, '관리자가 남의 매매 기록을 열람하는 문이 생겼다')
  assert.equal(d.reason, 'not_owner')
  assert.ok((d.userMessage ?? '').length > 0, '막으면서 이유를 말하지 않는다')
})

test('일반 사용자는 막힌다', () => {
  const d = decideTradingAccess({ userId: SOMEONE, isAdmin: false }, OWNER)
  assert.equal(d.allowed, false)
  assert.equal(d.reason, 'not_owner')
})

test('로그인하지 않았으면 막힌다', () => {
  const d = decideTradingAccess({ userId: null, isAdmin: false }, OWNER)
  assert.equal(d.allowed, false)
  assert.equal(d.reason, 'anonymous')
})

test('★ 소유자를 안 정했으면 아무도 못 들어간다 — 열어 두고 시작하지 않는다', () => {
  for (const owner of [null, undefined, '', '   ']) {
    for (const isAdmin of [true, false]) {
      const d = decideTradingAccess({ userId: SOMEONE, isAdmin }, owner)
      assert.equal(d.allowed, false, `소유자 미지정(${JSON.stringify(owner)})인데 열렸다 (관리자=${isAdmin})`)
      assert.equal(d.reason, 'no_owner')
    }
  }
})

test('소유자 ID 를 코드에 박아 두지 않는다', () => {
  for (const file of ['access-decide.ts', 'access.ts']) {
    const src = readFileSync(join(HERE, file), 'utf8')
    // UUID 꼴이 소스에 있으면 사람 ID 를 박은 것이다. 설정에서 읽어야 한다
    const uuids = src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []
    assert.deepEqual(uuids, [], `${file} 에 사람 ID 가 박혀 있다: ${uuids.join(', ')}`)
    assert.ok(
      src.includes('owner_user_id') || src.includes('ownerUserId'),
      `${file} 이 소유자를 설정에서 읽지 않는다`,
    )
  }
})

test('판정이 isAdmin 을 읽지 않는다 — 읽으면 관리자에게 문이 열린다', () => {
  const src = readFileSync(join(HERE, 'access-decide.ts'), 'utf8')
  // 형 선언과 주석 말고, 실제로 값을 보는 자리가 있으면 안 된다
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  assert.doesNotMatch(
    body,
    /(if\s*\(\s*[\w.]*\bisAdmin\b|[\w.]*\bisAdmin\b\s*(&&|\|\|)|\breturn\b[^\n]*\bisAdmin\b)/,
    '판정이 isAdmin 을 조건으로 쓴다. 그러면 관리자가 남의 매매 기록을 본다',
  )
})
