// 목록 심층분석 재정의 — 구조 트리 복원 결정론 코어 공유 타입 SSOT.
// docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/01-architecture.md §3 참조.

/** 구조 트리 노드 종류. 'loose' = 마커·헤딩에 귀속되지 않는 줄글(문단 폴백). */
export type NodeKind =
  | 'root'
  | 'heading'
  | 'numbered'
  | 'lettered'
  | 'circled'
  | 'bullet'
  | 'table'
  | 'loose'

export interface StructureNode {
  /** 문서 내 경로 (예: "3.2") — root 직속은 "1","2".. 루트 자신은 "root". */
  id: string
  /** 표시용 계층 레벨. heading은 '#' 개수, 그 외는 부모.level+1. */
  level: number
  kind: NodeKind
  /** 사람이 읽는 제목 — heading은 '#' 제거한 텍스트, 그 외는 원문 줄(marker 포함) trim. */
  title: string
  /** 이 노드 자신의 매칭 범위(자식 제외) — 0-based, inclusive. */
  lineStart: number
  lineEnd: number
  /** 이 노드 자신의 매칭 범위(자식 제외) char 오프셋 — end는 exclusive(다음 줄 시작 또는 EOF). */
  charStart: number
  charEnd: number
  children: StructureNode[]
}

export interface StructureTree {
  root: StructureNode
  /** 원문 그대로. */
  text: string
  /** text.split 유사 — 줄 배열('\n' 미포함). */
  lines: string[]
  /** lineOffsets[k] = lines[k]가 시작하는 text 내 char 인덱스. */
  lineOffsets: number[]
  totalLines: number
}

export interface DocMetaEntry {
  key: string
  value: string
  /** 0-based 원문 줄 번호. */
  lineNo: number
}

/** 그룹 절단 지정 — level(표시 레벨 일치) 또는 nodeIds(특정 노드 지정) 중 하나. */
export interface CutSpec {
  level?: number
  nodeIds?: string[]
}

export interface Group {
  id: string
  title: string
  /** 원문 슬라이스 그대로 — 재작성·요약·정규화 금지. */
  bodyRaw: string
  /** 원문 char 오프셋 [start, end). */
  sourceSpan: { start: number; end: number }
  /** 문서 내 위치 — node.id와 동일. */
  treePath: string
  depth: number
  origin: 'structure'
}

export interface UnassignedLine {
  lineNo: number
  text: string
}

export interface CoverageResult {
  ok: boolean
  totalLines: number
  coveredLines: number
  metaLines: number
  unassignedLines: UnassignedLine[]
}
