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
