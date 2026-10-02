// 「안 씀」 규칙 가드 — 끄는 길이 키 삭제 하나뿐이던 것을 고치면서 생긴 자리
//
// 두 방향으로 틀릴 수 있고 둘 다 조용하다
//  - 안 꺼져야 할 것이 꺼짐 → AI 가 통째로 멈추고 화면 어디에도 이유가 없다
//  - 꺼져야 할 것이 안 꺼짐 → 안 쓰기로 한 공급자를 계속 찌르고 계속 결제를 권한다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  META_DISABLED_PROVIDERS_KEY,
  readDisabledProviders,
  isProviderDisabled,
  withProviderDisabled,
  disabledMessage,
} from './provider-disabled.ts'

test('저장값이 없으면 아무도 안 꺼진다', () => {
  for (const meta of [{}, { [META_DISABLED_PROVIDERS_KEY]: null }, { [META_DISABLED_PROVIDERS_KEY]: 'openai' }]) {
    assert.deepEqual(readDisabledProviders(meta), [], '읽기에 실패했다고 공급자를 끄면 안 된다')
    assert.equal(isProviderDisabled(meta, 'openai'), false)
  }
})

test('적힌 공급자만 꺼진다', () => {
  const meta = { [META_DISABLED_PROVIDERS_KEY]: ['openai'] }
  assert.equal(isProviderDisabled(meta, 'openai'), true)
  assert.equal(isProviderDisabled(meta, 'gemini'), false)
})

test('모르는 값은 버린다 — 명세에 있는 id 만 받는다 (S4)', () => {
  const meta = {
    [META_DISABLED_PROVIDERS_KEY]: ['openai', 'not-a-provider', '', 42, null, { id: 'gemini' }, 'openai'],
  }
  assert.deepEqual(readDisabledProviders(meta), ['openai'], '밖에서 온 값이 그대로 들어오면 안 된다')
})

test('끄고 켜기는 원본 META 를 안 고친다', () => {
  const before: Record<string, unknown> = { gemini_api_key: '기존' }
  const off = withProviderDisabled(before, 'openai', true)
  assert.deepEqual(before, { gemini_api_key: '기존' }, '원본을 고치면 저장 전 상태를 되돌릴 수 없다')
  assert.equal(isProviderDisabled(off, 'openai'), true)
  assert.equal(off.gemini_api_key, '기존', '남의 칸을 밀어내지 않는다')

  const on = withProviderDisabled(off, 'openai', false)
  assert.equal(isProviderDisabled(on, 'openai'), false, '되돌릴 수 있어야 한다')
  assert.deepEqual(readDisabledProviders(on), [])
})

test('같은 공급자를 두 번 꺼도 한 번만 적힌다', () => {
  const once = withProviderDisabled({}, 'openai', true)
  const twice = withProviderDisabled(once, 'openai', true)
  assert.deepEqual(readDisabledProviders(twice), ['openai'])
})

test('모르는 id 로는 아무것도 안 바뀐다', () => {
  const meta = { a: 1 }
  // @ts-expect-error 밖에서 온 값이 들어오는 자리를 흉내 낸다
  assert.deepEqual(withProviderDisabled(meta, 'not-a-provider', true), meta)
})

test('안내문이 할 수 있는 일을 말하고 조사를 손으로 안 적는다', () => {
  const line = disabledMessage('OpenAI')
  assert.match(line, /다시 켜/, '못 쓴다고만 하면 읽는 쪽의 일이 는다')
  assert.doesNotMatch(line, /은\(는\)/, '조사는 lib/ui/josa 가 고른다')
})
