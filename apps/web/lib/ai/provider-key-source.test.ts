/**
 * 키를 고르는 자리 하나 (P0030 I14)
 *
 * ## 무엇을 막는가
 *
 * 키를 읽는 길이 셋이었고(META 직독 · ai-chat 의 getProviderConfig · 새 키 표) 셋이 서로를
 * 몰랐다. 그래서 어느 키가 실제로 쓰였는지 한 곳에서 말할 수 없었고, **판을 보는 곳은
 * 한 곳도 없었다** — 개발하는 사람의 노트북이 운영 키로 벤더를 두드려도 아무도 몰랐다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseKey, messageFor, NO_KEY_MESSAGE, ENV_BLOCKED_MESSAGE } from './provider-key-source.ts'

test('★ 키 표에 있으면 그것을 쓴다 — 판과 무관하게 그 판 몫으로 넣은 키다', () => {
  for (const env of ['production', 'preview', 'development', 'test'] as const) {
    const c = chooseKey({ env, poolKey: 'pool-key', metaKey: 'meta-key' })
    assert.equal(c.apiKey, 'pool-key', `${env} 에서 표의 키를 안 썼다`)
    assert.equal(c.reason, 'pool')
  }
})

test('★ 운영 판만 META 의 운영 키를 쓴다', () => {
  const prod = chooseKey({ env: 'production', metaKey: 'meta-key' })
  assert.equal(prod.apiKey, 'meta-key')
  assert.equal(prod.reason, 'meta')

  for (const env of ['preview', 'development', 'test'] as const) {
    const c = chooseKey({ env, metaKey: 'meta-key' })
    assert.equal(c.apiKey, null, `${env} 가 운영 키를 집었다`)
    assert.equal(c.reason, 'env_blocked')
  }
})

test('★ 막힌 것과 없는 것을 다른 말로 한다 — 같은 말이면 키를 또 넣는다', () => {
  const 없음 = chooseKey({ env: 'development' })
  const 막힘 = chooseKey({ env: 'development', metaKey: 'meta-key' })
  assert.equal(없음.reason, 'no_key')
  assert.equal(막힘.reason, 'env_blocked')
  assert.notEqual(messageFor(없음), messageFor(막힘))
  assert.equal(messageFor(없음), NO_KEY_MESSAGE)
  assert.equal(messageFor(막힘), ENV_BLOCKED_MESSAGE)
})

test('★ 키가 없으면 빈 문자열이 아니라 null 이다 — 빈 키를 보내면 401 이 한도 실패와 섞인다', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const c = chooseKey({ env: 'production', metaKey: bad })
    assert.equal(c.apiKey, null, `${JSON.stringify(bad)} 를 키로 썼다`)
    assert.equal(c.reason, 'no_key')
  }
})

test('★ 고른 결과에 판이 함께 실린다 — 원장이 개발 판 호출을 가릴 수 있게', () => {
  assert.equal(chooseKey({ env: 'preview', poolKey: 'k' }).env, 'preview')
  assert.equal(chooseKey({ env: 'production', metaKey: 'k' }).env, 'production')
})

test('쓸 수 있을 때는 알릴 말이 없다', () => {
  assert.equal(messageFor(chooseKey({ env: 'production', metaKey: 'k' })), null)
  assert.equal(messageFor(chooseKey({ env: 'development', poolKey: 'k' })), null)
})

/* ── META 에만 있는 키를 찾아오는가 (실측 2026-09-28) ──────── */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'provider-key-source.ts'), 'utf8')

/**
 * **키가 있는데 없다고 한 자리다.**
 *
 * 이 함수가 `firstKeyValue` 를 쓰고 있었는데 그 함수는 META 로 떨어진 줄을 일부러 걸러낸다.
 * 그래서 표에 줄이 없고 META 에만 키가 있는 공급자(Jev)는 **화면에서도 판단에서도 없는 키**가
 * 됐다. 이름만 비슷한 함수를 골라 쓴 것이 한 공급자를 통째로 죽인 것이다.
 */
test('★ 쓸 수 있는 키를 묻는다 — 표 첫 줄만 보는 함수를 쓰지 않는다', () => {
  const at = SOURCE.indexOf('export async function resolveProviderKey')
  assert.ok(at > 0, '키를 고르는 자리가 없다')
  const body = SOURCE.slice(at)
  assert.match(body, /firstUsableKey\s*\(/, 'META 에만 있는 키를 못 찾는 함수를 쓴다')
  assert.equal(/firstKeyValue\s*\(/.test(body), false,
    'firstKeyValue 는 META 를 걸러낸다 — 그 함수로는 Jev 같은 공급자가 영영 안 보인다')
})

/**
 * META 키를 `poolKey` 자리로 넣으면 **판 검사를 건너뛴다.**
 * 그러면 개발하는 사람의 노트북이 운영 키로 벤더를 두드리고 운영 원장에 남는다 —
 * 이 파일이 애초에 생긴 이유가 그것이다.
 */
test('★ 곳간이 준 META 값은 metaKey 자리로 간다 — 판 검사를 건너뛰지 않는다', () => {
  const at = SOURCE.indexOf('export async function resolveProviderKey')
  const body = SOURCE.slice(at)
  assert.match(body, /from === 'meta'\)\s*storedMetaKey = /,
    'META 에서 온 값을 표에서 온 것처럼 다룬다')
  assert.match(body, /metaKey:\s*metaKey\s*\?\?\s*storedMetaKey/,
    '부르는 쪽이 준 값과 곳간이 준 값의 순서가 없다')
  // 판 검사는 chooseKey 한 곳에만 있어야 한다
  assert.equal(/mayUseProductionKeys/.test(body), false,
    '판 검사가 두 곳으로 갈렸다 — 한쪽만 고치면 다른 쪽이 남는다')
})

test('★ 고른 결과에 키 값 말고 다른 비밀이 안 실린다 (S3)', () => {
  const c = chooseKey({ env: 'production', metaKey: 'vck_secret' })
  assert.deepEqual(Object.keys(c).sort(), ['apiKey', 'env', 'reason'])
})
