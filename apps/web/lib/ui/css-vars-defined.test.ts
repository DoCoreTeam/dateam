// lib/ui/css-vars-defined.test.ts — 「var(--x) 를 썼는데 --x 가 어디에도 없다」를 잡는다
//
// 왜: 정의 안 된 이름을 기본값 없이 쓰면 그 속성이 통째로 빠진다, 오류도 경고도 없다
//   2026-11-04 GPU 관리 화면이 --border --surface --radius-sm --radius-md 를 써서 표의 선과 배경,
//   단추 테두리가 전부 사라졌다 (사용자 지적 「디자인이나 정렬이 진짜 완전 깨지는데」)
//   훑어 보니 같은 꼴이 CSS 모듈 열여섯 곳에 있었다. css-defined.test.ts 는 클래스만 보고 토큰은 안 봤다
//
// 정의로 치는 곳: 모든 CSS 의 `--x:` 와 코드의 `'--x'` (style={{ '--slots': n }} 처럼 화면이 넣는 값)
// 기본값이 있는 var(--x, 값) 은 빠지지 않으므로 세지 않는다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'

const cssFiles = [...new Set([...walkFiles('app', ['.css']), ...walkFiles('components', ['.css'])])]
const codeFiles = [...walkFiles('app'), ...walkFiles('components'), ...walkFiles('lib')]

function definedVars(): Set<string> {
  const out = new Set<string>()
  for (const f of cssFiles) for (const m of read(f).matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1])
  for (const f of codeFiles) for (const m of read(f).matchAll(/['"`](--[\w-]+)['"`]/g)) out.add(m[1])
  return out
}

/** 기본값 없는 var(--x) 만 — 주석 안은 뺀다 */
export function bareVarsIn(css: string): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...body.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1])
}

test('bareVarsIn: 기본값 있는 것과 주석은 세지 않는다', () => {
  assert.deepEqual(bareVarsIn('a{color:var(--x);b:var(--y, red)} /* var(--z) */'), ['--x'])
})

test('CSS 모듈은 정의된 토큰만 쓴다 (기본값 없는 var)', () => {
  const defined = definedVars()
  const bad: string[] = []
  for (const f of cssFiles.filter((f) => f.endsWith('.module.css'))) {
    const missing = [...new Set(bareVarsIn(read(f)).filter((v) => !defined.has(v)))]
    if (missing.length) bad.push(`${f}: ${missing.join(' ')}`)
  }
  assert.deepEqual(bad, [], `정의 안 된 토큰이 있으면 그 속성이 통째로 빠진다. app/globals.css 의 토큰을 쓴다\n${bad.join('\n')}`)
})
