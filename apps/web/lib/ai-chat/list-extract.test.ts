import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseListItems, mergeExtractedItems, classifySourceMime } from './list-extract.ts'

test('parseListItems: 숫자 마침표 목록', () => {
  const items = parseListItems('1. 첫번째\n2. 두번째\n3. 세번째')
  assert.equal(items.length, 3)
  assert.deepEqual(items.map((i) => i.text), ['첫번째', '두번째', '세번째'])
})

test('parseListItems: 숫자 괄호 목록', () => {
  const items = parseListItems('1) 사과\n2) 바나나')
  assert.deepEqual(items.map((i) => i.text), ['사과', '바나나'])
})

test('parseListItems: 기호 목록(- * •) 전부 인식', () => {
  const items = parseListItems('- 항목A\n* 항목B\n• 항목C')
  assert.deepEqual(items.map((i) => i.text), ['항목A', '항목B', '항목C'])
})

test('parseListItems: 원문자(①~⑳) 목록', () => {
  const items = parseListItems('① 하나\n② 둘')
  assert.deepEqual(items.map((i) => i.text), ['하나', '둘'])
})

test('parseListItems: 한글 순번(가./나)) 목록', () => {
  const items = parseListItems('가. 첫줄\n나) 둘째줄')
  assert.deepEqual(items.map((i) => i.text), ['첫줄', '둘째줄'])
})

test('parseListItems: 들여쓰기된 중첩 목록도 인식', () => {
  const items = parseListItems('1. 상위\n  - 하위A\n  - 하위B')
  assert.deepEqual(items.map((i) => i.text), ['상위', '하위A', '하위B'])
})

test('parseListItems: 코드블록 내부는 제외', () => {
  const text = '1. 실제 항목\n```\n- 코드주석아님\n1. 코드안의목록\n```\n2. 다음 항목'
  const items = parseListItems(text)
  assert.deepEqual(items.map((i) => i.text), ['실제 항목', '다음 항목'])
})

test('parseListItems: 빈 텍스트/목록 없음은 빈 배열', () => {
  assert.deepEqual(parseListItems(''), [])
  assert.deepEqual(parseListItems('그냥 평문입니다.'), [])
})

test('parseListItems: 항목 텍스트를 절대 자르지 않는다(원문 보존)', () => {
  const longText = '가'.repeat(500)
  const items = parseListItems(`1. ${longText}`)
  assert.equal(items[0].text.length, 500)
  assert.equal(items[0].text, longText)
})

test('mergeExtractedItems: AI가 놓친 항목을 원문 그대로 복구(유실0)', () => {
  const parsed = [
    { text: '항목1', marker: '1' },
    { text: '항목2', marker: '2' },
    { text: '항목3', marker: '3' },
  ]
  const aiTexts = ['항목1', '항목3'] // AI가 항목2를 누락
  const result = mergeExtractedItems(parsed, aiTexts)
  const texts = result.items.map((i) => i.text)
  assert.ok(texts.includes('항목1'))
  assert.ok(texts.includes('항목2'))
  assert.ok(texts.includes('항목3'))
  assert.equal(result.restoredCount, 1)
  const recovered = result.items.find((i) => i.text === '항목2')
  assert.equal(recovered?.recovered, true)
})

test('mergeExtractedItems: AI가 찾은 문장형 신규 항목도 포함', () => {
  const parsed = [{ text: '항목1', marker: '1' }]
  const aiTexts = ['항목1', '문장형으로 나열된 새 항목']
  const result = mergeExtractedItems(parsed, aiTexts)
  assert.equal(result.items.length, 2)
  assert.equal(result.restoredCount, 0)
})

test('mergeExtractedItems: 완전 동일 항목만 중복 제거(공백/대소문자 정규화)', () => {
  const parsed = [{ text: 'Item One', marker: '1' }]
  const aiTexts = ['item   one'] // 공백/대소문자만 다름 → 동일 취급
  const result = mergeExtractedItems(parsed, aiTexts)
  assert.equal(result.items.length, 1)
})

test('mergeExtractedItems: 애매하게 다른 표현은 병합하지 않고 둘 다 남긴다', () => {
  const parsed = [{ text: '서버 성능을 개선한다', marker: '1' }]
  const aiTexts = ['서버 성능 개선'] // 비슷하지만 다른 문자열
  const result = mergeExtractedItems(parsed, aiTexts)
  assert.equal(result.items.length, 2)
})

test('mergeExtractedItems: 항목 텍스트를 절대 자르지 않는다', () => {
  const longText = '나'.repeat(1000)
  const result = mergeExtractedItems([], [longText])
  assert.equal(result.items[0].text.length, 1000)
})

test('classifySourceMime: mime 우선 판정', () => {
  assert.equal(classifySourceMime('image/png', 'a.bin'), 'image')
  assert.equal(classifySourceMime('application/pdf', 'a.bin'), 'pdf')
  assert.equal(
    classifySourceMime(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'a.bin',
    ),
    'office',
  )
  assert.equal(classifySourceMime('text/html', 'a.bin'), 'html')
  assert.equal(classifySourceMime('text/markdown', 'a.bin'), 'text')
})

test('classifySourceMime: mime이 비거나 알 수 없으면 확장자로 폴백', () => {
  assert.equal(classifySourceMime('', 'photo.jpg'), 'image')
  assert.equal(classifySourceMime('application/octet-stream', 'report.xlsx'), 'office')
  assert.equal(classifySourceMime('application/octet-stream', 'slide.pptx'), 'office')
  assert.equal(classifySourceMime('application/octet-stream', 'doc.docx'), 'office')
  assert.equal(classifySourceMime('application/octet-stream', 'page.htm'), 'html')
  assert.equal(classifySourceMime('application/octet-stream', 'notes.md'), 'text')
})

test('classifySourceMime: 지원하지 않는 형식은 null', () => {
  assert.equal(classifySourceMime('application/zip', 'archive.zip'), null)
})
