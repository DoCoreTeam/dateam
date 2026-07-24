import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructureTree, findNodeById, subtreeLineEnd, walkStructureTree } from './structure-tree.ts'

test('heading 계층 — level2가 level1의 자식으로 중첩된다', () => {
  const text = ['# 제목', '## 섹션 A', '## 섹션 B'].join('\n')
  const tree = buildStructureTree(text)
  assert.equal(tree.root.children.length, 1)
  const h1 = tree.root.children[0]
  assert.equal(h1.kind, 'heading')
  assert.equal(h1.level, 1)
  assert.equal(h1.title, '제목')
  assert.equal(h1.children.length, 2)
  assert.equal(h1.children[0].title, '섹션 A')
  assert.equal(h1.children[1].title, '섹션 B')
})

test('번호 체계 — 1. / 1.1 / 1.1.1이 점 깊이만큼 중첩된다', () => {
  const text = ['1. 첫째', '1.1 하위', '1.1.1 세부', '1.2 하위2', '2. 둘째'].join('\n')
  const tree = buildStructureTree(text)
  assert.equal(tree.root.children.length, 2)
  const first = tree.root.children[0]
  assert.equal(first.kind, 'numbered')
  assert.equal(first.children.length, 2) // 1.1, 1.2
  const oneOne = first.children[0]
  assert.equal(oneOne.children.length, 1) // 1.1.1
  assert.equal(oneOne.children[0].title, '1.1.1 세부')
})

test('불릿 들여쓰기 — 2칸 들여쓴 불릿은 상위 불릿의 자식이 된다', () => {
  const text = ['- 상위', '  - 하위1', '  - 하위2', '- 상위2'].join('\n')
  const tree = buildStructureTree(text)
  assert.equal(tree.root.children.length, 2)
  assert.equal(tree.root.children[0].children.length, 2)
  assert.equal(tree.root.children[1].children.length, 0)
})

test('헤딩 아래 불릿은 헤딩의 자식이 된다', () => {
  const text = ['## 목표', '- 항목1', '- 항목2'].join('\n')
  const tree = buildStructureTree(text)
  const heading = tree.root.children[0]
  assert.equal(heading.kind, 'heading')
  assert.equal(heading.children.length, 2)
  assert.equal(heading.children[0].kind, 'bullet')
})

test('연속 표 줄은 하나의 table 노드로 병합된다', () => {
  const text = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n')
  const tree = buildStructureTree(text)
  assert.equal(tree.root.children.length, 1)
  assert.equal(tree.root.children[0].kind, 'table')
  assert.equal(tree.root.children[0].lineStart, 0)
  assert.equal(tree.root.children[0].lineEnd, 2)
})

test('구조 신호가 전혀 없는 줄글 — 문단(빈 줄 구분) 단위 loose 노드로 폴백', () => {
  const text = ['첫 문단 첫 줄', '첫 문단 둘째 줄', '', '둘째 문단'].join('\n')
  const tree = buildStructureTree(text)
  assert.equal(tree.root.children.length, 2)
  assert.equal(tree.root.children[0].kind, 'loose')
  assert.equal(tree.root.children[0].lineStart, 0)
  assert.equal(tree.root.children[0].lineEnd, 1) // 두 줄이 하나의 문단으로 병합
  assert.equal(tree.root.children[1].kind, 'loose')
  assert.equal(tree.root.children[1].lineStart, 3)
})

test('빈 줄로 분리된 두 문단은 서로 다른 노드로 남는다(병합되지 않음)', () => {
  const text = ['문단A', '', '문단B'].join('\n')
  const tree = buildStructureTree(text)
  assert.equal(tree.root.children.length, 2)
})

test('한글 순번(가./나.)과 원문자(①②)를 인식한다', () => {
  const text = ['가. 첫째', '나. 둘째', '① 하나', '② 둘'].join('\n')
  const tree = buildStructureTree(text)
  const kinds = tree.root.children.map((n) => n.kind)
  assert.deepEqual(kinds, ['lettered', 'lettered', 'circled', 'circled'])
})

test('walkStructureTree는 root를 포함해 전위 순회한다', () => {
  const text = ['# 제목', '- 항목'].join('\n')
  const tree = buildStructureTree(text)
  const kinds: string[] = []
  walkStructureTree(tree.root, (n) => kinds.push(n.kind))
  assert.deepEqual(kinds, ['root', 'heading', 'bullet'])
})

test('subtreeLineEnd는 마지막 자손의 lineEnd를 반환한다', () => {
  const text = ['# 제목', '- 항목1', '- 항목2'].join('\n')
  const tree = buildStructureTree(text)
  assert.equal(subtreeLineEnd(tree.root.children[0]), 2)
})

test('findNodeById로 문서 경로(id)를 조회할 수 있다', () => {
  const text = ['# 제목', '## 하위'].join('\n')
  const tree = buildStructureTree(text)
  const found = findNodeById(tree.root, '1.1')
  assert.ok(found)
  assert.equal(found?.title, '하위')
})

test('노드의 charStart/charEnd로 원문을 정확히 슬라이스할 수 있다', () => {
  const text = '## 섹션\n본문 줄1\n본문 줄2\n'
  const tree = buildStructureTree(text)
  const heading = tree.root.children[0]
  const slice = text.slice(heading.charStart, heading.charEnd)
  assert.equal(slice, '## 섹션\n')
})

test('마크다운 파이프표는 하나의 원자 노드로 병합된다(그룹 절단이 표 중간을 못 가름) — R1-4', () => {
  const text = ['## 사양', '| 이름 | 값 |', '| --- | --- |', '| A | 1 |', '| B | 2 |', '', '## 다음'].join('\n')
  const tree = buildStructureTree(text)
  const tableNodes: string[] = []
  walkStructureTree(tree.root, (n) => {
    if (n.kind === 'table') tableNodes.push(n.title)
  })
  // 표 4줄(헤더+구분선+2행)이 단일 table 노드 1개로 병합되어야 한다.
  assert.equal(tableNodes.length, 1, '표는 노드 1개여야 함(줄마다 쪼개지면 안 됨)')
  const section = tree.root.children.find((c) => c.title === '사양')!
  const tableChild = section.children.find((c) => c.kind === 'table')!
  // 표 노드가 4줄을 모두 포괄(중간 절단 불가).
  assert.equal(tableChild.lineEnd - tableChild.lineStart + 1, 4)
})
