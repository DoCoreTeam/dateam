// 그룹 조립 — 트리 + 절단 레벨(또는 명시 노드 ID) → 그룹 배열.
// bodyRaw는 원문 슬라이스 그대로(재작성·요약·정규화 금지). 하위 노드는 부모 그룹의 bodyRaw에 통째로 포함된다.
// 설계: docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/01-architecture.md §3, §6

import type { CutSpec, Group, StructureNode, StructureTree } from './types.ts'
import { lineCharEnd, subtreeLineEnd, walkStructureTree } from './structure-tree.ts'

/** node의 서브트리(자기 자신 + 모든 자손)의 비공백 줄이 전부 metaLineNumbers에 속하면 true. */
function isFullyMeta(node: StructureNode, tree: StructureTree, metaLineNumbers: Set<number> | undefined): boolean {
  if (!metaLineNumbers || metaLineNumbers.size === 0) return false
  const lastLine = subtreeLineEnd(node)
  for (let i = node.lineStart; i <= lastLine; i++) {
    const raw = tree.lines[i]
    if (!raw.trim()) continue
    if (!metaLineNumbers.has(i)) return false
  }
  return true
}

function nodeToGroup(node: StructureNode, tree: StructureTree, span: { start: number; end: number }): Group {
  return {
    id: node.id,
    title: node.title,
    bodyRaw: tree.text.slice(span.start, span.end),
    sourceSpan: { start: span.start, end: span.end },
    treePath: node.id,
    depth: node.level,
    origin: 'structure',
  }
}

/** [fromChar, toChar) 구간에 메타가 아닌 실질 내용(비공백 줄)이 있는가. */
function gapHasContent(
  tree: StructureTree,
  fromChar: number,
  toChar: number,
  metaLineNumbers: Set<number> | undefined,
): boolean {
  if (toChar <= fromChar) return false
  for (let i = 0; i < tree.lines.length; i++) {
    const lineStart = tree.lineOffsets[i]
    if (lineStart >= toChar) break
    if (lineStart < fromChar) continue
    if (!tree.lines[i].trim()) continue
    if (metaLineNumbers?.has(i)) continue
    return true
  }
  return false
}

/**
 * 선택된 노드들의 span을 **문서의 연속 분할**로 확장한다.
 *
 * 왜 필요한가: 최상위보다 깊은 레벨에서 자르면 상위 헤딩 줄(예: "## 2. 기능 요구사항")이
 * 어느 그룹의 span에도 들어가지 않아 미귀속으로 남는다. 그러면 "미귀속 0"이라는 신뢰 장치가
 * 절단 레벨에 따라 깨진다. 갭에 실질 내용이 있으면 **뒤따르는 그룹이 흡수**한다
 * (그 헤딩은 다음 그룹의 맥락이므로 의미상으로도 맞다). 마지막 갭은 마지막 그룹이 흡수한다.
 *
 * bodyRaw는 여전히 원문의 연속 슬라이스다 — 재작성하지 않는다.
 */
function expandToPartition(
  tree: StructureTree,
  nodes: StructureNode[],
  metaLineNumbers: Set<number> | undefined,
): { node: StructureNode; start: number; end: number }[] {
  const spans = nodes.map((node) => ({
    node,
    start: node.charStart,
    end: lineCharEnd(tree, subtreeLineEnd(node)),
  }))
  if (spans.length === 0) return spans

  // 그룹 사이 갭 — 뒤따르는 그룹이 흡수
  for (let i = 1; i < spans.length; i++) {
    const prevEnd = spans[i - 1].end
    if (spans[i].start > prevEnd && gapHasContent(tree, prevEnd, spans[i].start, metaLineNumbers)) {
      spans[i].start = prevEnd
    }
  }

  // 첫 그룹 앞 갭 — 메타가 아닌 내용이 있을 때만 첫 그룹이 흡수(front-matter 메타는 그대로 둔다)
  const first = spans[0]
  if (first.start > 0 && gapHasContent(tree, 0, first.start, metaLineNumbers)) {
    for (let i = 0; i < tree.lines.length; i++) {
      const lineStart = tree.lineOffsets[i]
      if (lineStart >= first.start) break
      if (!tree.lines[i].trim() || metaLineNumbers?.has(i)) continue
      first.start = lineStart
      break
    }
  }

  // 마지막 그룹 뒤 갭 — 마지막 그룹이 흡수
  const last = spans[spans.length - 1]
  if (last.end < tree.text.length && gapHasContent(tree, last.end, tree.text.length, metaLineNumbers)) {
    last.end = tree.text.length
  }

  return spans
}

/**
 * 지정한 노드 ID들을 각각 하나의 그룹으로 만든다(문서 순서대로 정렬).
 */
function selectByNodeIds(tree: StructureTree, nodeIds: string[]): StructureNode[] {
  const idSet = new Set(nodeIds)
  const selected: StructureNode[] = []
  walkStructureTree(tree.root, (node) => {
    if (node.id !== 'root' && idSet.has(node.id)) selected.push(node)
  })
  return selected
}

/**
 * 트리 전체에서 level과 일치하는 노드를 그룹으로 선택한다.
 * 목표 레벨에 도달하는 자손이 없는 가지(문서 구조가 그보다 얕은 경우)는 그 가지의 최심 노드를
 * 폴백으로 선택해 유실 없이 커버한다.
 */
function selectByLevel(tree: StructureTree, level: number): StructureNode[] {
  const selected: StructureNode[] = []

  const visit = (node: StructureNode): boolean => {
    if (node.level === level) {
      selected.push(node)
      return true
    }
    let anySelected = false
    for (const child of node.children) {
      if (visit(child)) anySelected = true
    }
    if (!anySelected) {
      selected.push(node)
      anySelected = true
    }
    return anySelected
  }

  for (const child of tree.root.children) visit(child)
  return selected
}

export function cutGroups(tree: StructureTree, cutSpec: CutSpec, opts?: { metaLineNumbers?: Set<number> }): Group[] {
  let selected: StructureNode[]

  if (cutSpec.nodeIds && cutSpec.nodeIds.length > 0) {
    selected = selectByNodeIds(tree, cutSpec.nodeIds)
  } else if (typeof cutSpec.level === 'number') {
    selected = selectByLevel(tree, cutSpec.level)
  } else {
    throw new Error('cutGroups: cutSpec에 level 또는 nodeIds 중 하나가 필요합니다')
  }

  const metaLineNumbers = opts?.metaLineNumbers
  const filtered = selected.filter((node) => !isFullyMeta(node, tree, metaLineNumbers))
  filtered.sort((a, b) => a.lineStart - b.lineStart)

  return expandToPartition(tree, filtered, metaLineNumbers).map((span) => nodeToGroup(span.node, tree, span))
}
