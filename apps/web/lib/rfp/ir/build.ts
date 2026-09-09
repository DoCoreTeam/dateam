/**
 * RFP-IR 를 만드는 자리 — 파서가 여기로만 값을 넣는다 (설계서 3.3.3)
 *
 * ## 여기 모으는 이유
 *
 * 좌표 변환과 블록 ID 생성이 파서마다 흩어지면, 형식 하나가 늘 때마다
 * **위아래가 뒤집힌 하이라이트**와 **다시 파싱하면 끊기는 근거 링크**가 함께 생긴다.
 * 둘 다 겪고 나서야 보이는 종류의 결함이라 처음부터 한 곳에 둔다.
 */

import { createHash } from 'node:crypto'
import type {
  Bbox, IrBlock, IrDocument, IrMeta, IrPage, IrSection, IrTable, IrFigure,
  BlockType, SourceRef,
} from './types.ts'

/**
 * 블록 ID — **위치에서 결정론적으로** 만든다.
 *
 * 랜덤 UUID 를 쓰면 같은 파일을 다시 파싱했을 때 ID 가 전부 바뀌고,
 * 지난 리포트가 가리키던 근거가 통째로 끊긴다(설계서 3.1-6 불변 이력).
 * 그래서 «파일 + 원문 위치» 를 해싱한다. 같은 자리는 언제 파싱해도 같은 ID 다.
 */
export function blockKey(fileId: string, ref: SourceRef, orderNo: number): string {
  const loc =
    ref.kind === 'hwp' ? `hwp:${ref.sectionIdx}:${ref.paraIdx}:${ref.charOffset ?? 0}`
    : ref.kind === 'pdf' ? `pdf:${ref.pageIdx}:${ref.charStart}:${ref.charEnd}`
    : ref.kind === 'office' ? `office:${ref.nodePath}`
    : `image:${ref.pageIdx}`
  return createHash('sha1').update(`${fileId}|${loc}|${orderNo}`).digest('hex').slice(0, 24)
}

/**
 * 본문 해시 — 근거 대조가 「이 블록이 그때 그 블록인가」를 볼 때 쓴다.
 *
 * 공백과 줄바꿈은 파서 판마다 흔들리므로 정규화한 뒤 해싱한다.
 * 흔들림까지 해싱하면 파서를 올릴 때마다 전 블록이 «바뀐 것»이 된다.
 */
export function textHash(text: string): string {
  return createHash('sha256').update(normalizeForHash(text)).digest('hex').slice(0, 32)
}

