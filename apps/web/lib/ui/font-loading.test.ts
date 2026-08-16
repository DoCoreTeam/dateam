import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..')

// 왜 이 가드가 있나 (v0.7.490 퍼포먼스 조사, docs/2026-08-16-performance-audit/PLAN.md §2-3):
//   globals.css 1행이 외부 CDN 2곳을 `@import` 했고, 그 끝에 **2,057,688 B(2.0MB)**
//   단일 폰트가 매달려 있었다. 첫 글자가 뜨기 전에 DNS→TLS→CSS→폰트가 직렬로 이어졌다.
//   되돌리기 쉬운 한 줄이라(폰트 하나 추가할 때 @import가 가장 손쉽다) 가드로 잠근다.

test('★ CSS에서 폰트를 @import 하지 않는다 — 직렬 체인이 첫 페인트 앞에 놓인다', () => {
  const css = readFileSync(join(web, 'app/globals.css'), 'utf8')
  assert.doesNotMatch(css, /@import\s+url\(/, 'globals.css에 @import가 다시 생겼다')
})

test('★ 폰트를 외부 출처에서 받지 않는다 — DNS·TLS 왕복이 첫 페인트를 막는다', () => {
  const targets = ['app/globals.css', 'app/layout.tsx', 'public/fonts/fonts.css']
  for (const f of targets) {
    const src = readFileSync(join(web, f), 'utf8')
    assert.doesNotMatch(src, /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net/,
      `${f}가 외부 폰트 출처를 다시 참조한다`)
  }
})

test('★ 루트 레이아웃이 폰트 CSS를 <link>로 건다 — 없으면 글꼴이 통째로 안 뜬다', () => {
  const src = readFileSync(join(web, 'app/layout.tsx'), 'utf8')
  assert.match(src, /<link\s+rel="stylesheet"\s+href="\/fonts\/fonts\.css"/,
    '폰트 CSS 링크가 없다')
})

test('선언한 폰트 조각이 실제로 존재한다 — 하나라도 없으면 그 글자만 조용히 깨진다', () => {
  const css = readFileSync(join(web, 'public/fonts/fonts.css'), 'utf8')
  const urls = Array.from(css.matchAll(/url\((\/fonts\/[^)]+\.woff2)\)/g)).map((m) => m[1])
  assert.ok(urls.length > 150, `조각 선언이 ${urls.length}개뿐이다 — 서브셋이 통째로 빠졌다`)
  const missing = urls.filter((u) => {
    try { return !statSync(join(web, 'public', u.replace(/^\//, ''))).isFile() } catch { return true }
  })
  assert.deepEqual(missing, [], '선언했는데 없는 폰트 조각')
})

test('쓰지 않는 폰트 조각을 저장소에 두지 않는다', () => {
  const css = readFileSync(join(web, 'public/fonts/fonts.css'), 'utf8')
  const declared = new Set(
    Array.from(css.matchAll(/url\((\/fonts\/[^)]+\.woff2)\)/g)).map((m) => m[1].replace(/^\//, '')),
  )
  const found: string[] = []
  for (const dir of ['fonts/pretendard', 'fonts/nanum-pen']) {
    for (const f of readdirSync(join(web, 'public', dir))) {
      if (f.endsWith('.woff2')) found.push(`${dir}/${f}`)
    }
  }
  const orphan = found.filter((f) => !declared.has(f))
  assert.deepEqual(orphan, [], '선언되지 않은 폰트 파일이 남아 있다')
})

test('★ 폰트에 영구 캐시 헤더를 준다 — 조각 185개면 조건부 요청도 185번이다', () => {
  const cfg = readFileSync(join(web, 'next.config.js'), 'utf8')
  assert.match(cfg, /source:\s*'\/fonts\/:path\*'/, '폰트 캐시 헤더 규칙이 없다')
  assert.match(cfg, /max-age=31536000,\s*immutable/, '폰트 캐시가 영구가 아니다')
})
