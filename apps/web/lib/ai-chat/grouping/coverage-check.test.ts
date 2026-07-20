import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructureTree } from './structure-tree.ts'
import { cutGroups } from './assemble-groups.ts'
import { extractDocMeta } from './doc-meta.ts'
import { checkCoverage } from './coverage-check.ts'
import type { Group } from './types.ts'

test('전체 문서가 그룹으로 덮이면 미귀속 줄 0, ok:true', () => {
  const text = ['## 섹션 A', '- 항목1', '', '## 섹션 B', '- 항목2'].join('\n')
  const tree = buildStructureTree(text)
  const groups = cutGroups(tree, { level: 2 })
  const result = checkCoverage(text, groups)
  assert.equal(result.ok, true)
  assert.deepEqual(result.unassignedLines, [])
})

test('그룹이 일부 섹션을 누락하면 미귀속 줄로 잡힌다', () => {
  const text = ['## 섹션 A', '- 항목1', '', '## 섹션 B', '- 항목2'].join('\n')
  const tree = buildStructureTree(text)
  const groups = cutGroups(tree, { level: 2 })
  const onlyFirst = groups.slice(0, 1) // 섹션 B를 고의로 누락
  const result = checkCoverage(text, onlyFirst)
  assert.equal(result.ok, false)
  assert.ok(result.unassignedLines.some((u) => u.text.includes('섹션 B')))
  assert.ok(result.unassignedLines.some((u) => u.text.includes('항목2')))
})

test('빈 줄은 미귀속으로 잡히지 않는다', () => {
  const text = ['## 섹션', '- 항목', '', '', '']
    .join('\n')
  const tree = buildStructureTree(text)
  const groups = cutGroups(tree, { level: 2 })
  const result = checkCoverage(text, groups)
  assert.equal(result.ok, true)
})

test('메타 줄은 그룹 없이도 커버리지를 만족시킨다', () => {
  const text = ['- 문서 버전: v0.1.0', '', '## 1. 개요', '본문'].join('\n')
  const tree = buildStructureTree(text)
  const { metaLineNumbers } = extractDocMeta(text, tree)
  const groups = cutGroups(tree, { level: 2 }, { metaLineNumbers })
  const result = checkCoverage(text, groups, metaLineNumbers)
  assert.equal(result.ok, true)
  assert.equal(result.metaLines, 1)
})

test('groups가 빈 배열이고 메타도 없으면 모든 비공백 줄이 미귀속', () => {
  const text = ['첫 줄', '둘째 줄'].join('\n')
  const groups: Group[] = []
  const result = checkCoverage(text, groups)
  assert.equal(result.ok, false)
  assert.equal(result.unassignedLines.length, 2)
})
