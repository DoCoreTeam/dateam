// 문서 메타데이터 라인 식별·분리 — 결정론 코드.
// 판정 범위를 "문서 앞부분(front-matter)"과 "변경 이력/문서 정보 섹션"으로 한정해
// 본문 중간의 유사 문자열("- 상태: 진행 중" 같은 로드맵 항목)을 메타로 오분류하지 않는다.
// 설계: docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/00-requirements.md FR-5

import type { DocMetaEntry, StructureTree } from './types.ts'
import { subtreeLineEnd, walkStructureTree } from './structure-tree.ts'

/** 변경이력/문서정보류 섹션 제목 — 이 제목의 heading 서브트리 전체를 메타로 취급한다. */
const META_SECTION_TITLE_RE = /^(변경\s*이력|변경이력|문서\s*정보|revision\s*history|change\s*log|document\s*info)$/i

/** key: value 형태 메타 라인 — 선두 불릿 마커 허용. */
const META_KV_RE =
  /^\s*[-*•]?\s*(문서\s*버전|버전|작성일|작성자|상태|최종\s*수정|문서명|프로젝트명|version|date|author|status)\s*[:：]\s*(.+?)\s*$/i

/** 변경이력 라인 — "v0.1.0 (2026-07-20): 초안 작성" 형태. */
const CHANGELOG_RE = /^\s*[-*•]?\s*v?(\d+\.\d+\.\d+)\s*\(([^)]+)\)\s*[:：]\s*(.+?)\s*$/i

function matchMetaLine(raw: string, lineNo: number): DocMetaEntry | null {
  const kv = raw.match(META_KV_RE)
  if (kv) return { key: kv[1].trim(), value: kv[2].trim(), lineNo }
  const changelog = raw.match(CHANGELOG_RE)
  if (changelog) return { key: `v${changelog[1]}`, value: `${changelog[2]}: ${changelog[3]}`.trim(), lineNo }
  return null
}

export interface ExtractDocMetaResult {
  meta: DocMetaEntry[]
  metaLineNumbers: Set<number>
}

/**
 * 문서 메타를 식별한다.
 * 1) front-matter 영역: 첫 heading 이전의 모든 비공백 줄 — 전부 메타 줄로 표시(구조 미확정 상태의 문서 속성).
 * 2) 명시적 메타 섹션(변경 이력/문서 정보): 해당 heading의 서브트리 전체(자기 자신 + 모든 자손) 비공백 줄.
 * KV/변경이력 패턴에 맞는 줄만 구조화 entry로 반환하고, 나머지는 metaLineNumbers에만 포함된다
 * (예: heading 제목 줄 자체는 entry는 없지만 그룹으로 새어나가지 않도록 메타 줄로는 집계됨).
 */
export function extractDocMeta(text: string, tree: StructureTree): ExtractDocMetaResult {
  const metaLineNumbers = new Set<number>()
  const meta: DocMetaEntry[] = []

  // front-matter 영역의 끝 = "첫 헤딩 이전". 단 **선행 문서 제목 헤딩 1개는 건너뛴다.**
  //
  // 왜: 실제 문서 대부분은 "# 문서 제목"으로 시작하고 그 아래 버전·작성일·작성자가 온다.
  // 제목을 첫 헤딩으로 보면 front-matter 구간이 0줄이 되어 메타 불릿이 영역 밖으로 밀리고,
  // 결국 첫 그룹 본문에 흡수된다(실측 사고: "- 문서 버전: v2.3.1"이 요구사항 1 그룹에 포함됨).
  // 제목 헤딩은 하위 내용 없이 곧바로 다음 헤딩이 오거나, 뒤따르는 비헤딩 줄만 갖는 최상위 헤딩이다.
  const headings: { line: number; level: number }[] = []
  walkStructureTree(tree.root, (node) => {
    if (node.kind === 'heading') headings.push({ line: node.lineStart, level: node.level })
  })
  headings.sort((a, b) => a.line - b.line)

  let frontMatterEnd = headings.length > 0 ? headings[0].line : tree.lines.length
  if (headings.length >= 2) {
    const [first, second] = headings
    // 첫 헤딩이 두 번째보다 상위 레벨이고 문서 맨 앞에 있으면 = 문서 제목 → 그 다음 헤딩까지가 front-matter
    const isTitleHeading = first.level < second.level && tree.lines.slice(0, first.line).every((l) => !l.trim())
    if (isTitleHeading) frontMatterEnd = second.line
  }

  for (let i = 0; i < frontMatterEnd; i++) {
    // 제목 헤딩 줄 자체는 메타가 아니다 — 그룹 본문에도 포함되지 않도록 메타 줄로만 집계한다
    if (/^#{1,6}\s+\S/.test(tree.lines[i])) {
      if (tree.lines[i].trim()) metaLineNumbers.add(i)
      continue
    }
    const raw = tree.lines[i]
    if (!raw.trim()) continue
    metaLineNumbers.add(i)
    const entry = matchMetaLine(raw, i)
    if (entry) meta.push(entry)
  }

  walkStructureTree(tree.root, (node) => {
    if (node.kind !== 'heading') return
    if (!META_SECTION_TITLE_RE.test(node.title.trim())) return
    const lastLine = subtreeLineEnd(node)
    for (let i = node.lineStart; i <= lastLine; i++) {
      const raw = tree.lines[i]
      if (!raw.trim()) continue
      if (metaLineNumbers.has(i)) continue
      metaLineNumbers.add(i)
      const entry = matchMetaLine(raw, i)
      if (entry) meta.push(entry)
    }
  })

  meta.sort((a, b) => a.lineNo - b.lineNo)
  return { meta, metaLineNumbers }
}
