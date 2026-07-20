import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructureTree } from './structure-tree.ts'
import { extractDocMeta } from './doc-meta.ts'

test('front-matter 영역의 버전/작성일/상태/작성자 줄을 메타로 추출한다', () => {
  const text = [
    '- 문서 버전: v0.1.0',
    '- 작성일: 2026-07-20',
    '- 상태: 초안 (Draft)',
    '',
    '## 1. 개요',
    '본문 내용',
  ].join('\n')
  const tree = buildStructureTree(text)
  const { meta, metaLineNumbers } = extractDocMeta(text, tree)

  const keys = meta.map((m) => m.key)
  assert.ok(keys.includes('문서 버전'))
  assert.ok(keys.includes('작성일'))
  assert.ok(keys.includes('상태'))
  assert.equal(metaLineNumbers.has(0), true)
  assert.equal(metaLineNumbers.has(1), true)
  assert.equal(metaLineNumbers.has(2), true)
  // heading·본문 줄은 메타가 아니다
  assert.equal(metaLineNumbers.has(4), false)
  assert.equal(metaLineNumbers.has(5), false)
})

test('"변경 이력" 섹션 전체(제목+하위 줄)를 메타로 취급한다', () => {
  const text = ['## 1. 개요', '본문', '', '## 변경 이력', '- v0.1.0 (2026-07-20): 초안 작성'].join('\n')
  const tree = buildStructureTree(text)
  const { meta, metaLineNumbers } = extractDocMeta(text, tree)

  const changelogHeadingLine = 3
  const changelogBulletLine = 4
  assert.equal(metaLineNumbers.has(changelogHeadingLine), true)
  assert.equal(metaLineNumbers.has(changelogBulletLine), true)
  assert.ok(meta.some((m) => m.value.includes('초안 작성')))
  // 본문 섹션 줄은 메타가 아니다
  assert.equal(metaLineNumbers.has(0), false)
  assert.equal(metaLineNumbers.has(1), false)
})

test('본문 중간의 유사 문자열("- 상태: 진행 중")은 메타로 오분류되지 않는다', () => {
  const text = [
    '- 문서 버전: v0.1.0',
    '',
    '## 1. 로드맵',
    '### P1',
    '- 상태: 진행 중',
    '- 알림 시스템',
  ].join('\n')
  const tree = buildStructureTree(text)
  const { metaLineNumbers } = extractDocMeta(text, tree)

  const statusLineNo = text.split('\n').findIndex((l) => l.includes('상태: 진행 중'))
  assert.ok(statusLineNo > 0)
  assert.equal(metaLineNumbers.has(statusLineNo), false)
  // front-matter의 문서 버전은 여전히 메타
  assert.equal(metaLineNumbers.has(0), true)
})

test('메타 섹션·front-matter가 없는 문서는 metaLineNumbers가 비어있다', () => {
  const text = ['## 1. 개요', '본문'].join('\n')
  const tree = buildStructureTree(text)
  const { meta, metaLineNumbers } = extractDocMeta(text, tree)
  assert.equal(meta.length, 0)
  assert.equal(metaLineNumbers.size, 0)
})
