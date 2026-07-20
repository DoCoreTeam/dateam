import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructureTree } from './structure-tree.ts'
import { cutGroups } from './assemble-groups.ts'

test('level 절단 — heading level2에서 자르면 각 섹션이 하나의 그룹이 된다', () => {
  const text = ['## 섹션 A', '본문A', '', '## 섹션 B', '- 항목1', '- 항목2'].join('\n')
  const tree = buildStructureTree(text)
  const groups = cutGroups(tree, { level: 2 })

  assert.equal(groups.length, 2)
  assert.equal(groups[0].title, '섹션 A')
  assert.equal(groups[1].title, '섹션 B')
  // bodyRaw는 원문 슬라이스 그대로 — 재작성 없음
  assert.equal(groups[0].bodyRaw, '## 섹션 A\n본문A\n')
  assert.ok(groups[1].bodyRaw.includes('- 항목1'))
  assert.ok(groups[1].bodyRaw.includes('- 항목2'))
})

test('하위 노드는 부모 그룹의 bodyRaw에 통째로 포함된다(중첩 섹션)', () => {
  const text = ['## 로드맵', '### P0', '- MVP', '### P1', '- 결제'].join('\n')
  const tree = buildStructureTree(text)
  const groups = cutGroups(tree, { level: 2 })

  assert.equal(groups.length, 1)
  assert.ok(groups[0].bodyRaw.includes('### P0'))
  assert.ok(groups[0].bodyRaw.includes('- MVP'))
  assert.ok(groups[0].bodyRaw.includes('### P1'))
  assert.ok(groups[0].bodyRaw.includes('- 결제'))
})

test('nodeIds 절단 — 지정한 노드만 그룹이 된다(문서 순서대로 정렬)', () => {
  const text = ['## A', '## B', '## C'].join('\n')
  const tree = buildStructureTree(text)
  const groups = cutGroups(tree, { nodeIds: ['3', '1'] })

  assert.equal(groups.length, 2)
  assert.deepEqual(
    groups.map((g) => g.title),
    ['A', 'C'],
  )
})

test('목표 레벨에 도달하지 못하는 가지는 가장 깊은 가용 노드로 폴백된다', () => {
  // A: heading(level2) -> loose paragraph(level3) — level4까지 못 감
  // B: heading(level2) -> heading(level3) — 역시 level4까지 못 감
  const text = ['## A', '짧은 설명', '', '## B', '### B의 하위'].join('\n')
  const tree = buildStructureTree(text)
  const groups = cutGroups(tree, { level: 4 })

  assert.equal(groups.length, 2)
  // A는 자기 자신(heading)이 아니라 그 자식(문단)이 폴백 그룹이 되어야 한다
  assert.equal(groups[0].title, '짧은 설명')
  assert.equal(groups[1].title, 'B의 하위')
})

test('metaLineNumbers로 지정된 노드는 그룹에서 제외된다', () => {
  const text = ['## 변경 이력', '- v0.1.0: 초안'].join('\n')
  const tree = buildStructureTree(text)
  const metaLineNumbers = new Set([0, 1])
  const groups = cutGroups(tree, { level: 2 }, { metaLineNumbers })
  assert.equal(groups.length, 0)
})

test('부분적으로만 메타인 노드는 제외되지 않는다(전체가 메타여야 제외)', () => {
  const text = ['## 섹션', '- 메타아님', '- 메타아님2'].join('\n')
  const tree = buildStructureTree(text)
  const metaLineNumbers = new Set([0]) // heading 줄만 메타로 잘못 표시된 경우
  const groups = cutGroups(tree, { level: 2 }, { metaLineNumbers })
  assert.equal(groups.length, 1)
})

test('cutSpec에 level·nodeIds가 모두 없으면 에러', () => {
  const tree = buildStructureTree('## A')
  assert.throws(() => cutGroups(tree, {}))
})
