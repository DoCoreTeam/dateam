// 설정 클래스 이름 가드
//
// ci-status 와 ci-basis 는 이름이 「콘텐츠 인텔리전스 전용」처럼 보였다.
// 그래서 영업 CRM 은 같은 뜻을 자기 CSS 로 또 적었고, 관리자 카드는 인라인 style 로 칠했다.
// 같은 뜻이 세 화면에서 세 가지로 보이던 원인이 이름 하나였다.
//
// 이 가드는 그 이름이 다시 들어오는 것을 막는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/web */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCAN_DIRS = ['app', 'components', 'lib']
const EXT = /\.(tsx?|css)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

/** 이 가드 자신은 옛 이름을 규칙으로 갖고 있다. 스스로를 위반으로 세지 않는다 */
const SELF = fileURLToPath(import.meta.url)
const FILES = SCAN_DIRS.flatMap((d) => walk(join(WEB, d))).filter((f) => f !== SELF)
const read = (f: string) => readFileSync(f, 'utf8')
const rel = (f: string) => relative(WEB, f)

test('스캔이 살아 있다 — 파일을 하나도 못 찾으면 아래 단정이 전부 무의미해진다', () => {
  assert.ok(FILES.length > 500, `훑은 파일이 ${FILES.length}개뿐이다. 스캔이 깨졌다`)
})

test('옛 이름 ci-status 와 ci-basis 가 0건이다', () => {
  const offenders = FILES
    .filter((f) => /\bci-(status|basis)\b/.test(read(f)))
    .map(rel)
  assert.deepEqual(offenders, [],
    `옛 클래스 이름이 남아 있다(같은 뜻이 화면마다 갈리는 원인): ${offenders.join(', ')}`)
})

test('상태 배지 색은 globals.css 한 곳에서만 정해진다', () => {
  const css = read(join(WEB, 'app', 'globals.css'))
  for (const tone of ['ok', 'warn', 'danger', 'info', 'neutral']) {
    const rule = new RegExp(`^\\.status-pill-${tone}\\s*\\{`, 'm')
    assert.match(css, rule, `status-pill-${tone} 규칙이 없다`)
  }
})

test('쓰이는 상태 변형이 전부 정의되어 있다', () => {
  // 실측 사고: ci-status-success 가 한 곳에서 쓰였는데 정의된 적이 없어 그 배지만 색이 없었다.
  // className 만 훑는 스캐너는 상수 맵 안의 이름을 못 봐서 이것을 놓쳤다.
  const css = read(join(WEB, 'app', 'globals.css'))
  const defined = new Set([...css.matchAll(/^\.(status-pill-[a-z]+)\s*\{/gm)].map((m) => m[1]))
  const used = new Set<string>()
  for (const f of FILES) {
    if (f.endsWith('globals.css')) continue
    for (const m of read(f).matchAll(/\bstatus-pill-([a-z]+)\b/g)) used.add(`status-pill-${m[1]}`)
  }
  const undefinedOnes = [...used].filter((u) => !defined.has(u)).sort()
  assert.deepEqual(undefinedOnes, [],
    `정의되지 않은 상태 클래스를 쓰고 있다(그 배지만 색이 안 붙는다): ${undefinedOnes.join(', ')}`)
})
