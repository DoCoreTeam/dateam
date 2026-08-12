import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeReturnTo,
  appendParams,
  withReturnTo,
  RETURN_TO_FALLBACK,
} from './return-to.ts'

test('내부 경로는 쿼리까지 그대로 통과한다', () => {
  assert.equal(
    sanitizeReturnTo('/admin/settings?tab=integrations'),
    '/admin/settings?tab=integrations',
  )
})

test('외부로 튕기는 주소는 전부 fallback으로 떨어진다 (open redirect 방어)', () => {
  for (const evil of [
    'https://evil.com',
    'http://evil.com/x',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    'javascript:alert(1)',
    '/ok\r\nLocation: https://evil.com',
  ]) {
    assert.equal(sanitizeReturnTo(evil), RETURN_TO_FALLBACK, `통과하면 안 됨: ${evil}`)
  }
})

test('빈 값·과도한 길이는 fallback', () => {
  assert.equal(sanitizeReturnTo(null), RETURN_TO_FALLBACK)
  assert.equal(sanitizeReturnTo(undefined), RETURN_TO_FALLBACK)
  assert.equal(sanitizeReturnTo(''), RETURN_TO_FALLBACK)
  assert.equal(sanitizeReturnTo('/' + 'a'.repeat(3000)), RETURN_TO_FALLBACK)
})

test('fallback은 호출부가 바꿀 수 있다', () => {
  assert.equal(sanitizeReturnTo('//evil.com', '/admin/settings'), '/admin/settings')
})

test('appendParams는 기존 쿼리를 보존하고 같은 키만 덮어쓴다', () => {
  assert.equal(
    appendParams('/admin/settings?tab=integrations', { drive: 'connected' }),
    '/admin/settings?tab=integrations&drive=connected',
  )
  assert.equal(
    appendParams('/admin/settings?drive=error', { drive: 'connected' }),
    '/admin/settings?drive=connected',
  )
  assert.equal(appendParams('/home', { a: '1' }), '/home?a=1')
})

test('appendParams는 해시를 뒤에 유지한다', () => {
  assert.equal(appendParams('/x?a=1#sec', { b: '2' }), '/x?a=1&b=2#sec')
})

test('withReturnTo는 복귀 주소를 안전화해서 실어 보낸다', () => {
  assert.equal(
    withReturnTo('/api/auth/google-drive', '/admin/settings?tab=integrations'),
    '/api/auth/google-drive?returnTo=%2Fadmin%2Fsettings%3Ftab%3Dintegrations',
  )
  // 외부 주소를 넣어도 fallback으로 치환되어 나간다
  assert.equal(
    withReturnTo('/api/auth/google-drive', 'https://evil.com'),
    `/api/auth/google-drive?returnTo=${encodeURIComponent(RETURN_TO_FALLBACK)}`,
  )
})
