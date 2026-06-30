// itemsToWeeklyRows 직렬화 단위테스트 — is_included 제외·escapeHtml·빈섹션·그룹핑 계약 고정.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsToWeeklyRows } from './serialize.ts'
import type { DraftItem } from './draft-types.ts'

function item(partial: Partial<DraftItem>): DraftItem {
  return {
    category: '업무',
    section: 'performance',
    content: '내용',
    origin: 'auto',
    confidence: null,
    isIncluded: true,
    sourceRef: null,
    sortOrder: 0,
    ...partial,
  }
}

test('is_included=false 항목은 확정본에서 제외된다', () => {
  // Arrange
  const items = [item({ content: '제외될 항목', isIncluded: false })]
  // Act
  const rows = itemsToWeeklyRows(items)
  // Assert
  assert.equal(rows.length, 0)
})

test('빈 content 항목은 제외된다', () => {
  const rows = itemsToWeeklyRows([item({ content: '   ' })])
  assert.equal(rows.length, 0)
})

test('category가 비면 "기타"로 폴백한다', () => {
  const rows = itemsToWeeklyRows([item({ category: '' })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].category, '기타')
})

test('escapeHtml — HTML 특수문자를 이스케이프한다(XSS 방어)', () => {
  const rows = itemsToWeeklyRows([item({ content: '<script>&"\'' })])
  assert.match(rows[0].performance, /&lt;script&gt;&amp;&quot;&#39;/)
  assert.doesNotMatch(rows[0].performance, /<script>/)
})

test('항목 없는 섹션은 빈 문자열(공 ul 아님)', () => {
  const rows = itemsToWeeklyRows([item({ section: 'performance', content: 'A' })])
  assert.equal(rows[0].plan, '')
  assert.equal(rows[0].issues, '')
  assert.equal(rows[0].performance, '<ul><li>A</li></ul>')
})

test('같은 카테고리·섹션 복수 항목은 하나의 ul로 묶인다', () => {
  const rows = itemsToWeeklyRows([
    item({ content: 'A', sortOrder: 0 }),
    item({ content: 'B', sortOrder: 1 }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].performance, '<ul><li>A</li><li>B</li></ul>')
})

test('content 줄바꿈은 <br>로 변환된다', () => {
  const rows = itemsToWeeklyRows([item({ content: 'A\nB' })])
  assert.equal(rows[0].performance, '<ul><li>A<br>B</li></ul>')
})

test('auto와 manual 항목이 동등하게 포함된다(동등취합)', () => {
  const rows = itemsToWeeklyRows([
    item({ content: '자동', origin: 'auto' }),
    item({ content: '수동', origin: 'manual' }),
  ])
  assert.equal(rows[0].performance, '<ul><li>자동</li><li>수동</li></ul>')
})
