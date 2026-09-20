/**
 * 브라우저에 보내는 보안 헤더가 조용히 사라지지 않게 한다
 *
 * **왜**: 2026-09-13 보안 점검에서 실측해 보니 응답에 HSTS 도 CSP 도 없었다.
 *   nosniff·X-Frame-Options·Referrer-Policy 셋만 있었다.
 *   헤더는 한 줄 지워도 화면이 멀쩡해서, 지운 사실이 드러나는 자리가 없다.
 *   그래서 여기서 붙잡는다.
 *
 * 검사 넷:
 *   1) 모든 경로에 보내는 헤더 여섯이 다 있다
 *   2) HSTS 는 1년 이상이고 preload 를 안 붙인다 (되돌리는 데 몇 달 걸린다)
 *   3) CSP 의 뼈대 지시문이 살아 있다
 *   4) CSP 를 «강제»로 올릴 때는 script-src 에서 'unsafe-inline' 을 뺀다
 *      — 인라인을 허용한 채 강제하면 XSS 를 못 막으면서 막은 줄 알게 된다
 *   5) 서비스롤 키를 읽는 앱 코드는 server-only 로 잠근다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require_ = createRequire(import.meta.url)

type Header = { key: string; value: string }

async function rootHeadersAsync(): Promise<Header[]> {
  const config = require_(join(WEB, 'next.config.js')) as {
    headers: () => Promise<{ source: string; headers: Header[] }[]>
  }
  const groups = await config.headers()
  const root = groups.find((g) => g.source === '/(.*)')
  assert.ok(root, '모든 경로(/(.*))에 붙는 헤더 묶음이 없다')
  return root.headers
}

function valueOf(headers: Header[], key: string): string | null {
  return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value ?? null
}

test('모든 경로에 보내는 보안 헤더 여섯이 살아 있다', async () => {
  const headers = await rootHeadersAsync()
  for (const key of [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Strict-Transport-Security',
  ]) {
    assert.ok(valueOf(headers, key), `${key} 헤더가 없다`)
  }
  // CSP 는 여기 없다. 미들웨어가 요청마다 nonce 를 넣어 만든다(아래 검사).
  assert.equal(
    valueOf(headers, 'Content-Security-Policy-Report-Only'),
    null,
    '보고용 CSP 가 남아 있다 — 강제본과 둘이 실리면 무엇이 도는지 알 수 없다',
  )
})

test('HSTS 는 1년 이상이고 preload 를 붙이지 않는다', async () => {
  const hsts = valueOf(await rootHeadersAsync(), 'Strict-Transport-Security')
  assert.ok(hsts)
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)
  assert.ok(maxAge >= 31536000, `max-age 가 1년 미만이다: ${maxAge}`)
  assert.match(hsts, /includeSubDomains/i, '서브도메인을 빼면 쿠키가 그쪽으로 새 나간다')
  assert.doesNotMatch(
    hsts,
    /preload/i,
    'preload 는 목록에 오르면 몇 달 동안 못 내린다 — 서브도메인 전부가 HTTPS 여야 한다',
  )
})

/**
 * CSP 지시문을 **주석이 아니라 실제 줄에서** 읽는다.
 *
 * 왜: 예전 검사는 `mw.includes("object-src 'none'")` 이라 **주석에 그 글자가 있기만 해도**
 * 통과했다. 지시문을 지우고 「왜 지웠는지」를 주석에 적으면 가드가 초록으로 남는다.
 * 여기서는 따옴표로 감싼 한 줄(배열 원소)만 지시문으로 친다.
 */
function cspDirectives(mw: string): Map<string, string> {
  const start = mw.indexOf('return [')
  const body = start >= 0 ? mw.slice(start) : mw
  const out = new Map<string, string>()
  for (const m of body.matchAll(/^\s*[`"]([a-z-]+) ([^`"]*)[`"],\s*$/gm)) {
    if (!out.has(m[1])) out.set(m[1], m[2].trim())
  }
  return out
}

