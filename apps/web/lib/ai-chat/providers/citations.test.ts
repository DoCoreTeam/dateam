import { test } from 'node:test'
import assert from 'node:assert/strict'
// 순수 매퍼만 import (값 import는 provider 어댑터의 export 함수 한정 — @/ 값 import 없음)
import { mapClaudeWebSearchResults, mapClaudeCitation, isHttpUrl } from './claude.ts'
import { mapGeminiGroundingChunks } from './gemini.ts'

test('isHttpUrl: http/https만 허용, javascript:/data:/빈값 거부 (L-2)', () => {
  assert.equal(isHttpUrl('https://a.com'), true)
  assert.equal(isHttpUrl('http://a.com'), true)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
  assert.equal(isHttpUrl('data:text/html,x'), false)
  assert.equal(isHttpUrl(''), false)
  assert.equal(isHttpUrl('not a url'), false)
})

test('citation 매퍼는 비-http 스킴 URL을 제외한다 (L-2)', () => {
  const claude = mapClaudeWebSearchResults([
    { type: 'web_search_result', url: 'https://ok.com', title: 'ok' },
    { type: 'web_search_result', url: 'javascript:alert(1)', title: 'evil' },
  ])
  assert.deepEqual(claude.map((c) => c.url), ['https://ok.com'])
  assert.equal(mapClaudeCitation({ url: 'javascript:alert(1)', title: 'x' }), null)
  const gem = mapGeminiGroundingChunks([
    { web: { uri: 'https://ok.com', title: 'ok' } },
    { web: { uri: 'data:text/html,x', title: 'evil' } },
  ])
  assert.deepEqual(gem.map((c) => c.url), ['https://ok.com'])
})

test('mapClaudeWebSearchResults: web_search_result → AiChatCitation', () => {
  const out = mapClaudeWebSearchResults([
    { type: 'web_search_result', url: 'https://a.com', title: 'A' },
    { type: 'web_search_result', url: 'https://b.com', title: 'B' },
  ])
  assert.deepEqual(out, [
    { url: 'https://a.com', title: 'A' },
    { url: 'https://b.com', title: 'B' },
  ])
})

test('mapClaudeWebSearchResults: dedupe by url (first wins)', () => {
  const out = mapClaudeWebSearchResults([
    { type: 'web_search_result', url: 'https://a.com', title: 'A1' },
    { type: 'web_search_result', url: 'https://a.com', title: 'A2' },
    { type: 'web_search_result', url: 'https://c.com', title: 'C' },
  ])
  assert.deepEqual(out, [
    { url: 'https://a.com', title: 'A1' },
    { url: 'https://c.com', title: 'C' },
  ])
})

test('mapClaudeWebSearchResults: skip error/non-result item + title falls back to url', () => {
  const out = mapClaudeWebSearchResults([
    { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
    { type: 'web_search_result', url: 'https://d.com' }, // title 없음
    { type: 'web_search_result', title: 'no-url' }, // url 없음 → skip
  ])
  assert.deepEqual(out, [{ url: 'https://d.com', title: 'https://d.com' }])
})

test('mapClaudeWebSearchResults: non-array input → []', () => {
  assert.deepEqual(mapClaudeWebSearchResults(undefined), [])
  assert.deepEqual(mapClaudeWebSearchResults(null), [])
  assert.deepEqual(mapClaudeWebSearchResults({ type: 'web_search_tool_result_error' }), [])
})

test('mapClaudeCitation: web_search_result_location → citation with snippet', () => {
  assert.deepEqual(
    mapClaudeCitation({ url: 'https://e.com', title: 'E', cited_text: 'quoted' }),
    { url: 'https://e.com', title: 'E', snippet: 'quoted' },
  )
  // title 없으면 url 대체, cited_text 없으면 snippet 생략
  assert.deepEqual(mapClaudeCitation({ url: 'https://f.com' }), { url: 'https://f.com', title: 'https://f.com' })
  // url 없으면 null
  assert.equal(mapClaudeCitation({ title: 'x' }), null)
})

test('mapGeminiGroundingChunks: groundingChunks → AiChatCitation', () => {
  const out = mapGeminiGroundingChunks([
    { web: { uri: 'https://a.com', title: 'A' } },
    { web: { uri: 'https://b.com', title: 'B' } },
  ])
  assert.deepEqual(out, [
    { url: 'https://a.com', title: 'A' },
    { url: 'https://b.com', title: 'B' },
  ])
})

test('mapGeminiGroundingChunks: dedupe by uri + skip chunks missing web', () => {
  const out = mapGeminiGroundingChunks([
    { web: { uri: 'https://a.com', title: 'A1' } },
    { retrievedContext: { text: 'no web here' } }, // web 없음 → skip
    { web: { uri: 'https://a.com', title: 'A2' } }, // 중복 uri → skip
    { web: { uri: 'https://g.com' } }, // title 없음 → uri 대체
  ])
  assert.deepEqual(out, [
    { url: 'https://a.com', title: 'A1' },
    { url: 'https://g.com', title: 'https://g.com' },
  ])
})

test('mapGeminiGroundingChunks: non-array input → []', () => {
  assert.deepEqual(mapGeminiGroundingChunks(undefined), [])
  assert.deepEqual(mapGeminiGroundingChunks(null), [])
  assert.deepEqual(mapGeminiGroundingChunks({}), [])
})
