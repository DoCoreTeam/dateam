import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getAvailableProviders,
  getProviderConfig,
  getDefaultProvider,
} from './registry.ts'

test('available: 키 3개 모두 있으면 3개', () => {
  const meta = {
    gemini_api_key: 'g',
    claude_api_key: 'c',
    openai_api_key: 'o',
    openai_model: 'gpt-4o',
  }
  const list = getAvailableProviders(meta)
  assert.deepEqual(
    list.map((c) => c.id),
    ['gemini', 'claude', 'openai'],
  )
})

test('available: gemini 키만 → 1개 + 모델 폴백 gemini-2.0-flash', () => {
  const list = getAvailableProviders({ gemini_api_key: 'g' })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'gemini')
  assert.equal(list[0].model, 'gemini-2.0-flash')
})

test('available: claude 키만·모델 미설정 → 모델 claude-opus-4-8 폴백', () => {
  const list = getAvailableProviders({ claude_api_key: 'c' })
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'claude')
  assert.equal(list[0].model, 'claude-opus-4-8')
})

test('available: openai 키 있음 + 모델 미설정 → 제외', () => {
  const list = getAvailableProviders({ openai_api_key: 'o' })
  assert.equal(list.length, 0)
})

test('available: openai 키 + 모델 설정 → 포함', () => {
  const list = getAvailableProviders({ openai_api_key: 'o', openai_model: 'gpt-4o' })
  assert.equal(list.length, 1)
  assert.equal(list[0].model, 'gpt-4o')
})

test('available: 빈 META → 빈 배열', () => {
  assert.deepEqual(getAvailableProviders({}), [])
})

test('getProviderConfig: 미가용 프로바이더 → null', () => {
  assert.equal(getProviderConfig({}, 'claude'), null)
  assert.equal(getProviderConfig({ openai_api_key: 'o' }, 'openai'), null) // 모델 없음
  const cfg = getProviderConfig({ claude_api_key: 'c', claude_model: 'claude-opus-4-8' }, 'claude')
  assert.equal(cfg?.model, 'claude-opus-4-8')
})

test('getDefaultProvider: 설정값이 가용이면 해당 설정', () => {
  const meta = {
    gemini_api_key: 'g',
    claude_api_key: 'c',
    ai_chat_default_provider: 'claude',
  }
  assert.equal(getDefaultProvider(meta)?.id, 'claude')
})

test('getDefaultProvider: 설정값 미가용 → 첫 available', () => {
  const meta = { gemini_api_key: 'g', ai_chat_default_provider: 'openai' }
  assert.equal(getDefaultProvider(meta)?.id, 'gemini')
})

test('getDefaultProvider: 미설정 → 첫 available (고정 순서 gemini)', () => {
  const meta = { gemini_api_key: 'g', claude_api_key: 'c' }
  assert.equal(getDefaultProvider(meta)?.id, 'gemini')
})

test('getDefaultProvider: 빈 META → null', () => {
  assert.equal(getDefaultProvider({}), null)
})
