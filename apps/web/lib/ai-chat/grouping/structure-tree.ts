// 구조 트리 복원 — 원문 텍스트 → 계층 트리. 순수 함수, AI 호출 0.
// 신호: 마크다운 헤딩(#~######) · 번호 체계(1./1.1/가./①) · 불릿(-,*,•) · 들여쓰기 깊이 · 표(|...|) · 빈 줄 구분.
// 설계: docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/01-architecture.md §3, §6

import type { NodeKind, StructureNode, StructureTree } from './types.ts'

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
// 점 표기 확장(1.1, 1.1.1)은 뒤에 붙는 구두점(. 또는 ))이 없어도 인정한다 — "1. 첫째"와
// "1.1 하위"가 공존하는 실제 문서에서 하위 번호가 구두점 없이 쓰이는 경우가 흔하기 때문.
const NUMBERED_RE = /^(\s*)(\d+(?:\.\d+)*)[.)]?\s+(.+)$/
const LETTERED_RE = /^(\s*)([가-힣])[.)]\s+(.+)$/
const CIRCLED_RE = /^(\s*)([①-⑳])\s*(.+)$/
const BULLET_RE = /^(\s*)([-*•])\s+(.+)$/
const TABLE_RE = /^\s*\|.*\|\s*$/
const LEADING_WS_RE = /^(\s*)/

/** 마커·헤딩 계열의 랭크 밴드 — heading(1~6)보다 항상 깊게 취급. */
const LIST_RANK_BASE = 100

interface ClassifiedEntry {
  lineStart: number
  lineEnd: number
  kind: NodeKind
  title: string
  indent: number
  dotDepth: number
  headingLevel: number
}

/** text를 줄 배열 + 각 줄의 시작 char 오프셋으로 분해한다. '\n' 기준, CRLF는 별도 처리하지 않는다. */
function splitLinesWithOffsets(text: string): { lines: string[]; offsets: number[] } {
  const lines: string[] = []
  const offsets: number[] = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      offsets.push(start)
      lines.push(text.slice(start, i))
      start = i + 1
    }
  }
  return { lines, offsets }
}

function classifyLine(raw: string): Omit<ClassifiedEntry, 'lineStart' | 'lineEnd'> | null {
  if (!raw.trim()) return null

  const heading = raw.match(HEADING_RE)
  if (heading) {
    return { kind: 'heading', title: heading[2].trim(), indent: 0, dotDepth: 0, headingLevel: heading[1].length }
  }
  const numbered = raw.match(NUMBERED_RE)
  if (numbered) {
    return {
      kind: 'numbered',
      title: raw.trim(),
      indent: numbered[1].length,
      dotDepth: numbered[2].split('.').length,
      headingLevel: 0,
    }
  }
  const lettered = raw.match(LETTERED_RE)
  if (lettered) {
    return { kind: 'lettered', title: raw.trim(), indent: lettered[1].length, dotDepth: 0, headingLevel: 0 }
  }
  const circled = raw.match(CIRCLED_RE)
  if (circled) {
    return { kind: 'circled', title: raw.trim(), indent: circled[1].length, dotDepth: 0, headingLevel: 0 }
  }
  const bullet = raw.match(BULLET_RE)
  if (bullet) {
    return { kind: 'bullet', title: raw.trim(), indent: bullet[1].length, dotDepth: 0, headingLevel: 0 }
  }
  if (TABLE_RE.test(raw)) {
    return { kind: 'table', title: raw.trim(), indent: 0, dotDepth: 0, headingLevel: 0 }
  }
  const indentMatch = raw.match(LEADING_WS_RE)
  return { kind: 'loose', title: raw.trim(), indent: indentMatch ? indentMatch[1].length : 0, dotDepth: 0, headingLevel: 0 }
}

