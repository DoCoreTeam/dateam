import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO, blockedDemoOutcome, describeDemoFailure, demoStatusBadge, interpretDemoResponse, readDemoBody } from './dev-demo.ts'

const EM_DASH = '—'
const EMOJI = /\p{Extended_Pictographic}/u

test('2xx 이고 JSON 이면 실패가 아니다', () => {
  assert.equal(describeDemoFailure(200, true), null)
  assert.equal(describeDemoFailure(201, true), null)
})

test('401 은 키가 틀렸다고 말하고 상태 번호를 배지에 싣는다', () => {
  const f = describeDemoFailure(401, true)
  assert.ok(f)
  assert.equal(f.badge, 'HTTP 401')
  assert.match(f.message, /API 키가 맞지 않거나 만료/)
  assert.doesNotMatch(f.message, /GPU 구성/)
})

test('403 은 권한 범위를 말한다', () => {
  const f = describeDemoFailure(403, true)
  assert.equal(f?.badge, 'HTTP 403')
  assert.match(f?.message ?? '', /권한/)
})

test('429 는 Retry-After 초를 말하고, 없거나 이상하면 잠시 후라고 말한다', () => {
  assert.match(describeDemoFailure(429, true, '30')?.message ?? '', /30초 뒤에/)
  assert.match(describeDemoFailure(429, true, null)?.message ?? '', /잠시 후/)
  assert.match(describeDemoFailure(429, true, 'Wed, 21 Oct 2026 07:28:00 GMT')?.message ?? '', /잠시 후/)
  assert.match(describeDemoFailure(429, true, '0')?.message ?? '', /잠시 후/)
})

test('5xx 는 서버 쪽 실패라고 말한다', () => {
  for (const s of [500, 502, 503]) {
    const f = describeDemoFailure(s, false)
    assert.equal(f?.badge, `HTTP ${s}`)
    assert.match(f?.message ?? '', /서버가 요청을 처리하지 못했습니다/)
  }
})

test('그 밖의 상태는 번호를 문장에 싣는다', () => {
  const f = describeDemoFailure(404, true)
  assert.equal(f?.badge, 'HTTP 404')
  assert.match(f?.message ?? '', /404/)
})

test('status 0 은 연결 실패다', () => {
  const f = describeDemoFailure(0, false)
  assert.equal(f?.badge, DEMO.unreachableBadge)
  assert.match(f?.message ?? '', /연결하지 못했습니다/)
})

test('2xx 인데 JSON 이 아니면 결과를 그릴 수 없다고 말한다', () => {
  const f = describeDemoFailure(200, false)
  assert.equal(f?.badge, 'HTTP 200')
  assert.match(f?.message ?? '', /JSON 형식이 아니어서/)
})

test('readDemoBody 는 HTML 에 던지지 않고 JSON 객체만 받는다', () => {
  assert.deepEqual(readDemoBody('<!DOCTYPE html><html></html>'), { isJson: false, body: null })
  assert.deepEqual(readDemoBody(''), { isJson: false, body: null })
  assert.deepEqual(readDemoBody('[1,2]'), { isJson: false, body: null })
  assert.deepEqual(readDemoBody('null'), { isJson: false, body: null })
  assert.deepEqual(readDemoBody('{"success":true}'), { isJson: true, body: { success: true } })
})

test('demoStatusBadge 는 실제 번호를 쓴다', () => {
  assert.equal(demoStatusBadge(201), 'HTTP 201')
})

test('화면 말에 전각 대시와 이모지가 없다', () => {
  const values = [
    ...Object.values(DEMO),
    ...[0, 200, 401, 403, 404, 429, 500].map((s) => describeDemoFailure(s, false, '5')?.message ?? ''),
  ]
  for (const v of values) {
    assert.ok(!v.includes(EM_DASH), v)
    assert.ok(!EMOJI.test(v), v)
  }
})

test('가짜 키로 받은 401 JSON 은 GPU 구성 문장이 아니라 401 이유가 된다', () => {
  const o = interpretDemoResponse(401, '{"success":false,"error":"Invalid API key"}', null)
  assert.equal(o.status, 401)
  assert.equal(o.failure?.badge, 'HTTP 401')
  assert.match(o.failure?.message ?? '', /API 키가 맞지 않거나/)
  assert.deepEqual(o.body, { success: false, error: 'Invalid API key' })
})

test('HTML 로 온 502 는 원문을 글로만 들고 5xx 이유를 낸다', () => {
  const html = '<html><body>Bad Gateway</body></html>'
  const o = interpretDemoResponse(502, html)
  assert.equal(o.body, null)
  assert.equal(o.text, html)
  assert.equal(o.failure?.badge, 'HTTP 502')
  assert.match(o.failure?.message ?? '', /서버가 요청을 처리하지 못했습니다/)
})

test('429 응답의 Retry-After 가 문장에 들어간다', () => {
  assert.match(interpretDemoResponse(429, '{}', '12').failure?.message ?? '', /12초 뒤에/)
})

test('200 JSON 은 실패가 없고 본문을 그대로 넘긴다', () => {
  const o = interpretDemoResponse(200, '{"success":true,"data":[]}')
  assert.equal(o.failure, null)
  assert.equal(o.status, 200)
})

test('보내기 전에 막은 결과는 상태가 없고 보내지 않음 배지를 단다', () => {
  const o = blockedDemoOutcome(DEMO.keyMissing)
  assert.equal(o.status, null)
  assert.equal(o.failure?.badge, DEMO.notSent)
  assert.equal(o.failure?.message, DEMO.keyMissing)
})
