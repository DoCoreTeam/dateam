/**
 * 섹션 트리 만들기 (설계서 3.4.1)
 *
 * ## 왜 트리가 필요한가
 *
 * 「이 요구사항이 어느 장에 있나」를 못 말하면 리포트가 근거를 인용할 때
 * **문장만 덩그러니 남는다.** 사용자는 그 문장이 과업 범위인지 평가 기준인지 모른다.
 *
 * ## 번호를 믿고 스타일을 참고한다
 *
 * 공공 문서의 번호 체계는 놀랄 만큼 일정하다 — 제1장 / 1. / 가. / 1) / (1) / ①.
 * 스타일(굵기·크기)은 문서마다 제각각이라 번호가 더 믿을 만하다.
 * 스타일은 번호가 없는 제목을 건질 때만 쓴다.
 *
 * ## 못 만들면 페이지로 접는다
 *
 * 번호가 하나도 없는 문서(스캔 PDF, 표만 있는 엑셀)에서 트리를 못 만들면
 * **빈 트리를 돌려주지 않고** 쪽마다 가상 섹션을 만든다.
 * 빈 트리를 주면 뒤 단계가 「섹션 없음」을 「내용 없음」으로 읽는다.
 */

import type { IrBlock, IrDocument, IrSection } from '../ir/types.ts'
import { textHash } from '../ir/build.ts'

/** 번호 체계 한 단계 */
export interface NumberLevel {
  /** 깊이 1 이 가장 바깥 */
  level: number
  name: string
  pattern: RegExp
}

/**
 * 바깥에서 안쪽 순서. 이 순서가 깊이를 정한다.
 *
 * 「제1장」과 「1.」이 같은 깊이면 장 아래 절이 형제가 되어 트리가 납작해진다.
 */
export const NUMBER_LEVELS: readonly NumberLevel[] = [
  { level: 1, name: 'chapter', pattern: /^제\s*([0-9IVXilⅠ-Ⅹ]+)\s*(장|편|부)/ },
  { level: 2, name: 'section', pattern: /^제\s*([0-9]+)\s*(절|관)/ },
  { level: 2, name: 'arabic_dot', pattern: /^([0-9]{1,2})\.(?!\d)\s*/ },
  { level: 3, name: 'korean', pattern: /^([가-힣])\.\s+/ },
  { level: 3, name: 'arabic_paren', pattern: /^([0-9]{1,2})\)\s*/ },
  { level: 4, name: 'paren_arabic', pattern: /^\(([0-9]{1,2})\)\s*/ },
  { level: 4, name: 'circled', pattern: /^([①-⑳])\s*/ },
  { level: 5, name: 'dash', pattern: /^[-–]\s+/ },
]

export interface HeadingHit {
  level: number
  /** 원문 번호 그대로. 정규화하지 않는다 */
  number: string | null
  title: string
  matchedBy: 'number' | 'style'
}

/**
 * 이 블록이 제목인가.
 *
 * 번호가 붙어 있으면 제목으로 본다. 번호가 없으면 파서가 heading 이라 한 것만 믿는다 —
 * 짧은 문장을 전부 제목으로 보면 본문 한 줄이 장이 되어 트리가 무너진다.
 */
export function detectHeading(block: IrBlock): HeadingHit | null {
  const text = block.text.trim()
  if (!text) return null

  for (const lv of NUMBER_LEVELS) {
    const m = text.match(lv.pattern)
    if (!m) continue
    const rest = text.slice(m[0].length).trim()
    // 번호 뒤에 아무 말도 없으면 목록 기호일 뿐 제목이 아니다
    if (!rest) continue
    // 한 문단 통째가 제목일 리 없다. 긴 것은 번호 붙은 본문이다
    if (rest.length > MAX_HEADING_CHARS) continue
    return { level: lv.level, number: m[0].trim(), title: rest, matchedBy: 'number' }
  }

  if (block.type === 'heading') {
    return { level: 2, number: null, title: text, matchedBy: 'style' }
  }
  return null
}

/** 이보다 길면 제목이 아니라 본문이다 */
export const MAX_HEADING_CHARS = 60

export interface BuildSectionsResult {
  sections: IrSection[]
  /** 블록마다 어느 섹션에 속하는지 */
  sectionOfBlock: Map<string, string>
  /** 가장 깊은 단계. 1 이면 폴백(쪽 단위)이다 */
  depth: number
  fallback: boolean
}

