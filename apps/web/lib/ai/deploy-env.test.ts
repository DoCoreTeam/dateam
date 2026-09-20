/**
 * 어느 판에서 도는지 안다 (P0030 I14)
 *
 * ## 무엇을 막는가
 *
 * 키를 고르는 자리가 판을 모르면 개발하는 사람의 노트북이 운영 키로 벤더를 두드린다.
 * 그 호출은 운영 한도를 쓰고 운영 원장에 남으며, 원장만 봐서는 운영 사용자와 구별되지 않는다.
 * 실측 2026-09-20 하루 23,318건 중 어느 것이 개발 판에서 나간 것인지 가릴 방법이 없었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deployEnvFrom, mayUseProductionKeys } from './deploy-env.ts'

test('★ Vercel 이 말해 주면 그 말을 따른다', () => {
  assert.equal(deployEnvFrom({ VERCEL_ENV: 'production', NODE_ENV: 'production' }), 'production')
  assert.equal(deployEnvFrom({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }), 'preview')
  assert.equal(deployEnvFrom({ VERCEL_ENV: 'development', NODE_ENV: 'production' }), 'development')
})

test('★ 미리보기 판은 운영이 아니다 — 같은 빌드라도 쓰는 키가 달라야 한다', () => {
  assert.equal(mayUseProductionKeys(deployEnvFrom({ VERCEL_ENV: 'preview' })), false)
})

test('★ 모르면 개발로 본다 — 조용히 나쁜 쪽보다 시끄럽게 나쁜 쪽이 낫다', () => {
  assert.equal(deployEnvFrom({}), 'development')
  assert.equal(deployEnvFrom({ NODE_ENV: '' }), 'development')
  assert.equal(deployEnvFrom({ NODE_ENV: 'weird' }), 'development')
  assert.equal(mayUseProductionKeys(deployEnvFrom({})), false, '모르는 판이 운영 키를 썼다')
})

test('시험 판은 따로 센다', () => {
  assert.equal(deployEnvFrom({ NODE_ENV: 'test' }), 'test')
  assert.equal(mayUseProductionKeys('test'), false)
})

test('Vercel 밖의 프로덕션 빌드는 운영이다', () => {
  assert.equal(deployEnvFrom({ NODE_ENV: 'production' }), 'production')
  assert.equal(mayUseProductionKeys('production'), true)
})

test('★ 운영만 운영 키를 쓴다', () => {
  const 판들 = ['production', 'preview', 'development', 'test'] as const
  const 허용 = 판들.filter(mayUseProductionKeys)
  assert.deepEqual(허용, ['production'], '운영 말고도 운영 키를 쓸 수 있는 판이 생겼다')
})