/** 해시·대조용 정규화 — 보이는 글자만 남긴다 */
export function normalizeForHash(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')   // 폭 없는 문자 — 붙여넣기에 흔히 섞인다
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * PDF 좌표를 IR 규격으로 — **원점 좌하단·포인트 → 원점 좌상단·0~1 비율**
 *
 * 이 변환을 빠뜨리면 하이라이트가 위아래로 뒤집힌 자리에 그려진다.
 * 화면에서만 보이는 결함이라 여기서 잠근다.
 */
export function bboxFromPdf(
  b: { x0: number; y0: number; x1: number; y1: number },
  page: { width: number; height: number },
): Bbox {
  if (page.width <= 0 || page.height <= 0) {
    throw new Error(`페이지 크기가 0 이하다: ${page.width}x${page.height}`)
  }
  // y 를 뒤집는다: 좌하단 기준 y 는 위로 갈수록 커지고, 우리는 아래로 갈수록 커진다
  const top = page.height - Math.max(b.y0, b.y1)
  const bottom = page.height - Math.min(b.y0, b.y1)
  return clampBbox({
    x0: Math.min(b.x0, b.x1) / page.width,
    y0: top / page.height,
    x1: Math.max(b.x0, b.x1) / page.width,
    y1: bottom / page.height,
  })
}

/** 이미 좌상단 기준인 좌표(HWP·오피스)를 비율로만 바꾼다 */
export function bboxFromTopLeft(
  b: { x0: number; y0: number; x1: number; y1: number },
  page: { width: number; height: number },
): Bbox {
  if (page.width <= 0 || page.height <= 0) {
    throw new Error(`페이지 크기가 0 이하다: ${page.width}x${page.height}`)
  }
  return clampBbox({
    x0: Math.min(b.x0, b.x1) / page.width,
    y0: Math.min(b.y0, b.y1) / page.height,
    x1: Math.max(b.x0, b.x1) / page.width,
    y1: Math.max(b.y0, b.y1) / page.height,
  })
}

/** 0~1 을 벗어나면 접는다 — 파서가 페이지 밖 좌표를 주는 일이 실제로 있다 */
export function clampBbox(b: Bbox): Bbox {
  // NaN 은 위치를 모른다는 뜻이라 0, 무한대는 페이지 밖이라는 뜻이라 경계로 접는다
  const c = (n: number) => Math.min(1, Math.max(0, Number.isNaN(n) ? 0 : n))
  return { x0: c(b.x0), y0: c(b.y0), x1: c(b.x1), y1: c(b.y1) }
}

export interface BlockInput {
  type: BlockType
  text: string
  html?: string | null
  pageNo?: number | null
  bbox?: Bbox | null
  sectionId?: string | null
  sourceRef: SourceRef
  ocrConfidence?: number | null
}

/** 블록 하나를 만든다 — ID 와 해시는 여기서만 붙는다 */
export function makeBlock(fileId: string, orderNo: number, input: BlockInput): IrBlock {
  return {
    blockId: blockKey(fileId, input.sourceRef, orderNo),
    type: input.type,
    text: input.text,
    html: input.html ?? null,
    pageNo: input.pageNo ?? null,
    bbox: input.bbox ?? null,
    sectionId: input.sectionId ?? null,
    orderNo,
    sourceRef: input.sourceRef,
    textHash: textHash(input.text),
    ocrConfidence: input.ocrConfidence ?? null,
  }
}

export interface DocumentInput {
  meta: IrMeta
  pages?: IrPage[]
  sections?: IrSection[]
  blocks?: IrBlock[]
  tables?: IrTable[]
  figures?: IrFigure[]
}

/**
 * 문서를 만든다. 빠진 배열은 빈 배열로 채운다 —
 * `undefined` 를 그대로 두면 소비하는 쪽이 전부 옵셔널 체이닝을 달아야 하고,
 * 그러다 한 곳을 빠뜨리면 그 화면만 죽는다.
 */
export function makeDocument(input: DocumentInput): IrDocument {
  return {
    meta: input.meta,
    pages: input.pages ?? [],
    sections: input.sections ?? [],
    blocks: input.blocks ?? [],
    tables: input.tables ?? [],
    figures: input.figures ?? [],
  }
}

/** 근거 링크가 실제로 닿는지 — 저장 직전에 부른다 */
export function findBlock(doc: IrDocument, blockId: string): IrBlock | null {
  return doc.blocks.find((b) => b.blockId === blockId) ?? null
}

/**
 * IR 가 스스로 모순되지 않는지 본다.
 *
 * 저장한 뒤에 깨진 것을 알면 되돌릴 방법이 없다 —
 * 섹션이 없는 블록을 가리키거나, 표가 없는 블록에 매달려 있으면 여기서 잡는다.
 */
export function validateDocument(doc: IrDocument): string[] {
  const problems: string[] = []
  const blockIds = new Set(doc.blocks.map((b) => b.blockId))
  const sectionIds = new Set(doc.sections.map((s) => s.sectionId))

  if (blockIds.size !== doc.blocks.length) problems.push('블록 ID 가 겹친다')

  for (const b of doc.blocks) {
    if (b.sectionId && !sectionIds.has(b.sectionId)) {
      problems.push(`블록 ${b.blockId} 가 없는 섹션 ${b.sectionId} 를 가리킨다`)
    }
  }
  for (const s of doc.sections) {
    if (s.parentId && !sectionIds.has(s.parentId)) {
      problems.push(`섹션 ${s.sectionId} 가 없는 부모 ${s.parentId} 를 가리킨다`)
    }
    for (const id of s.blockIds) {
      if (!blockIds.has(id)) problems.push(`섹션 ${s.sectionId} 가 없는 블록 ${id} 를 가리킨다`)
    }
  }
  for (const t of doc.tables) {
    if (!blockIds.has(t.blockId)) problems.push(`표 ${t.tableId} 가 없는 블록에 매달려 있다`)
  }
  for (const f of doc.figures) {
    if (!blockIds.has(f.blockId)) problems.push(`그림 ${f.figureId} 가 없는 블록에 매달려 있다`)
  }
  return problems
}

/**
 * 품질 점수 0~100 (설계서 3.3.3)
 *
 * 다섯 신호를 더한다. **60 미만이면 화면이 경고를 띄우고 재처리를 권한다** —
 * 점수를 안 내면 「AI 가 못 읽은 것」과 「원문에 없는 것」을 사용자가 구분할 수 없다.
 */
export interface QualitySignals {
  /** 텍스트가 있는 쪽 / 전체 쪽 */
  textPageRatio: number
  tableCount: number
  /** 이미지에서 뽑은 블록들의 평균 신뢰도. 그런 블록이 없으면 null */
  avgOcrConfidence: number | null
  /** 섹션 트리 깊이. 1 이면 제목을 못 찾아 페이지 단위로 접힌 것이다 */
  sectionDepth: number
  warningCount: number
}

export function qualityScore(s: QualitySignals): number {
  const ratio = Math.min(1, Math.max(0, s.textPageRatio))
  let score = ratio * 55                                   // 글자를 얼마나 건졌나 — 가장 무겁다
  score += Math.min(15, s.tableCount * 3)                  // 표를 알아봤나
  score += s.avgOcrConfidence === null ? 10 : s.avgOcrConfidence * 10
  score += Math.min(20, Math.max(0, s.sectionDepth - 1) * 7) // 깊이 1 은 폴백이라 0점
  score -= Math.min(20, s.warningCount * 4)
  return Math.round(Math.min(100, Math.max(0, score)))
}

/** 이 점수면 사용자에게 경고를 띄운다 */
export const QUALITY_WARN_BELOW = 60

export function isLowQuality(score: number): boolean {
  return score < QUALITY_WARN_BELOW
}
