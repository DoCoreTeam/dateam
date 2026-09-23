/**
 * 상세 화면의 카드가 제 칸을 넘지 않게 한다
 *
 * **왜**: 2026-09-23 실측 — 미팅 상세의 왼쪽 「이 미팅은」 카드가 300px 칸 안에서
 * 370px 로 자라 가운데 「회의 기록」을 덮었다. 원인은 CSS 한 줄이 없는 것이었다.
 * 열(`.col`·`.colMain`·`.colInfo`·`.colActions`)은 그리드인데 암묵 트랙이 `auto` 라,
 * 트랙의 기준 크기가 **카드의 min-content** 가 된다. 카드 안에 줄지 않는 입력칸이
 * 하나라도 있으면 트랙째로 칸 밖으로 자란다. 화면은 깨지는데 tsc 도 lint 도 조용하다.
 *
 * 그래서 값이 실제로 있는지를 여기서 본다 —
 * 이름만 찾으면 `grid-template-columns` 라는 글자가 주석에 있어도 통과한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 주석을 지운 본문. 주석 안의 글자가 가드를 통과시키면 그건 가드가 아니다 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 셀렉터가 걸린 첫 규칙 블록의 선언부. 없으면 null */
function ruleBody(css: string, selector: string): string | null {
  const body = withoutComments(css)
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2]
  }
  return null
}

function declaration(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`))
  return m ? m[1].trim() : null
}

test('레코드 열은 트랙을 minmax(0, 1fr) 로 박는다 — 카드가 칸 밖으로 자라지 않게', () => {
  const css = readFileSync(join(WEB, 'components/ui/crm/record-layout.module.css'), 'utf8')

  for (const sel of ['.col', '.colMain', '.colInfo', '.colActions']) {
    const body = ruleBody(css, sel)
    assert.ok(body, `${sel} 규칙이 없다`)
    const value = declaration(body, 'grid-template-columns')
    assert.ok(value, `${sel} 에 grid-template-columns 선언이 없다 — 트랙이 auto 라 카드가 칸을 넘는다`)
    assert.match(
      value.replace(/\s+/g, ' '),
      /minmax\(\s*0\s*,\s*1fr\s*\)/,
      `${sel} 의 트랙이 minmax(0, 1fr) 이 아니다 (지금: ${value})`,
    )
  }
})

test('「이 미팅은」의 날짜·시각 두 칸은 제 칸 폭을 보고 접힌다', () => {
  const css = readFileSync(
    join(WEB, 'app/(crm)/crm/meetings/[id]/meeting-facts.module.css'),
    'utf8',
  )
  const body = ruleBody(css, '.pair')
  assert.ok(body, '.pair 규칙이 없다')

  const value = declaration(body, 'grid-template-columns')!.replace(/\s+/g, ' ')
  // 화면 폭 미디어쿼리가 아니라 auto-fit 이어야 한다 — 화면은 넓은데 칸이 좁은 경우가 실제 사고였다
  assert.match(
    value,
    /repeat\(\s*auto-fit\s*,\s*minmax\(/,
    `.pair 가 고정 열이면 좁은 칸에서 넘친다 (지금: ${value})`,
  )

  const child = ruleBody(css, '.pair > *')
  assert.ok(child, '.pair > * 규칙이 없다')
  assert.equal(
    declaration(child, 'min-width'),
    '0',
    '.pair 의 칸에 min-width: 0 이 없으면 입력칸 고유 너비가 바닥이 되어 또 넘친다',
  )
})
