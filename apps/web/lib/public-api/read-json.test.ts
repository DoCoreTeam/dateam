/**
 * 깨진 JSON 본문이 예외로 새지 않고 실패 값으로 돌아오는지 본다
 *
 * **왜**: 예외가 라우트 catch 로 가면 400 이어야 할 것이 500 으로 답했다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJsonBody, INVALID_JSON_MESSAGE } from './read-json.ts'

const URL_ = 'http://localhost/api/public/v1/quote'

function post(body: string): Request {
  return new Request(URL_, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
}

test('올바른 JSON 본문은 ok 와 값을 돌려준다', async () => {
  // Arrange
  const request = post('{"items":[{"product_id":"a","quantity":1}]}')
  // Act
  const result = await readJsonBody(request)
  // Assert
  assert.deepEqual(result, { ok: true, body: { items: [{ product_id: 'a', quantity: 1 }] } })
})

test('깨진 JSON 본문은 던지지 않고 ok false 를 돌려준다', async () => {
  // Arrange
  const request = post('{"items": [')
  // Act
  const result = await readJsonBody(request)
  // Assert
  assert.deepEqual(result, { ok: false })
})

test('빈 본문도 ok false 다', async () => {
  // Arrange
  const request = post('')
  // Act
  const result = await readJsonBody(request)
  // Assert
  assert.equal(result.ok, false)
})

test('실패 문구는 한국어이고 내부 구조를 싣지 않는다', () => {
  // Arrange, Act, Assert
  assert.match(INVALID_JSON_MESSAGE, /[가-힣]/)
  assert.doesNotMatch(INVALID_JSON_MESSAGE, /SyntaxError|Unexpected|position/i)
})

test('quote 창구가 request.json() 대신 readJsonBody 와 fail 400 을 쓴다', () => {
  // Arrange
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '../../app/api/public/v1/quote/route.ts'), 'utf8')
  // Act
  const callsRawJson = /request\.json\(\)/.test(src)
  // Assert
  assert.equal(callsRawJson, false, 'quote 가 request.json() 을 직접 부른다')
  assert.match(src, /readJsonBody\(request\)/)
  assert.match(src, /fail\(400,\s*INVALID_JSON_MESSAGE/)
})
