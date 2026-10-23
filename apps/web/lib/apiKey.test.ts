/**
 * API 키는 해시로만 보관하고 운영에서는 기본 비밀값으로 돌지 않는다
 *
 * **왜**: 키 원문을 raw_key 칼럼에 평문으로 두고 목록 응답에도 실어 보냈다(감사 2026-10-23).
 *   해시 비밀값은 env 가 없으면 저장소에 적힌 기본값을 썼다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hmacSecret, generateApiKey, hashApiKey } from './apiKey.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')

test('★ 운영에서 비밀값이 없으면 기본값으로 돌지 않고 멈춘다', () => {
  assert.throws(() => hmacSecret({ NODE_ENV: 'production' }), /API_KEY_HMAC_SECRET/)
  assert.equal(hmacSecret({ NODE_ENV: 'production', API_KEY_HMAC_SECRET: 's3' }), 's3')
})

test('개발에서는 기본값으로 돈다', () => {
  assert.equal(typeof hmacSecret({ NODE_ENV: 'development' }), 'string')
  assert.ok(hmacSecret({ NODE_ENV: 'development' }).length > 0)
})

test('만든 키의 해시는 다시 계산해도 같고 원문과 다르다', () => {
  const { key, hash, prefix } = generateApiKey()
  assert.equal(hashApiKey(key), hash)
  assert.notEqual(hash, key)
  assert.ok(key.startsWith(prefix))
})

test('★ 키 창구는 원문을 저장하지도 목록으로 돌려주지도 않는다', () => {
  for (const rel of ['app/api/user/api-keys/route.ts', 'app/(member)/api-keys/page.tsx', 'lib/publicApiAuth.ts']) {
    const src = readFileSync(join(WEB, rel), 'utf8')
    assert.doesNotMatch(src, /raw_key/, `${rel} 이 raw_key 를 다룬다`)
  }
})
