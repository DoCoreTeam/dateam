import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeWeeklyRows, mergeCell, extractItems, isEmptyCell, type WeeklyRow } from './merge-rows.ts'

const row = (p: Partial<WeeklyRow>): WeeklyRow => ({ category: '', performance: '', plan: '', issues: '', ...p })

test('isEmptyCell: 빈/플레이스홀더 HTML을 빈 것으로 판정', () => {
  assert.equal(isEmptyCell(''), true)
  assert.equal(isEmptyCell('<p></p>'), true)
  assert.equal(isEmptyCell('<p><br></p>'), true)
  assert.equal(isEmptyCell('-'), true)
  assert.equal(isEmptyCell('<ul><li>내용</li></ul>'), false)
  assert.equal(isEmptyCell('<p>텍스트</p>'), false)
})

test('extractItems: <li> 항목 분해', () => {
  assert.deepEqual(extractItems('<ul><li>A</li><li>B</li></ul>'), ['A', 'B'])
})

test('extractItems: <li> 없는 <p>/<br>는 블록으로 분해', () => {
  assert.deepEqual(extractItems('<p>첫째</p><p>둘째</p>'), ['첫째', '둘째'])
  assert.deepEqual(extractItems('<p>한줄<br>두줄</p>'), ['한줄', '두줄'])
})

test('extractItems: 중첩 <ul>은 최상위 <li>만 항목으로(자식 평탄화 안 함)', () => {
  // 외부 li 2개. 첫 li 안에 중첩 ul/li 포함 — 중첩은 부모 항목 내부에 보존되어야 함
  const html = '<ul><li>상위A<ul><li>하위A1</li><li>하위A2</li></ul></li><li>상위B</li></ul>'
  const items = extractItems(html)
  assert.equal(items.length, 2)
  assert.equal(items[1], '상위B')
  assert.ok(items[0].startsWith('상위A'))
  assert.ok(items[0].includes('하위A1') && items[0].includes('하위A2')) // 중첩 보존
})

test('extractItems: 깨진 HTML(짝 없는 </li>)에서도 이후 항목 유실 없음', () => {
  assert.deepEqual(extractItems('<li>A</li></li><li>B</li>'), ['A', 'B'])
})

test('mergeCell: 중첩 리스트 항목도 평탄화 없이 합쳐짐', () => {
  const existing = '<ul><li>상위A<ul><li>하위A1</li></ul></li></ul>'
  const incoming = '<ul><li>상위B</li></ul>'
  const merged = mergeCell(existing, incoming)
  // 최상위 li는 2개(상위A 묶음, 상위B), 하위A1은 상위A 안에 유지
  assert.equal(merged, '<ul><li>상위A<ul><li>하위A1</li></ul></li><li>상위B</li></ul>')
})

test('mergeCell: 한쪽이 비면 다른쪽 원본 유지', () => {
  assert.equal(mergeCell('<ul><li>A</li></ul>', ''), '<ul><li>A</li></ul>')
  assert.equal(mergeCell('', '<ul><li>B</li></ul>'), '<ul><li>B</li></ul>')
  assert.equal(mergeCell('<p></p>', '<ul><li>B</li></ul>'), '<ul><li>B</li></ul>')
})

test('mergeCell: 항목 합집합 + 중복 제거(기존 우선)', () => {
  const merged = mergeCell('<ul><li>기존</li></ul>', '<ul><li>신규</li></ul>')
  assert.equal(merged, '<ul><li>기존</li><li>신규</li></ul>')
})

test('mergeCell: 동일 텍스트(공백/대소문자 무시)는 중복 제거', () => {
  const merged = mergeCell('<ul><li>제안서 작성</li></ul>', '<ul><li>제안서  작성</li><li>새 항목</li></ul>')
  assert.equal(merged, '<ul><li>제안서 작성</li><li>새 항목</li></ul>')
})

