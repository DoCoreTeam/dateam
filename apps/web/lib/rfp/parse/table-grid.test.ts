/**
 * 표 격자 가드 — 표의 모양을 정하는 자리는 하나다
 *
 * **왜 있나**: 표를 만드는 코드가 오피스 파서 안에만 있어서, 글자 파일에 표를 붙이려면
 * 복붙하거나 올려야 했다. 복붙하면 한쪽만 고쳐지는 날 **같은 문서가 형식에 따라 다른 표**가 된다.
 * 이 가드는 그 자리가 다시 둘이 되는 것을 막는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gridCols, gridToCells, gridToText, gridToHtml, escapeHtml } from './table-grid.ts'

const OFFICE = readFileSync(new URL('./office.ts', import.meta.url), 'utf8')
const PLAIN = readFileSync(new URL('./plain.ts', import.meta.url), 'utf8')

const GRID = [
  ['품명', '수량', '단가'],
  ['H100', '2', '100,000,000'],
  ['설치'],            // 짧은 행 — 엑셀은 빈 칸을 아예 안 내보낸다
]

test('열 수는 가장 긴 행을 따른다 — 짧은 행 때문에 열이 줄면 값이 밀린다', () => {
  assert.equal(gridCols(GRID), 3)
  assert.equal(gridCols([]), 0)
})

test('★ 빈 칸도 셀이다 — 없는 셀로 두면 다음 열 값이 그 자리에 있는 것처럼 보인다', () => {
  const cells = gridToCells(GRID)
  assert.equal(cells.length, 9, '3행 × 3열이 아니다')
  const last = cells.filter((c) => c.r === 2)
  assert.deepEqual(last.map((c) => c.text), ['설치', '', ''])
  for (const c of cells) {
    assert.equal(c.rowspan, 1)
    assert.equal(c.colspan, 1)
  }
})

test('표 글자는 열 탭·행 줄바꿈 — 근거로 인용될 때 사람이 읽는 모양이다', () => {
  assert.equal(gridToText([['a', 'b'], ['c', 'd']]), 'a\tb\nc\td')
})

test('표 HTML 은 열 수를 맞춰 빈 칸까지 그린다', () => {
  const html = gridToHtml(GRID)
  assert.equal((html.match(/<tr>/g) ?? []).length, 3)
  assert.equal((html.match(/<td>/g) ?? []).length, 9)
  assert.match(html, /^<table>/)
})

test('HTML 특수문자는 글자로 남는다 — 「<견적>」이 태그가 되면 표가 깨진다', () => {
  assert.equal(escapeHtml('<견적> & "1" > 0'), '&lt;견적&gt; &amp; &quot;1&quot; &gt; 0')
  assert.match(gridToHtml([['<b>']]), /&lt;b&gt;/)
})

/* ── 자리가 둘이 되지 않게 ───────────────────────── */

test('★ 파서들이 자기 안에서 표를 다시 만들지 않는다', () => {
  for (const [name, src] of [['오피스 파서', OFFICE], ['글자 파서', PLAIN]] as const) {
    assert.ok(!/rowspan: 1, colspan: 1/.test(src), `${name} 가 셀 목록을 또 만든다`)
    assert.ok(!/<table>\$\{/.test(src), `${name} 가 표 HTML 을 또 만든다`)
  }
  assert.match(OFFICE, /from '\.\/table-grid\.ts'/, '오피스 파서가 공용 표 모듈을 안 쓴다')
})
