import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafeImageSrc } from './image-src.ts'

test('바깥 주소 이미지는 그리지 않는다', () => {
  for (const src of [
    'https://evil.example/x.png?q=secret',
    'http://evil.example/x.png',
    '//evil.example/x.png',
    '/\\evil.example/x.png',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    '',
    undefined,
  ]) {
    assert.equal(isSafeImageSrc(src), false, String(src))
  }
})

test('자기 출처와 data 이미지는 그린다', () => {
  assert.equal(isSafeImageSrc('/api/ai/files/abc.png'), true)
  assert.equal(isSafeImageSrc('data:image/png;base64,iVBORw0KGgo='), true)
})
