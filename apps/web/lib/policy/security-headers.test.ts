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
  const csp =
    valueOf(headers, 'Content-Security-Policy') ??
    valueOf(headers, 'Content-Security-Policy-Report-Only')
  assert.ok(csp, 'CSP 가 없다 — 보고용(Report-Only)이라도 있어야 무엇이 걸리는지 안다')
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

test('CSP 뼈대 지시문이 살아 있다', async () => {
  const headers = await rootHeadersAsync()
  const csp =
    valueOf(headers, 'Content-Security-Policy') ??
    valueOf(headers, 'Content-Security-Policy-Report-Only') ??
    ''
  for (const directive of [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]) {
    assert.ok(csp.includes(directive), `CSP 에 ${directive} 가 없다`)
  }
})

test('CSP 를 강제로 올리면 script-src 의 unsafe-inline 을 뺀다', async () => {
  const enforced = valueOf(await rootHeadersAsync(), 'Content-Security-Policy')
  if (!enforced) return // 아직 보고용 단계 — 이 규칙은 승격하는 순간부터 돈다
  const scriptSrc = enforced.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'))
  assert.ok(scriptSrc, '강제 CSP 에 script-src 가 없다')
  assert.ok(
    !scriptSrc.includes("'unsafe-inline'"),
    "강제하면서 'unsafe-inline' 을 남기면 XSS 를 못 막는다 — nonce 를 붙이고 올린다",
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
  //   Next 14.2 계열의 이미지 최적화 원격 코드 실행은 15.5.24 이상에만 고침이 있다.
  //   `images.unoptimized` 만으로는 안 닫힌다(컴포넌트 쪽만 바뀐다) — 미들웨어가 닫는다.
  const mw = readFileSync(join(WEB, 'middleware.ts'), 'utf8')
  assert.match(
    mw,
    /pathname === '\/_next\/image'/,
    '미들웨어가 /_next/image 를 막지 않는다 — 열면 Next 를 15 이상으로 먼저 올린다',
  )
  assert.match(mw, /'\/_next\/image',/, "matcher 에 '/_next/image' 가 없으면 위 분기가 아예 안 돈다")
})
