import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupBySection, MAX_HEADING_LEVEL } from './source-group.ts'

function block(over: Record<string, unknown> = {}) {
  return {
    blockId: String(over.blockId ?? 'b'), text: '글', html: null,
    pageNo: null, type: 'paragraph', sectionId: null,
    sectionNumber: null, sectionTitle: null, sectionLevel: null, ...over,
  } as never
}

test('절 제목이 바뀌는 자리에서 끊는다', () => {
  const groups = groupBySection([
    block({ blockId: '1', sectionId: 's1', sectionNumber: '1.', sectionTitle: '주요 현황', sectionLevel: 2 }),
    block({ blockId: '2', sectionId: 's1', sectionNumber: '1.', sectionTitle: '주요 현황', sectionLevel: 2 }),
    block({ blockId: '3', sectionId: 's2', sectionNumber: '2.', sectionTitle: '추진 배경', sectionLevel: 2 }),
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].title, '주요 현황')
  assert.equal(groups[0].blocks.length, 2)
})

test('★ 깊은 절은 제목으로 안 그린다 — 실측: 본문 한 줄이 5단계 절이 됐다', () => {
  // 「(기간/예산) 24~30년 / 총 4,793억 페소…」가 섹션으로 잡혔다.
  // 전부 제목으로 그리면 본문이 제목으로 뒤덮인다
  const groups = groupBySection([
    block({ blockId: '1', sectionId: 's9', sectionTitle: '(기간/예산) 24~30년', sectionLevel: 5 }),
  ])
  assert.equal(groups[0].title, null)
  assert.ok(MAX_HEADING_LEVEL < 5)
})

test('절이 없는 블록도 버리지 않는다', () => {
  const groups = groupBySection([block({ blockId: '1' }), block({ blockId: '2' })])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].blocks.length, 2)
})

test('빈 목록은 빈 무리', () => {
  assert.deepEqual(groupBySection([]), [])
})

test('번호만 있고 제목이 없어도 제목 줄을 만든다', () => {
  const groups = groupBySection([
    block({ blockId: '1', sectionId: 's1', sectionNumber: '제1장', sectionLevel: 1 }),
  ])
  assert.equal(groups[0].number, '제1장')
})
