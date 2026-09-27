// lib/ui/component-scan.test.ts — 주석 지우개는 한 벌이어야 한다
//
// **왜 생겼나** (실측 2026-09-28): `stripComments` 가 이 저장소에 **열세 벌** 있었다.
// 규칙도 셋으로 갈려 있었다 —
//   ① `^\s*//.*$` 줄 전체가 주석일 때만 (2곳)
//   ② `(^|[^:])//.*$` 앞 글자가 `:` 가 아니면 (1곳)
//   ③ `(^|[^:'"`])//[^\n]*` (6곳 + 공용)
// 같은 이름이 다른 일을 하니 어느 가드가 무엇을 보고 있는지 알 수 없었다.
// 게다가 셋 다 **문자열 안의 `//` 를 주석으로 읽어** `href="https://x"` 뒤를 통째로 지웠다 —
// 그 줄에 있던 진짜 코드가 가드 눈에서 사라지는데, 이쪽 고장은 조용해서 더 나쁘다.
//
// 지금은 상태를 좇는 스캐너 한 벌이다. 문자열 안에서는 안 세고, 자리를 공백으로만 바꿔
// **줄 수와 위치를 보존**한다(줄 번호로 보고하는 가드가 있다).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './component-scan.ts'

/**
 * 따로 둘 이유가 있는 둘만 적는다. **「나중에 합치자」는 여기 안 들어온다** —
 * 넣는 순간 이 목록이 미뤄 둔 사본의 보관함이 된다.
 */
const KEPT: readonly { file: string; why: string }[] = [
  { file: 'lib/ui/component-scan.ts', why: '여기가 그 한 벌이다' },
  { file: 'lib/policy/rls-baseline.test.ts', why: 'SQL 주석(--)은 언어가 다르다' },
  { file: '../../scripts/ui-phrases.mjs', why: '저장소 루트의 독립 스크립트라 이 패키지를 안 들여온다' },
]

const ROOTS = ['lib', 'app', 'components', '../../scripts']

function allSources(): string[] {
  const out: string[] = []
  const visit = (d: string) => {
    let entries: string[]
    try { entries = readdirSync(d) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.next')) continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) visit(p)
      else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p)
    }
  }
  for (const r of ROOTS) visit(r)
  return out
}

test('★ 주석 지우개는 한 벌이다 — 같은 이름이 다른 일을 하면 어느 가드가 무엇을 보는지 알 수 없다', () => {
  const kept = new Set(KEPT.map((k) => k.file))
  const extra = allSources()
    .filter((f) => /function stripComments\s*\(/.test(readFileSync(f, 'utf-8')))
    .filter((f) => !kept.has(f))
  assert.deepEqual(extra, [],
    `stripComments 를 다시 적은 자리가 있습니다 — lib/ui/component-scan.ts 를 들여오세요:\n  ${extra.join('\n  ')}`)
})

test('★ 문자열 안의 // 는 주석이 아니다 — 지우면 그 줄의 진짜 코드가 가드 눈에서 사라진다', () => {
  const src = 'const a = <a href="https://example.com" className="keep-me" /> // 여기는 주석'
  const clean = stripComments(src)
  assert.ok(clean.includes('keep-me'), '주소의 // 뒤가 통째로 지워졌다')
  assert.ok(!clean.includes('여기는 주석'), '줄 주석이 코드로 남았다')
})

test('★ 자리를 공백으로만 바꾼다 — 줄 번호로 보고하는 가드가 있다', () => {
  const src = ['한 줄', '/* 여러', '   줄 주석 */', '마지막'].join('\n')
  const clean = stripComments(src)
  assert.equal(clean.split('\n').length, 4, '줄 수가 바뀌었다')
  assert.equal(clean.length, src.length, '길이가 바뀌어 위치가 밀렸다')
  assert.ok(!clean.includes('줄 주석'), '블록 주석이 남았다')
})

test('★ 역따옴표 안은 줄이 바뀌어도 문자열이다', () => {
  const src = 'const t = `여러\n줄 // 아님`\n// 이건 주석'
  const clean = stripComments(src)
  assert.ok(clean.includes('// 아님'), '템플릿 안을 주석으로 읽었다')
  assert.ok(!clean.includes('이건 주석'), '진짜 주석이 남았다')
})

test('★ 정규식 안의 역따옴표에 안 속는다 — 속으면 그 뒤 몇 줄이 통째로 사라진다', () => {
  const src = [
    'const m = s.match(/`+/g)',
    '/** 이 블록 주석이 보여야 한다 */',
    'const keep = 1',
  ].join('\n')
  const clean = stripComments(src)
  assert.ok(!clean.includes('블록 주석이 보여야 한다'), '정규식을 문자열로 읽어 뒤 주석을 못 봤다')
  assert.ok(clean.includes('const keep = 1'), '코드가 사라졌다')
  assert.equal(clean.split('\n').length, 3, '줄 수가 바뀌었다')
})

test('★ 나눗셈을 정규식으로 읽지 않는다', () => {
  const src = 'const half = total / 2 // 주석\nconst keep = 1'
  const clean = stripComments(src)
  assert.ok(clean.includes('total / 2'), '나눗셈이 지워졌다')
  assert.ok(!clean.includes('주석'), '줄 주석이 남았다')
  assert.ok(clean.includes('const keep = 1'), '다음 줄이 사라졌다')
})
