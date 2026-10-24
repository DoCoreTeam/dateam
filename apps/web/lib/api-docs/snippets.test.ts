import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LANGUAGES, placeholderPath, type RequestSpec } from './snippets.ts'
import { ENDPOINTS, requestSpecOf } from './registry.ts'

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

/* 등록부의 모든 창구로 만든 예시 (P0168): 본문이 실리고 경로 변수가 자리표시로 바뀐다 */

const ALL = ENDPOINTS.map((e) => ({ e, spec: requestSpecOf(e) }))

/** 본문에 든 키 이름과 글자 값 전부, 중첩된 줄 안까지 */
function leaves(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => leaves(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); leaves(x, out) }
  else if (typeof v === 'string' || typeof v === 'number') out.push(String(v))
  return out
}

test('★ 본문을 받는 창구(POST, PATCH)는 예시 본문을 싣는다', () => {
  const writes = ALL.filter(({ e }) => e.method === 'POST' || e.method === 'PATCH')
  assert.ok(writes.length >= 20, `POST PATCH 창구를 너무 적게 찾았다(${writes.length})`)
  const missing = writes.filter(({ spec }) => !spec.body || Object.keys(spec.body).length === 0).map(({ e }) => e.id)
  assert.deepEqual(missing, [], '본문 없는 예시는 붙여 넣으면 400 이다')
})

test('★ 7개 언어 모두 POST PATCH 예시에 본문의 키와 값을 빠짐없이 싣는다', () => {
  let checked = 0
  const lost: string[] = []
  for (const { e, spec } of ALL) {
    if (spec.body === undefined) continue
    const want = leaves(spec.body)
    assert.ok(want.length > 0, `${e.id} 본문이 비었다`)
    for (const l of LANGUAGES) {
      checked++
      const out = l.generate(spec, BASE)
      for (const w of want) if (!out.includes(w)) lost.push(`${e.id} ${l.id}: ${w}`)
    }
  }
  assert.ok(checked >= 20 * LANGUAGES.length, `대조한 예시가 너무 적다(${checked})`)
  assert.deepEqual(lost, [], '예시 본문에서 빠진 칸:\n  ' + lost.join('\n  '))
})

test('★ 어떤 예시에도 :id 나 {id} 꼴 경로 변수가 남지 않는다, <id> 로 바뀐다', () => {
  let withParam = 0
  const left: string[] = []
  for (const { e, spec } of ALL) {
    const hasParam = /\{\w+\}/.test(spec.path)
    if (hasParam) withParam++
    for (const l of LANGUAGES) {
      const out = l.generate(spec, BASE)
      const urlish = out.split('\n').filter((line) => line.includes(BASE)).join('\n')
      if (/\/:\w+|\{\w+\}/.test(urlish)) left.push(`${e.id} ${l.id}`)
      if (hasParam && !/\/<\w+>/.test(urlish)) left.push(`${e.id} ${l.id}: 자리표시 없음`)
    }
  }
  assert.ok(withParam >= 10, `경로 변수가 있는 창구를 너무 적게 찾았다(${withParam})`)
  assert.deepEqual(left, [], '붙여 넣으면 404 인 주소:\n  ' + left.join('\n  '))
  assert.equal(placeholderPath('/crm/companies/:id'), '/crm/companies/<id>')
  assert.equal(placeholderPath('/crm/quotes/{id}/export'), '/crm/quotes/<id>/export')
})

test('curl: 주소를 따옴표로 감싸고, 본문의 작은따옴표를 셸에서 깨지지 않게 넣는다', () => {
  const out = gen('curl', { method: 'POST', path: '/crm/companies/{id}', query: { a: '1', b: '2' }, body: { name: "O'Neil" } })
  assert.match(out, /curl -X POST "https:\/\/api\.example\.com\/api\/public\/v1\/crm\/companies\/<id>\?a=1&b=2"/)
  assert.ok(out.includes(`-d '{"name":"O'\\''Neil"}'`), out)
})

test('java csharp: 본문의 역슬래시를 먼저 이스케이프한다', () => {
  const spec: RequestSpec = { method: 'POST', path: '/x', body: { memo: 'a\\b' } }
  // JSON 은 a\\b, 문자열 리터럴 안에서는 a\\\\b 여야 서버가 a\b 를 받는다
  assert.ok(gen('java', spec).includes('\\"memo\\":\\"a\\\\\\\\b\\"'), gen('java', spec))
  assert.ok(gen('csharp', spec).includes('\\"memo\\":\\"a\\\\\\\\b\\"'), gen('csharp', spec))
})

test('쿼리 자리표시(<workspace_id>)는 인코딩하지 않고 그대로 보인다', () => {
  const out = gen('python', { method: 'POST', path: '/ci/channels', query: { workspaceId: '<workspace_id>' }, body: { input: '@x' } })
  assert.ok(out.includes('/ci/channels?workspaceId=<workspace_id>'), out)
})
