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

/* 재시도와 커서 예시 (P0166): 고친 것마다 단정 하나 */

function lang(id: string) {
  const l = LANGUAGES.find(x => x.id === id)
  assert.ok(l, `language ${id} exists`)
  return l!
}

// import 블록의 패키지와 본문에서 부르는 패키지가 정확히 같아야 go build 가 통과한다
function goImportsMatchUse(src: string): { imported: string[]; used: string[] } {
  const block = src.match(/import \(([\s\S]*?)\)/)
  const imported = block ? [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]).sort() : []
  const body = block ? src.slice(src.indexOf(block[0]) + block[0].length) : src
  const used = imported.filter(p => new RegExp(`\\b${p.split('/').pop()}\\.`).test(body))
  const known = ['fmt', 'io', 'net/http', 'net/url', 'os', 'strconv', 'strings', 'time', 'encoding/json']
  for (const p of known) {
    if (!imported.includes(p) && new RegExp(`\\b${p.split('/').pop()}\\.[A-Z]`).test(body)) used.push(p)
  }
  return { imported, used: [...new Set(used)].sort() }
}

test('curl 재시도: Retry-After 헤더 끝의 \\r 을 지운다', () => {
  assert.match(lang('curl').retry(BASE), /\| tr -d '\\r'/)
})

test('go: 모든 예시가 쓰는 패키지만 정확히 import 한다', () => {
  const go = lang('go')
  for (const src of [go.generate(GET_SPEC, BASE), go.generate(POST_SPEC, BASE), go.retry(BASE), go.paginate(BASE)]) {
    const { imported, used } = goImportsMatchUse(src)
    assert.deepEqual(imported, used, src.slice(0, 200))
  }
})

test('java 이어 받기: 반복마다 cursor 를 응답 값으로 바꾼다', () => {
  const src = lang('java').paginate(BASE)
  const loop = src.slice(src.indexOf('do {'), src.indexOf('} while'))
  assert.match(loop, /\n\s+cursor = [^;]+;/)
})

test('go java csharp 이어 받기: 커서를 주소에 넣기 전에 인코딩한다', () => {
  assert.match(lang('go').paginate(BASE), /url\.QueryEscape\(cursor\)/)
  assert.match(lang('java').paginate(BASE), /URLEncoder\.encode\(cursor, StandardCharsets\.UTF_8\)/)
  assert.match(lang('csharp').paginate(BASE), /Uri\.EscapeDataString\(cursor\)/)
})

test('모든 언어 재시도: 429 는 Retry-After 로 최대 3번, 5xx 는 1초 뒤 1번', () => {
  for (const l of LANGUAGES) {
    const src = l.retry(BASE)
    assert.match(src, /429|TooManyRequests/, `${l.id}: 429`)
    assert.match(src, /retry-?after/i, `${l.id}: Retry-After`)
    assert.match(src, /<= 3|< 3|1 2 3 4/, `${l.id}: 최대 3번`)
    assert.match(src, /retried_?5xx ?= ?(true|True|1)/, `${l.id}: 5xx 는 한 번만`)
    assert.match(src, /sleep\(?1\b|sleep 1|Sleep\(time\.Second\)|Sleep\(1000\)|FromSeconds\(1\)|1000\)\)/i, `${l.id}: 1초`)
  }
})

test('javascript: 맨 위 await 없이 CommonJS 스크립트로 파싱된다', async () => {
  const { Script } = await import('node:vm')
  const js = lang('javascript')
  for (const src of [js.generate(GET_SPEC, BASE), js.generate(POST_SPEC, BASE), js.retry(BASE), js.paginate(BASE)]) {
    assert.doesNotThrow(() => new Script(src), src.slice(0, 120))
  }
})
