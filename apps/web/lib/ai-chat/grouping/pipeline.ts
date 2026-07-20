// ①~④ 오케스트레이션 — 유형판정 → 구조복원 → 그룹절단 → 조립+유실검증.
//
// AI 호출을 인자로 주입받는다(의존성 역전). 덕분에 이 파이프라인 전체를 AI 없이 테스트할 수 있고,
// 서버액션은 얇은 래퍼로 남는다.
//
// 계약: 그룹 수 상한 없음 / 원문 슬라이스 재작성 금지 / 유실 검증은 결정론 코드가 수행.

import { buildStructureTree } from './structure-tree.ts'
import { extractDocMeta } from './doc-meta.ts'
import { cutGroups } from './assemble-groups.ts'
import { checkCoverage } from './coverage-check.ts'
import {
  buildClassifyPrompt,
  parseClassifyResult,
  docTypeFromCommand,
  type DocType,
  type ClassifyResult,
} from './classify-doc.ts'
import { buildCutPrompt, parseCutResult, type CutDecision } from './cut-groups.ts'
import type { Group, DocMetaEntry, CoverageResult, StructureTree, CutSpec } from './types.ts'

/** AI 호출자 — 프롬프트를 받아 JSON 객체(파싱 완료)를 돌려준다. 실패 시 null. */
export type JsonAiCaller = (prompt: string) => Promise<Record<string, unknown> | null>

export interface GroupingResult {
  docType: DocType
  docTypeSource: 'ai' | 'instruction'
  docTypeReason: string
  tree: StructureTree
  meta: DocMetaEntry[]
  groups: Group[]
  coverage: CoverageResult
  cut: CutDecision
}

/**
 * 전체 그룹핑 파이프라인.
 * @param text    원문 (재작성 금지 — 그룹 bodyRaw는 이 문자열의 슬라이스다)
 * @param command 사용자 자유 지시 — 유형판정·절단레벨 양쪽을 지배한다
 * @param ai      AI 호출자. null을 반환하면 각 단계가 결정론 폴백을 쓴다
 */
export async function runGrouping(
  text: string,
  command: string,
  ai: JsonAiCaller,
): Promise<GroupingResult> {
  // ② 구조 트리 복원 — 결정론. AI보다 먼저 돌려서 절단 프롬프트에 아웃라인을 줄 수 있게 한다.
  const tree = buildStructureTree(text)

  // ⑤ 문서 메타 분리 — 결정론. 삭제가 아니라 분리 보관(유실 0 유지).
  const { meta, metaLineNumbers } = extractDocMeta(text, tree)

  // ① 문서 유형 판정 — 지시에 유형이 명시되면 AI를 건너뛴다(지시 우선).
  const fromCmd = docTypeFromCommand(command)
  let classify: ClassifyResult
  if (fromCmd) {
    classify = { docType: fromCmd, source: 'instruction', reason: '사용자 지시에서 유형 확정' }
  } else {
    classify = parseClassifyResult(await ai(buildClassifyPrompt(text, command)))
  }

  // ③ 그룹 절단 — 지시가 기본 단위보다 우선한다.
  const cut = parseCutResult(await ai(buildCutPrompt(tree, classify.docType, command)), tree)

  // ④ 조립 + 유실 0 검증 — 결정론. AI 자기보고에 의존하지 않는다.
  const groups = cutGroups(tree, cut.spec, { metaLineNumbers })
  const coverage = checkCoverage(text, groups, metaLineNumbers)

  return {
    docType: classify.docType,
    docTypeSource: classify.source,
    docTypeReason: classify.reason,
    tree,
    meta,
    groups,
    coverage,
    cut,
  }
}

/**
 * 재그룹핑 — 원문·트리·메타는 그대로 두고 절단만 다시 한다(FR-7).
 * 심화 실행 전 단계이므로 비용이 낮다. 리비전 증가는 호출측(서버액션)이 담당한다.
 */
export async function runRegroup(
  text: string,
  command: string,
  docType: DocType,
  ai: JsonAiCaller,
): Promise<{ tree: StructureTree; meta: DocMetaEntry[]; groups: Group[]; coverage: CoverageResult; cut: CutDecision }> {
  const tree = buildStructureTree(text)
  const { meta, metaLineNumbers } = extractDocMeta(text, tree)
  const cut = parseCutResult(await ai(buildCutPrompt(tree, docType, command)), tree)
  const groups = cutGroups(tree, cut.spec, { metaLineNumbers })
  const coverage = checkCoverage(text, groups, metaLineNumbers)
  return { tree, meta, groups, coverage, cut }
}

/** 절단 스펙을 직접 지정해 재조립(테스트·수동 조정용). AI 호출 없음. */
export function regroupWithSpec(
  text: string,
  spec: CutSpec,
): { groups: Group[]; coverage: CoverageResult; meta: DocMetaEntry[] } {
  const tree = buildStructureTree(text)
  const { meta, metaLineNumbers } = extractDocMeta(text, tree)
  const groups = cutGroups(tree, spec, { metaLineNumbers })
  const coverage = checkCoverage(text, groups, metaLineNumbers)
  return { groups, coverage, meta }
}
