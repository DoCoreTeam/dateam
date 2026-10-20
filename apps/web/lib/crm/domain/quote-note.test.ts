import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isNoteHtml, noteToHtml, noteToPlain } from './quote-note.ts'
import { sanitizeNoteHtml, normalizeNoteInput, MAX_NOTE_HTML } from './quote-note-sanitize.ts'

const LEGACY = '[서버 구성 사양]\n■ 최소 구성 (7대)\n- 각 8 vCPU, 메모리 32GB'

test('옛 글자 특기사항은 줄마다 문단 하나가 된다 — 나눠 적은 줄이 종이에서도 선다', () => {
  assert.equal(isNoteHtml(LEGACY), false)
  const html = noteToHtml(LEGACY)
  assert.equal(html.match(/<p>/g)?.length, 3)
  assert.equal(noteToPlain(LEGACY), LEGACY)
})

test('옛 글자에 든 꺾쇠는 태그가 아니라 글자로 남는다', () => {
  assert.equal(noteToHtml('a < b <script>x</script>'), '<p>a &lt; b &lt;script&gt;x&lt;/script&gt;</p>')
})

test('HTML 특기사항은 글자로 바꿀 때 태그 없이 줄이 남는다 — 엑셀이 이 값을 싣는다', () => {
  const html = '<p><strong>서버 구성</strong></p><ul><li><p>최소 7대</p></li><li><p>권장 13대</p></li></ul>'
  assert.equal(isNoteHtml(html), true)
  assert.equal(noteToHtml(html), html)
  assert.equal(noteToPlain(html), '서버 구성\n- 최소 7대\n- 권장 13대')
})

test('보안: 정리기가 script 와 이벤트 속성과 javascript 링크를 지운다', () => {
  const dirty = '<p onclick="x()">가<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">링크</a></p>'
  const clean = sanitizeNoteHtml(dirty)
  assert.ok(!/script|onerror|onclick|javascript|<img|<a /i.test(clean), clean)
  assert.equal(clean, '<p>가링크</p>')
})

test('보안: 서식은 남기고 style 과 class 는 지운다', () => {
  assert.equal(
    sanitizeNoteHtml('<p style="color:red" class="x"><strong>굵게</strong> <em>기울임</em></p>'),
    '<p><strong>굵게</strong> <em>기울임</em></p>',
  )
})

test('저장값: 빈 편집기는 비운 것이다, 옛 글자는 지금처럼 다듬는다', () => {
  assert.equal(normalizeNoteInput('<p></p>'), null)
  assert.equal(normalizeNoteInput('<p>  </p><p><br></p>'), null)
  assert.equal(normalizeNoteInput('  가  \n\n 나 '), '가\n나')
  assert.equal(normalizeNoteInput('<p>가</p><script>x</script>'), '<p>가</p>')
})

test('저장값: 너무 긴 HTML 은 거절한다', () => {
  assert.throws(() => normalizeNoteInput(`<p>${'가'.repeat(MAX_NOTE_HTML)}</p>`), /너무 깁니다/)
})

test('저장 세 자리와 문서 응답이 정리기를 지난다 — 하나라도 빠지면 그 길로 거르지 않은 HTML 이 들어온다', () => {
  const svc = readFileSync(new URL('../services/quote.ts', import.meta.url), 'utf8')
  assert.equal(svc.match(/notesMd: normalizeNoteInput\(input\.notesMd\)/g)?.length, 2, '만들기 두 자리')
  assert.match(svc, /data\.notesMd = normalizeNoteInput\(input\.notesMd\)/, '고치기 자리')
  assert.ok(!/notesMd: normalizeMultiline|data\.notesMd = normalizeMultiline/.test(svc), '옛 다듬기가 남은 자리가 있다')
  const docSvc = readFileSync(new URL('../services/quote-document.ts', import.meta.url), 'utf8')
  assert.match(docSvc, /customerNoteHtml: built\.customerNoteHtml \? sanitizeNoteHtml\(built\.customerNoteHtml\)/)
})
