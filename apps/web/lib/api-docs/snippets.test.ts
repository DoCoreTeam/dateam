import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LANGUAGES, type RequestSpec } from './snippets.ts'

const BASE = 'https://api.example.com/api/public/v1'

const GET_SPEC: RequestSpec = { method: 'GET', path: '/products', query: { page: '1', limit: '20' } }
const POST_SPEC: RequestSpec = {
  method: 'POST',
  path: '/quote',
  body: { model: 'A100', quantity: 4, margin: 0.2 },
}

function gen(id: string, spec: RequestSpec): string {
  const lang = LANGUAGES.find(l => l.id === id)
  assert.ok(lang, `language ${id} exists`)
  return lang!.generate(spec, BASE)
}

test('7개 언어 정의가 모두 존재한다', () => {
  assert.deepEqual(
    LANGUAGES.map(l => l.id),
    ['curl', 'javascript', 'python', 'go', 'php', 'java', 'csharp'],
  )
})

test('모든 언어가 GET 스펙에서 URL과 인증헤더를 포함한다', () => {
  for (const lang of LANGUAGES) {
    const out = lang.generate(GET_SPEC, BASE)
    assert.match(out, /\/products\?page=1&limit=20/, `${lang.id}: URL+query`)
    assert.match(out, /X-API-Key/, `${lang.id}: 인증 헤더`)
  }
})

test('생성은 결정적이다(같은 입력→같은 출력)', () => {
  for (const lang of LANGUAGES) {
    assert.equal(lang.generate(POST_SPEC, BASE), lang.generate(POST_SPEC, BASE), `${lang.id} 결정성`)
  }
})

test('curl: GET은 -X 없음, POST는 -X POST + 바디', () => {
  assert.doesNotMatch(gen('curl', GET_SPEC), /-X GET/)
  const post = gen('curl', POST_SPEC)
  assert.match(post, /-X POST/)
  assert.match(post, /"model":"A100"/)
})

test('javascript: 서버사이드 fetch + JSON.stringify 바디', () => {
  const post = gen('javascript', POST_SPEC)
  assert.match(post, /await fetch\(/)
  assert.match(post, /process\.env\.AX_API_KEY/)
  assert.match(post, /JSON\.stringify/)
})

test('python: requests + True/None 변환(파이썬 리터럴)', () => {
  const spec: RequestSpec = { method: 'POST', path: '/x', body: { a: true, b: null } }
  const out = gen('python', spec)
  assert.match(out, /requests\.post/)
  assert.match(out, /True/)
  assert.match(out, /None/)
  assert.doesNotMatch(out, /: true/)
})

test('go: net/http + 바디 있을 때 strings import', () => {
  assert.match(gen('go', POST_SPEC), /strings\.NewReader/)
  assert.doesNotMatch(gen('go', GET_SPEC), /strings\.NewReader/)
})

test('php: curl_setopt CUSTOMREQUEST + POSTFIELDS', () => {
  const out = gen('php', POST_SPEC)
  assert.match(out, /curl_init/)
  assert.match(out, /CURLOPT_POSTFIELDS/)
})

test('java: HttpClient + method() 호출', () => {
  assert.match(gen('java', POST_SPEC), /HttpClient\.newHttpClient/)
  assert.match(gen('java', POST_SPEC), /\.method\("POST"/)
})

test('csharp: HttpRequestMessage + HttpMethod.Post', () => {
  assert.match(gen('csharp', POST_SPEC), /HttpRequestMessage/)
  assert.match(gen('csharp', POST_SPEC), /HttpMethod\.Post/)
})
