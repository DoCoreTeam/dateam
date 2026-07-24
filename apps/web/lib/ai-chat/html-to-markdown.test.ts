import { test } from 'node:test'
import assert from 'node:assert/strict'
import { htmlToMarkdown } from './html-to-markdown.ts'

test('plain text(태그 없음)는 그대로 통과', () => {
  assert.equal(htmlToMarkdown('그냥 텍스트'), '그냥 텍스트')
  assert.equal(htmlToMarkdown(''), '')
  assert.equal(htmlToMarkdown(null), '')
})

test('표 → 마크다운 파이프표(헤더 구분선 포함)', () => {
  const html = '<table><tr><th>이름</th><th>값</th></tr><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table>'
  const md = htmlToMarkdown(html)
  assert.match(md, /\| 이름 \| 값 \|/)
  assert.match(md, /\| --- \| --- \|/)
  assert.match(md, /\| A \| 1 \|/)
  assert.match(md, /\| B \| 2 \|/)
})

test('셀 경계 보존 — 인접 셀이 붙지 않는다(html-to-plain 사고 방지)', () => {
  const md = htmlToMarkdown('<table><tr><td>A</td><td>B</td></tr></table>')
  assert.ok(!md.includes('AB'), '셀 A와 B가 붙으면 안 됨')
  assert.match(md, /\| A \| B \|/)
})

test('헤딩·리스트 구조 보존', () => {
  const md = htmlToMarkdown('<h1>제목</h1><ul><li>가</li><li>나</li></ul>')
  assert.match(md, /^# 제목/m)
  assert.match(md, /^- 가/m)
  assert.match(md, /^- 나/m)
})

test('강조 인라인 → 마크다운', () => {
  const md = htmlToMarkdown('<p><strong>굵게</strong> 그리고 <em>기울임</em></p>')
  assert.match(md, /\*\*굵게\*\*/)
  assert.match(md, /\*기울임\*/)
})

test('엔티티 디코드 + 셀 내 파이프 이스케이프', () => {
  assert.match(htmlToMarkdown('<p>A &amp; B</p>'), /A & B/)
  const md = htmlToMarkdown('<table><tr><td>a|b</td><td>c</td></tr></table>')
  assert.match(md, /a\\\|b/)
})

test('script/style 블록은 통째 제거(텍스트 누출 방지)', () => {
  const md = htmlToMarkdown('<p>본문</p><script>alert(1)</script>')
  assert.ok(!md.includes('alert'), 'script 내용이 누출되면 안 됨')
  assert.match(md, /본문/)
})

test('열 수 불균형 — 짧은 행은 빈 셀로 패딩', () => {
  const md = htmlToMarkdown('<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td></tr></table>')
  assert.match(md, /\| a \| b \| c \|/)
  assert.match(md, /\| 1 \|  \|  \|/)
})
