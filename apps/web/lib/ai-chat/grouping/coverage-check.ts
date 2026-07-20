// 유실 0 결정론 검증 — L \ (G ∪ M) == ∅.
// AI 자기보고에 의존하지 않는다: 원문을 독립적으로 재분해해 그룹·메타가 실제로 모든 줄을 덮는지 계산한다.
// 설계: docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/01-architecture.md §6

import type { CoverageResult, Group, UnassignedLine } from './types.ts'

function splitLinesForCoverage(text: string): { lines: string[]; offsets: number[] } {
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

/** offsets에서 charOffset을 포함하는 줄 인덱스를 이진 탐색으로 찾는다(offsets는 오름차순). */
function charOffsetToLine(offsets: number[], charOffset: number): number {
  let lo = 0
  let hi = offsets.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid] <= charOffset) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/**
 * 원문 전체 줄 집합 L, 그룹 귀속 줄 집합 G, 메타 줄 집합 M에 대해 L \ (G ∪ M) == ∅ 를 검증한다.
 * 공백 줄은 애초에 L 검증 대상에서 제외한다.
 */
export function checkCoverage(
  text: string,
  groups: Group[],
  metaLineNumbers: Set<number> | Iterable<number> = new Set<number>(),
): CoverageResult {
  const { lines, offsets } = splitLinesForCoverage(text)
  const metaSet = metaLineNumbers instanceof Set ? metaLineNumbers : new Set(metaLineNumbers)

  const coveredLines = new Set<number>()
  for (const group of groups) {
    if (group.sourceSpan.end <= group.sourceSpan.start) continue
    const startLine = charOffsetToLine(offsets, group.sourceSpan.start)
    const endLine = charOffsetToLine(offsets, group.sourceSpan.end - 1)
    for (let i = startLine; i <= endLine; i++) coveredLines.add(i)
  }

  const unassignedLines: UnassignedLine[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    if (coveredLines.has(i)) continue
    if (metaSet.has(i)) continue
    unassignedLines.push({ lineNo: i, text: lines[i] })
  }

  return {
    ok: unassignedLines.length === 0,
    totalLines: lines.length,
    coveredLines: coveredLines.size,
    metaLines: metaSet.size,
    unassignedLines,
  }
}
