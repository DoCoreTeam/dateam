import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionToLines } from './section-lines.ts'

test('AI가 준 <ul><li> HTML을 불릿별 plain 텍스트로 분해', () => {
  const html = '<ul><li>TIER 제거 및 가격표 리스트형 변경</li><li>20 시리즈 제거</li></ul>'
  assert.deepEqual(sectionToLines(html), ['TIER 제거 및 가격표 리스트형 변경', '20 시리즈 제거'])
})

test('결과에 HTML 태그가 절대 남지 않음(장애 재발 방지)', () => {
  const html = '<ul><li>API 개발 및 계약 진행 (컬쳐랜드, 북앤라이프 등)</li></ul>'
  const lines = sectionToLines(html)
  assert.equal(lines.length, 1)
  for (const l of lines) assert.ok(!/[<>]/.test(l), `태그 잔존: ${l}`)
})

test('<li> 내부 <br>은 줄바꿈으로, htmlToPlain 주입 불릿(1개)만 제거', () => {
  assert.deepEqual(sectionToLines('<ul><li>a<br>b</li></ul>'), ['a\nb'])
  // 주입 불릿 1개만 벗기고 본문의 리터럴 대시는 보존
  assert.deepEqual(sectionToLines('<ul><li>- 리터럴 대시</li></ul>'), ['- 리터럴 대시'])
})

test('<li> 없는 plain/개행 입력은 줄 단위로 분리', () => {
  assert.deepEqual(sectionToLines('첫째\n둘째'), ['첫째', '둘째'])
  assert.deepEqual(sectionToLines('단일 라인'), ['단일 라인'])
})

test('빈 문자열/공백은 빈 배열', () => {
  assert.deepEqual(sectionToLines(''), [])
  assert.deepEqual(sectionToLines('<ul></ul>'), [])
  assert.deepEqual(sectionToLines('   '), [])
})