/**
 * 블록 목록에서 섹션 트리를 만든다.
 *
 * 제목을 못 찾으면 쪽 단위 가상 섹션으로 폴백한다 —
 * 빈 트리를 주면 뒤 단계가 「섹션 없음」을 「내용 없음」으로 읽는다.
 */
export function buildSections(doc: IrDocument): BuildSectionsResult {
  const sections: IrSection[] = []
  const sectionOfBlock = new Map<string, string>()
  /** 깊이별로 현재 열려 있는 섹션 */
  const open: (IrSection | null)[] = []
  let order = 0

  for (const block of doc.blocks) {
    const hit = detectHeading(block)
    if (hit) {
      const parent = findParent(open, hit.level)
      const section: IrSection = {
        sectionId: sectionKey(doc, order),
        level: hit.level,
        title: hit.title,
        number: hit.number,
        parentId: parent?.sectionId ?? null,
        category: null,       // 분류는 categories.ts 가 나중에 채운다
        pageStart: block.pageNo,
        pageEnd: block.pageNo,
        blockIds: [block.blockId],
        orderNo: order++,
      }
      sections.push(section)
      sectionOfBlock.set(block.blockId, section.sectionId)
      // 이 깊이 아래로 열려 있던 것은 모두 닫는다
      open.length = hit.level
      open[hit.level - 1] = section
      continue
    }

    const current = deepestOpen(open)
    if (!current) continue    // 첫 제목 앞의 표지·목차는 어느 섹션에도 안 붙인다
    current.blockIds.push(block.blockId)
    sectionOfBlock.set(block.blockId, current.sectionId)
    if (block.pageNo !== null) {
      current.pageEnd = current.pageEnd === null ? block.pageNo : Math.max(current.pageEnd, block.pageNo)
    }
  }

  if (sections.length === 0) return fallbackByPage(doc)

  const depth = Math.max(...sections.map((s) => s.level))
  return { sections, sectionOfBlock, depth, fallback: false }
}

function findParent(open: (IrSection | null)[], level: number): IrSection | null {
  for (let i = level - 2; i >= 0; i--) {
    if (open[i]) return open[i]
  }
  return null
}

function deepestOpen(open: (IrSection | null)[]): IrSection | null {
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i]) return open[i]
  }
  return null
}

function sectionKey(doc: IrDocument, order: number): string {
  const seed = doc.blocks[0]?.blockId ?? doc.meta.parser
  return `s${textHash(`${seed}|sec|${order}`).slice(0, 12)}`
}

/**
 * 쪽 단위 가상 섹션 — 제목을 하나도 못 찾았을 때.
 * 쪽 번호마저 없으면 문서 전체를 한 섹션으로 본다.
 */
function fallbackByPage(doc: IrDocument): BuildSectionsResult {
  const sections: IrSection[] = []
  const sectionOfBlock = new Map<string, string>()
  const byPage = new Map<number, IrBlock[]>()

  for (const b of doc.blocks) {
    const key = b.pageNo ?? 0
    const list = byPage.get(key)
    if (list) list.push(b)
    else byPage.set(key, [b])
  }

  let order = 0
  for (const [pageNo, blocks] of Array.from(byPage.entries()).sort((a, b) => a[0] - b[0])) {
    const section: IrSection = {
      sectionId: sectionKey(doc, order),
      level: 1,
      // 제목이 없다는 사실을 제목으로 꾸미지 않는다. 화면이 쪽 번호로 그린다
      title: null,
      number: null,
      parentId: null,
      category: null,
      pageStart: pageNo || null,
      pageEnd: pageNo || null,
      blockIds: blocks.map((b) => b.blockId),
      orderNo: order++,
    }
    sections.push(section)
    for (const b of blocks) sectionOfBlock.set(b.blockId, section.sectionId)
  }

  return { sections, sectionOfBlock, depth: 1, fallback: true }
}

/** 만든 섹션을 문서에 붙인다 — 원본을 바꾸지 않는다 */
export function applySections(doc: IrDocument, built: BuildSectionsResult): IrDocument {
  return {
    ...doc,
    sections: built.sections,
    blocks: doc.blocks.map((b) => ({
      ...b,
      sectionId: built.sectionOfBlock.get(b.blockId) ?? null,
    })),
  }
}
