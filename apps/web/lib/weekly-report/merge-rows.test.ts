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
