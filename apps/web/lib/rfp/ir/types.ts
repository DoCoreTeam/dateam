/**
 * RFP-IR — 형식이 다른 문서를 한 규격으로 (설계서 3.3.3)
 *
 * ## 왜 중간 표현을 두나
 *
 * 같은 공고가 HWP 본문 + 스캔 PDF 공고문 + XLSX 요구사항표로 온다.
 * 뒤 단계(섹션 분류·근거 대조·하이라이트)가 형식을 알면, 형식이 하나 늘 때마다
 * 그 단계를 전부 고쳐야 한다. **파서만 형식을 알고 나머지는 IR 만 안다.**
 *
 * ## 근거는 블록 ID 다
 *
 * 리포트의 모든 사실 값은 `block_id` 를 근거로 갖는다(설계서 3.1-1).
 * 그래서 블록은 **한 번 만들면 ID 가 바뀌지 않아야** 한다 —
 * 다시 파싱해서 ID 가 달라지면 지난 리포트의 근거 링크가 전부 끊긴다.
 * `block_key` 는 그래서 위치에서 결정론적으로 만든다(build.ts).
 *
 * ## 페이지는 근사다
 *
 * HWP 는 우리 조판 엔진의 페이지 구분이 한컴 뷰어와 다를 수 있다(설계서 4장 11).
 * 그래서 `page_no` 는 «보여 주기용»이고, 정식 참조는 `source_ref` 다.
 */

/** 블록 종류 — 파서가 무엇을 봤는지 */
export type BlockType =
  | 'paragraph' | 'heading' | 'table' | 'list_item' | 'figure'
  | 'caption' | 'footnote' | 'header' | 'footer'

/** 표준 목차 14종 (설계서 3.3.3) — 못 고르면 null 이다 */
export type SectionCategory =
  | 'overview' | 'background' | 'scope' | 'requirement_summary'
  | 'functional' | 'performance' | 'security' | 'constraints'
  | 'schedule' | 'budget' | 'bid_guide' | 'eligibility'
  | 'evaluation' | 'contract_terms' | 'forms'

/**
 * 원문 어디서 왔나 — 형식마다 «위치» 의 뜻이 다르다.
 * HWP 는 문단 좌표, PDF 는 문자 구간. 페이지 번호로는 되찾을 수 없다.
 */
export type SourceRef =
  | { kind: 'hwp'; sectionIdx: number; paraIdx: number; charOffset?: number }
  | { kind: 'pdf'; pageIdx: number; charStart: number; charEnd: number }
  | { kind: 'office'; nodePath: string }
  /**
   * 이미지에서 뽑은 글자. `extractedBy` 는 어느 모델·엔진이 읽었는지다 —
   * 근거 화면이 「사람이 쓴 글」과 「기계가 읽은 글」을 구분해 보여 줘야 한다
   */
  | { kind: 'image'; pageIdx: number; extractedBy?: string }
  /**
   * 평문(txt·csv·md·html). 쪽도 노드 경로도 없어서 **몇 번째 문단인지**가 유일한 자리다.
   * 이 갈래가 없던 동안 평문은 읽을 파서 자체가 없었다.
   */
  | { kind: 'text'; paraIdx: number }

/**
 * 좌표 — **원점 좌상단, 0~1 비율**로 통일한다.
 *
 * PDF 는 원점이 좌하단이고 단위가 포인트다. 그대로 담으면 렌더링 이미지 위에
 * 하이라이트를 그릴 때 위아래가 뒤집힌다. 변환은 build.ts 의 `bboxFromPdf` 한 곳에서만 한다.
 */
export interface Bbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface IrPage {
  pageNo: number
  width: number
  height: number
  /** 렌더링 파일 경로(SVG 또는 PNG). 없으면 원문 뷰어가 그 쪽을 못 그린다 */
  renderRef: string | null
}

export interface IrSection {
  sectionId: string
  level: number
  title: string | null
  /** 「제1장」·「1.」·「가.」 같은 원문 번호. 정규화하지 않고 원문 그대로 */
  number: string | null
  parentId: string | null
  category: SectionCategory | null
  pageStart: number | null
  pageEnd: number | null
  blockIds: string[]
  orderNo: number
}

export interface IrBlock {
  blockId: string
  type: BlockType
  text: string
  /** 표만 채운다 — 셀 경계가 평문에서 사라지면 표가 아니다 */
  html: string | null
  pageNo: number | null
  bbox: Bbox | null
  sectionId: string | null
  orderNo: number
  sourceRef: SourceRef
  textHash: string
  /** 이미지에서 뽑은 블록만. 낮으면 근거로 쓸 때 경고가 붙는다 */
  ocrConfidence: number | null
}

export interface IrTableCell {
  r: number
  c: number
  rowspan: number
  colspan: number
  text: string
}

export interface IrTable {
  tableId: string
  blockId: string
  rows: number
  cols: number
  cells: IrTableCell[]
  caption: string | null
}

export interface IrFigure {
  figureId: string
  blockId: string
  imageRef: string | null
  /** 그림 안의 글자. 텍스트 레이어에 없던 것이 여기 들어온다 */
  extractedText: string | null
}

export interface IrMeta {
  fileRole: string
  format: string
  pageCount: number
  parser: string
  parserVersion: string
  /** 0~100. 60 미만이면 화면이 「파싱 품질 낮음」을 띄운다 */
  qualityScore: number
  warnings: string[]
}

export interface IrDocument {
  meta: IrMeta
  pages: IrPage[]
  sections: IrSection[]
  blocks: IrBlock[]
  tables: IrTable[]
  figures: IrFigure[]
}

/**
 * 규격이 요구하는 최상위 칸.
 *
 * 타입은 런타임에 사라진다. 「설계서 3.3.3 과 1:1 이다」를 **검사할 수 있게** 하려면
 * 이름이 값으로 남아 있어야 한다 — 이 배열이 그 자리다.
 */
export const IR_DOCUMENT_KEYS = [
  'meta', 'pages', 'sections', 'blocks', 'tables', 'figures',
] as const

export const IR_META_KEYS = [
  'fileRole', 'format', 'pageCount', 'parser', 'parserVersion', 'qualityScore', 'warnings',
] as const

export const IR_BLOCK_KEYS = [
  'blockId', 'type', 'text', 'html', 'pageNo', 'bbox', 'sectionId',
  'orderNo', 'sourceRef', 'textHash', 'ocrConfidence',
] as const

export const BLOCK_TYPES: readonly BlockType[] = [
  'paragraph', 'heading', 'table', 'list_item', 'figure',
  'caption', 'footnote', 'header', 'footer',
]

export const SECTION_CATEGORIES: readonly SectionCategory[] = [
  'overview', 'background', 'scope', 'requirement_summary',
  'functional', 'performance', 'security', 'constraints',
  'schedule', 'budget', 'bid_guide', 'eligibility',
  'evaluation', 'contract_terms', 'forms',
]