/** 'table'·'loose'(문단 폴백) 연속 줄을 하나의 노드로 병합한다. 빈 줄로 끊기면 병합하지 않는다(문단=빈 줄 구분). */
function mergeAdjacentRuns(entries: ClassifiedEntry[]): ClassifiedEntry[] {
  const merged: ClassifiedEntry[] = []
  for (const entry of entries) {
    const last = merged[merged.length - 1]
    const mergeable = entry.kind === 'table' || entry.kind === 'loose'
    if (
      last &&
      mergeable &&
      last.kind === entry.kind &&
      last.indent === entry.indent &&
      entry.lineStart === last.lineEnd + 1
    ) {
      last.lineEnd = entry.lineEnd
      continue
    }
    merged.push({ ...entry })
  }
  return merged
}

function computeRank(entry: ClassifiedEntry): number {
  if (entry.kind === 'heading') return entry.headingLevel
  if (entry.kind === 'numbered') return LIST_RANK_BASE + (entry.dotDepth - 1)
  return LIST_RANK_BASE + Math.floor(entry.indent / 2)
}

/**
 * 원문 → 계층 트리. 모든 원문 줄은 어떤 노드엔가 귀속된다(빈 줄 제외):
 * 구조 신호가 있으면 heading/numbered/lettered/circled/bullet/table로, 없으면 'loose'(문단) 폴백으로.
 */
export function buildStructureTree(text: string): StructureTree {
  const { lines, offsets } = splitLinesWithOffsets(text)
  const nodeCharEnd = (lineIdx: number): number => (lineIdx + 1 < offsets.length ? offsets[lineIdx + 1] : text.length)

  const rawEntries: ClassifiedEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const classified = classifyLine(lines[i])
    if (!classified) continue
    rawEntries.push({ ...classified, lineStart: i, lineEnd: i })
  }
  const entries = mergeAdjacentRuns(rawEntries)

  const root: StructureNode = {
    id: 'root',
    level: 0,
    kind: 'root',
    title: '',
    lineStart: -1,
    lineEnd: -1,
    charStart: 0,
    charEnd: text.length,
    children: [],
  }

  interface StackFrame {
    rank: number
    level: number
    node: StructureNode
    childCount: number
  }
  const stack: StackFrame[] = [{ rank: -1, level: 0, node: root, childCount: 0 }]

  for (const entry of entries) {
    const rank = computeRank(entry)
    while (stack.length > 1 && stack[stack.length - 1].rank >= rank) stack.pop()
    const parentFrame = stack[stack.length - 1]
    parentFrame.childCount += 1
    const level = entry.kind === 'heading' ? entry.headingLevel : parentFrame.level + 1
    const id = parentFrame.node.id === 'root' ? String(parentFrame.childCount) : `${parentFrame.node.id}.${parentFrame.childCount}`

    const node: StructureNode = {
      id,
      level,
      kind: entry.kind,
      title: entry.title,
      lineStart: entry.lineStart,
      lineEnd: entry.lineEnd,
      charStart: offsets[entry.lineStart],
      charEnd: nodeCharEnd(entry.lineEnd),
      children: [],
    }
    parentFrame.node.children.push(node)
    stack.push({ rank, level, node, childCount: 0 })
  }

  return { root, text, lines, lineOffsets: offsets, totalLines: lines.length }
}

/** DFS 전위 순회. root 자신도 방문한다(kind==='root'). */
export function walkStructureTree(node: StructureNode, visit: (node: StructureNode) => void): void {
  visit(node)
  for (const child of node.children) walkStructureTree(child, visit)
}

/** node를 루트로 하는 서브트리의 마지막 줄 번호(가장 마지막 자손, 없으면 자기 자신의 lineEnd). */
export function subtreeLineEnd(node: StructureNode): number {
  if (node.children.length === 0) return node.lineEnd
  return subtreeLineEnd(node.children[node.children.length - 1])
}

/** lineIdx가 끝나는 char 오프셋(exclusive) — 다음 줄 시작 또는 문서 끝. */
export function lineCharEnd(tree: StructureTree, lineIdx: number): number {
  return lineIdx + 1 < tree.lineOffsets.length ? tree.lineOffsets[lineIdx + 1] : tree.text.length
}

export function findNodeById(root: StructureNode, id: string): StructureNode | null {
  let found: StructureNode | null = null
  walkStructureTree(root, (node) => {
    if (!found && node.id === id) found = node
  })
  return found
}