test('CSP 는 강제이고 뼈대 지시문이 살아 있다', () => {
  const mw = readFileSync(join(WEB, 'middleware.ts'), 'utf8')
  const directives = cspDirectives(mw)
  assert.ok(directives.size > 5, `CSP 지시문을 못 읽었다(${directives.size}) — 검사가 헛돈다`)
  for (const [name, value] of [
    ['default-src', "'self'"],
    ['frame-ancestors', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
  ] as const) {
    assert.equal(directives.get(name), value, `CSP 의 ${name} 가 ${value} 가 아니다`)
  }
  // https 로 들어온 요청에만 건다 — http 에 걸면 브라우저가 자기 자신을 못 부른다
  assert.match(mw, /isHttps \? \['upgrade-insecure-requests'\]/, 'https 요청에 upgrade-insecure-requests 가 없다')
  assert.match(mw, /x-forwarded-proto/, '프록시 뒤에서는 원래 프로토콜을 헤더에서 읽어야 한다')
  assert.match(
    mw,
    /res\.headers\.set\('Content-Security-Policy', csp\)/,
    '보고용이 아니라 강제로 보내야 한다 (Content-Security-Policy-Report-Only 가 아니다)',
  )
})

test('프레임에는 우리 것만 들어온다', () => {
  /*
    왜: 원본 대조가 PDF 를 화면 안에 그리려면 프레임이 필요해 `'none'` 을 열었다(v0.10.291).
    연 자리는 **같은 출처와 우리가 만든 blob 뿐**이다.

    여기서 바깥 주소(`https:`·`http:`·`*`·`data:`)가 한 번이라도 섞이면 아무 사이트나
    우리 화면 «안»에서 열리고, 그 화면은 사용자 눈에 우리 것으로 보인다. 로그인 화면을
    흉내 낸 쪽이 우리 주소창 아래에 앉는 것이라 값이 무엇인지까지 본다.
  */
  const directives = cspDirectives(readFileSync(join(WEB, 'middleware.ts'), 'utf8'))
  const frameSrc = directives.get('frame-src')
  assert.ok(frameSrc, 'frame-src 지시문이 없다 — 없으면 default-src 로 떨어져 무엇이 도는지 헷갈린다')
  const sources = frameSrc.split(/\s+/).filter(Boolean)
  assert.deepEqual(
    sources.filter((v) => v !== "'self'" && v !== 'blob:' && v !== "'none'"),
    [],
    `frame-src 에 우리 것이 아닌 출처가 있다: ${frameSrc}`,
  )
})

test('CSP 는 스크립트에 일회용 번호를 요구한다', () => {
  const mw = readFileSync(join(WEB, 'middleware.ts'), 'utf8')
  assert.match(mw, /'nonce-\$\{nonce\}' 'strict-dynamic'/, "script-src 에 nonce 와 strict-dynamic 이 있어야 한다")
  // 줄 단위로 본다. 소스에서는 지시문이 따로 따로 문자열이라 세미콜론이 없어,
  // 넓게 잡으면 다음 줄의 style-src 까지 삼킨다(실측으로 걸렸다).
  const scriptSrcLines = mw.split('\n').filter((l) => l.includes('script-src') && l.includes('nonce-'))
  assert.ok(scriptSrcLines.length > 0, 'script-src 가 없다')
  for (const line of scriptSrcLines) {
    assert.ok(
      !line.includes("'unsafe-inline'"),
      `강제하면서 script-src 에 'unsafe-inline' 을 남기면 XSS 를 못 막으면서 막은 줄 알게 된다\n  ${line.trim()}`,
    )
  }
  // eval 은 개발 서버 새로고침에만 필요하다. 운영 줄에 섞이면 CSP 가 사실상 무력해진다.
  assert.ok(
    scriptSrcLines.some((l) => !l.includes("'unsafe-eval'")),
    "운영용 script-src 가 없다 — 'unsafe-eval' 없는 줄이 하나는 있어야 한다",
  )
  assert.match(mw, /const isProd = process\.env\.NODE_ENV === 'production'/,
    '개발과 운영을 가르지 않으면 개발 편의가 운영으로 새 나간다')
  // 요청 헤더에 실어야 Next 가 자기 부트스트랩 스크립트에 nonce 를 붙인다.
  // 응답에만 달면 화면이 통째로 죽는다.
  assert.match(mw, /request\.headers\.set\('Content-Security-Policy', csp\)/,
    'nonce 를 요청 헤더에 안 실으면 Next 스크립트가 전부 막힌다')
  assert.match(mw, /request\.headers\.set\('x-nonce', nonce\)/, 'x-nonce 를 실어야 화면이 쓸 수 있다')
})

test('모든 응답 경로에 CSP 가 실린다', () => {
  const mw = readFileSync(join(WEB, 'middleware.ts'), 'utf8')
  const body = mw.slice(mw.indexOf('export async function middleware'))
  // `/_next/image` 404 는 문서가 아니라 예외다. 나머지 return 은 전부 withCsp 를 거친다.
  const returns = [...body.matchAll(/return (NextResponse\.[a-z]+\([^\n]*|supabaseResponse)/g)].map((m) => m[0])
  assert.deepEqual(
    returns.filter((r) => !r.includes('status: 404')),
    [],
    `CSP 를 안 붙이고 나가는 길이 있다\n  ${returns.join('\n  ')}\n  withCsp(...) 로 감싼다`,
  )
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

test('서비스롤 키를 읽는 앱 코드는 server-only 로 잠근다', () => {
  const roots = ['app', 'components', 'lib'].map((d) => join(WEB, d))
  const files = roots.flatMap((d) => walk(d))
  assert.ok(files.length > 100, `스캔 대상이 너무 적다(${files.length}) — 규칙이 헛돈다`)

  const leaky: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!src.includes('SUPABASE_SERVICE_ROLE_KEY')) continue
    if (/^import 'server-only'/m.test(src)) continue
    leaky.push(relative(WEB, f))
  }

  assert.deepEqual(
    leaky,
    [],
    `서비스롤 키를 읽으면서 server-only 가 없는 파일\n${leaky.join('\n')}\n\n` +
      `이 키는 RLS 를 통째로 지나간다. 클라이언트 번들에 끌려 들어가면 끝이다.\n` +
      `파일 맨 위에 다음 한 줄을 넣는다:\n  import 'server-only'`,
  )
})

test('이미지 최적화 창구는 닫혀 있다', () => {
  // 왜: `/_next/image` 는 우리가 안 써도 열려 있고, 실측으로 이미지를 실제 해독했다.
  //   next/image 를 부르는 화면은 0곳이므로 얻는 것 없이 공격면만 남는다.
  //   처음 닫은 이유는 14.2 계열의 원격 코드 실행이었고 15 에서 그 구멍은 메워졌지만,
  //   **안 쓰는 창구는 닫아 둔다** — 다음 구멍이 나도 우리와 무관해진다.
  //   `images.unoptimized` 만으로는 안 닫힌다(컴포넌트 쪽만 바뀐다). 미들웨어가 닫는다.
  const mw = readFileSync(join(WEB, 'middleware.ts'), 'utf8')
  assert.match(
    mw,
    /pathname === '\/_next\/image'/,
    '미들웨어가 /_next/image 를 막지 않는다 — 열면 Next 를 15 이상으로 먼저 올린다',
  )
  assert.match(mw, /'\/_next\/image',/, "matcher 에 '/_next/image' 가 없으면 위 분기가 아예 안 돈다")
})