test('mergeWeeklyRows: 신규 카테고리는 새 행으로 추가', () => {
  const existing = [row({ category: '영업', performance: '<ul><li>이월 성과</li></ul>' })]
  const generated = [row({ category: '개발', performance: '<ul><li>개발 성과</li></ul>' })]
  const result = mergeWeeklyRows(existing, generated)
  assert.equal(result.length, 2)
  assert.equal(result[0].category, '영업')
  assert.equal(result[0].performance, '<ul><li>이월 성과</li></ul>') // 기존 보존
  assert.equal(result[1].category, '개발')
})

test('mergeWeeklyRows: 동일 카테고리는 성과 셀 병합(이월 보존 + 생성 추가)', () => {
  const existing = [row({ category: '영업', performance: '<ul><li>이월 성과</li></ul>' })]
  const generated = [row({ category: '영업', performance: '<ul><li>일일업무 성과</li></ul>' })]
  const result = mergeWeeklyRows(existing, generated)
  assert.equal(result.length, 1)
  assert.equal(result[0].performance, '<ul><li>이월 성과</li><li>일일업무 성과</li></ul>')
})

test('mergeWeeklyRows: 카테고리 매칭은 공백/대소문자 무시', () => {
  const existing = [row({ category: '영업 및 사업', performance: '<ul><li>A</li></ul>' })]
  const generated = [row({ category: '영업및사업', performance: '<ul><li>B</li></ul>' })]
  const result = mergeWeeklyRows(existing, generated)
  // '영업 및 사업' vs '영업및사업'은 공백차이로 다른 카테고리(공백 보존) — 합쳐지지 않음
  assert.equal(result.length, 2)

  const existing2 = [row({ category: '영업 및 사업', performance: '<ul><li>A</li></ul>' })]
  const generated2 = [row({ category: '영업 및 사업', performance: '<ul><li>B</li></ul>' })]
  const result2 = mergeWeeklyRows(existing2, generated2)
  assert.equal(result2.length, 1)
  assert.equal(result2[0].performance, '<ul><li>A</li><li>B</li></ul>')
})

test('mergeWeeklyRows: 빈 placeholder 행만 있으면 생성 결과로 교체', () => {
  const existing = [row({})] // EMPTY_ROW
  const generated = [row({ category: '영업', performance: '<ul><li>성과</li></ul>' })]
  const result = mergeWeeklyRows(existing, generated)
  assert.equal(result.length, 1)
  assert.equal(result[0].category, '영업')
})

test('mergeWeeklyRows: 계획/이슈 칸은 건드리지 않고 보존', () => {
  const existing = [row({ category: '영업', performance: '<ul><li>P1</li></ul>', plan: '<ul><li>계획유지</li></ul>' })]
  const generated = [row({ category: '영업', performance: '<ul><li>P2</li></ul>' })] // plan 빈값
  const result = mergeWeeklyRows(existing, generated)
  assert.equal(result[0].plan, '<ul><li>계획유지</li></ul>') // 보존
  assert.equal(result[0].performance, '<ul><li>P1</li><li>P2</li></ul>')
})

test('mergeWeeklyRows: 생성 결과 없으면 기존 보존, 기존도 없으면 빈 행 1개', () => {
  const existing = [row({ category: '영업', performance: '<ul><li>A</li></ul>' })]
  assert.deepEqual(mergeWeeklyRows(existing, []), existing)
  const blank = mergeWeeklyRows([row({})], [])
  assert.equal(blank.length, 1)
  assert.equal(blank[0].category, '')
})

test('mergeWeeklyRows: 수동 <p> 기존 + 생성 <li> 병합', () => {
  const existing = [row({ category: '운영', performance: '<p>직접 작성한 성과</p>' })]
  const generated = [row({ category: '운영', performance: '<ul><li>생성 성과</li></ul>' })]
  const result = mergeWeeklyRows(existing, generated)
  assert.equal(result[0].performance, '<ul><li>직접 작성한 성과</li><li>생성 성과</li></ul>')
})
