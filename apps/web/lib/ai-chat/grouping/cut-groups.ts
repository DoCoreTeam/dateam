// ③ 그룹 절단 — 프롬프트 빌더 + 응답 파서 (순수 함수. AI 호출은 서버액션이 수행).
//
// 핵심 계약 B: 그룹 수는 파라미터가 아니라 결과값이다. 상한을 두지 않는다.
// 핵심 계약 D: 사용자 지시가 절단 레벨을 지배한다("크게 묶어" / "쪼개" / "이 부분만").
//
// AI에는 원문 전체가 아니라 **아웃라인(구조 요약)**만 준다 — 절단은 구조 판단이지 내용 판단이 아니고,
// 원문 전체를 넣으면 토큰만 태우고 판단 품질은 오르지 않는다.

import type { StructureTree, StructureNode, CutSpec } from './types.ts'
import { DOC_TYPE_LABEL, DEFAULT_CUT_HINT, type DocType } from './classify-doc.ts'

/** 아웃라인 1줄. lines = 그 노드가 품는 총 줄 수(자식 포함) — 그룹 크기 감각을 AI에 준다. */
interface OutlineRow {
  id: string
  level: number
  kind: string
  title: string
  lines: number
}

function countLines(node: StructureNode): number {
  const own = node.lineEnd - node.lineStart + 1
  return node.children.reduce((sum, c) => sum + countLines(c), own)
}

/** 트리 → 아웃라인 행 배열. maxDepth를 넘는 하위는 생략(절단 후보가 될 수 없는 깊이). */
export function outlineRows(tree: StructureTree, maxDepth = 4): OutlineRow[] {
  const rows: OutlineRow[] = []
  const walk = (node: StructureNode, depth: number): void => {
    if (depth > maxDepth) return
    for (const child of node.children) {
      rows.push({
        id: child.id,
        level: child.level,
        kind: child.kind,
        title: child.title.slice(0, 120),
        lines: countLines(child),
      })
      walk(child, depth + 1)
    }
  }
  walk(tree.root, 1)
  return rows
}

export function serializeOutline(tree: StructureTree, maxDepth = 4): string {
  return outlineRows(tree, maxDepth)
    .map((r) => `${'  '.repeat(Math.max(0, r.level - 1))}[${r.id}] (L${r.level}, ${r.lines}줄) ${r.title}`)
    .join('\n')
}

/** 아웃라인에 실재하는 노드 id 집합 — AI 환각 id를 걸러내는 데 쓴다. */
export function outlineIds(tree: StructureTree, maxDepth = 4): Set<string> {
  return new Set(outlineRows(tree, maxDepth).map((r) => r.id))
}

export function buildCutPrompt(
  tree: StructureTree,
  docType: DocType,
  command: string,
  maxDepth = 4,
): string {
  const cmd = command.trim()
  return (
    '아래는 한 문서의 구조 아웃라인이다. 이 문서를 "심층 분석의 단위"가 될 그룹으로 어떻게 자를지 결정하라.\n\n' +
    `문서 유형: ${DOC_TYPE_LABEL[docType]}\n` +
    `이 유형의 기본 절단 단위: ${DEFAULT_CUT_HINT[docType]}\n` +
    (cmd ? `사용자 지시(최우선 — 기본 단위보다 우선한다): ${cmd}\n` : '') +
    '\n판단 규칙:\n' +
    '- 그룹 개수에 상한·하한이 없다. 문서 구조와 사용자 지시가 정하는 자연스러운 수를 그대로 낸다.\n' +
    '- 각 그룹은 "제목 + 그에 속한 하위 내용 전체"가 한 덩어리가 되어야 한다. 하위 항목을 낱개로 쪼개지 않는다.\n' +
    '- 문서 버전·작성일·상태 같은 문서 메타데이터 블록은 그룹으로 선택하지 않는다(별도 처리됨).\n' +
    '- 사용자가 특정 부분만 지목하면 그 부분에 해당하는 노드만 선택한다.\n' +
    '\n출력은 JSON 객체만. 두 형식 중 하나:\n' +
    '  {"mode":"level","level":<정수>,"reason":"<한 문장>"}      // 특정 레벨에서 일괄 절단\n' +
    '  {"mode":"nodes","nodeIds":["1","2",...],"reason":"<한 문장>"} // 특정 노드만 선택\n' +
    '다른 설명·마크다운을 절대 추가하지 않는다.\n\n' +
    '아웃라인:\n"""\n' +
    serializeOutline(tree, maxDepth) +
    '\n"""'
  )
}

export interface CutDecision {
  spec: CutSpec
  reason: string
  /** AI 응답이 유효하지 않아 결정론 폴백을 쓴 경우 true. */
  fallback: boolean
}

/** 폴백 절단 레벨 — 자식이 있는 최상위 레벨. AI가 실패해도 그룹핑은 진행된다. */
export function fallbackCutSpec(tree: StructureTree): CutSpec {
  const rows = outlineRows(tree, 2)
  if (rows.length === 0) return { level: 1 }
  const minLevel = Math.min(...rows.map((r) => r.level))
  return { level: minLevel }
}

export function parseCutResult(
  parsed: Record<string, unknown> | null,
  tree: StructureTree,
  maxDepth = 4,
): CutDecision {
  const reason = typeof parsed?.reason === 'string' ? parsed.reason : ''
  const mode = parsed?.mode

  if (mode === 'level' && typeof parsed?.level === 'number' && Number.isFinite(parsed.level)) {
    const level = Math.max(1, Math.trunc(parsed.level))
    return { spec: { level }, reason, fallback: false }
  }

  if (mode === 'nodes' && Array.isArray(parsed?.nodeIds)) {
    const valid = outlineIds(tree, maxDepth)
    const ids = (parsed.nodeIds as unknown[]).filter(
      (v): v is string => typeof v === 'string' && valid.has(v),
    )
    if (ids.length > 0) return { spec: { nodeIds: ids }, reason, fallback: false }
  }

  return { spec: fallbackCutSpec(tree), reason: reason || 'AI 절단 판정 실패 — 최상위 레벨로 폴백', fallback: true }
}
