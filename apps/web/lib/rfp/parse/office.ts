/**
 * PDF·오피스 파서 어댑터 (설계서 3.3.1)
 *
 * ## 무엇을 맡나
 *
 * 한글 문서를 뺀 나머지 — PDF 공고문, DOCX 과업내용서, XLSX 요구사항표, PPTX 설명자료.
 * 형식마다 파서를 따로 두지 않고 officeparser 의 AST 를 IR 로 옮긴다.
 *
 * ## 스캔 PDF 를 여기서 가려내는 이유
 *
 * 조달청 공고문에는 «관인 찍힌 종이를 스캔한 PDF» 가 섞인다.
 * 텍스트 레이어가 없으니 파서는 **빈 페이지를 성공으로 돌려준다.**
 * 그대로 두면 리포트가 「해당 내용 없음」이라고 적고, 사용자는 그 말을 믿는다.
 * 그래서 페이지마다 글자 밀도를 재고, 낮은 쪽은 이미지 텍스트화 경로로 넘긴다.
 *
 * ## AST 사상은 순수 함수로 뺀다
 *
 * `astToIr` 는 파일을 읽지 않는다. 실제 PDF 없이도 노드 종류별 사상을 검사할 수 있어야
 * 「이 형식에서만 표가 문단이 된다」 같은 결함을 가드로 잡을 수 있다.
 */

import type { IrBlock, IrDocument, IrFigure, IrTable, IrTableCell, BlockType } from '../ir/types.ts'
import { makeBlock, makeDocument, qualityScore, textHash } from '../ir/build.ts'

export const OFFICE_PARSER = 'officeparser'
export const OFFICE_PARSER_VERSION = '7.3.0'

/** zip 폭탄과 과대 압축을 상한으로 막는다 (기존 문서 추출 경로와 같은 값) */
const PARSE_TIMEOUT_MS = 30_000

export const OFFICE_WARNING = {
  /** 글자가 거의 없는 쪽이 있다. 이미지 텍스트화로 넘겨야 한다 */
  scannedPages: 'scanned_pages',
  /** 글자를 하나도 못 건졌다 */
  noText: 'no_text',
  /** 표의 병합 정보를 못 읽어 1x1 로 폈다 */
  mergedCellFlattened: 'merged_cell_flattened',
} as const

/**
 * 텍스트 레이어가 있다고 볼 최소 글자 수.
 *
 * A4 한 쪽의 한글 본문은 보통 600자를 넘는다. 스캔 이미지 쪽은 0~수십 자다.
 * 50 은 「쪽 번호와 머리말만 살아 있는 스캔」을 스캔으로 판정하도록 잡은 값이다.
 */
export const MIN_CHARS_PER_TEXT_PAGE = 50

/** 이 쪽은 이미지에서 글자를 뽑아야 하나 */
export function needsImageText(charCount: number): boolean {
  return charCount < MIN_CHARS_PER_TEXT_PAGE
}

export type OfficeFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'rtf' | 'html' | 'csv' | 'md' | 'unknown'

export type OfficeRejectReason = 'parse_failed' | 'timeout' | 'unsupported_format'

export type OfficeParseResult =
  | { ok: true; doc: IrDocument; scanPages: number[] }
  | { ok: false; reason: OfficeRejectReason; detail: string }

// ── AST 사상 ─────────────────────────────────────────────────

/** officeparser 노드에서 우리가 쓰는 부분만 */
export interface AstNode {
  type: string
  text?: string
  children?: AstNode[]
  metadata?: Record<string, unknown>
}

export interface AstInput {
  type?: string
  content: AstNode[]
}

/**
 * AST 노드 종류를 IR 블록 종류로 옮긴다.
 *
 * 여기 없는 종류는 문단으로 접는다 — 모르는 것을 **버리는 것보다 문단으로 남기는 편**이
 * 낫다. 버리면 근거가 사라지고, 사라진 근거는 화면에서 「원문에 없음」과 구분되지 않는다.
 */
export function blockTypeOf(nodeType: string): BlockType | null {
  switch (nodeType) {
    case 'heading': return 'heading'
    case 'table': return 'table'
    case 'list': return 'list_item'
    case 'image': case 'chart': case 'drawing': return 'figure'
    case 'header': return 'header'
    case 'footer': return 'footer'
    case 'note': case 'comment': return 'footnote'
    // 컨테이너 — 자기 자신은 블록이 아니고 자식이 블록이 된다
    case 'page': case 'slide': case 'sheet': case 'break': case 'slideMaster': return null
    default: return 'paragraph'
  }
}

/** 목록 컨테이너인가 — 자기 자신이 아니라 자식이 항목이다 */
export function isListContainer(nodeType: string): boolean {
  return nodeType === 'list' || nodeType === 'definitionList'
}

/** 컨테이너인가 — 쪽·슬라이드·시트는 자식을 담는 자리일 뿐이다 */
export function isPageContainer(nodeType: string): boolean {
  return nodeType === 'page' || nodeType === 'slide' || nodeType === 'sheet'
}

export interface AstToIrOptions {
  fileId: string
  format: OfficeFormat
  fileRole?: string
}

interface WalkState {
  blocks: IrBlock[]
  tables: IrTable[]
  figures: IrFigure[]
  warnings: Set<string>
  /** 쪽 번호별 글자 수 — 스캔 판정의 근거 */
  charsByPage: Map<number, number>
  order: number
  pageNo: number
  /** 목록 안인가 — 안이면 문단이 항목이 된다 */
  inList: number
  fileId: string
}

/**
 * AST 를 IR 로 옮긴다 — 파일을 읽지 않는 순수 함수.
 */
export function astToIr(ast: AstInput, opts: AstToIrOptions): { doc: IrDocument; scanPages: number[] } {
  const st: WalkState = {
    blocks: [], tables: [], figures: [], warnings: new Set(),
    charsByPage: new Map(), order: 0, pageNo: 1, inList: 0, fileId: opts.fileId,
  }

  for (let i = 0; i < ast.content.length; i++) walk(ast.content[i], `/${i}`, st)

  // 쪽 하나도 없는 형식(docx 등)은 전체를 1쪽으로 본다
  if (st.charsByPage.size === 0) st.charsByPage.set(1, totalChars(st.blocks))

  const scanPages = Array.from(st.charsByPage.entries())
    .filter(([, chars]) => needsImageText(chars))
    .map(([page]) => page)
    .sort((a, b) => a - b)

  if (scanPages.length > 0) st.warnings.add(OFFICE_WARNING.scannedPages)
  if (st.blocks.length === 0) st.warnings.add(OFFICE_WARNING.noText)

  const pageCount = st.charsByPage.size
  const textPages = pageCount - scanPages.length

  const doc = makeDocument({
    meta: {
      fileRole: opts.fileRole ?? 'unknown',
      format: opts.format,
      pageCount,
      parser: OFFICE_PARSER,
      parserVersion: OFFICE_PARSER_VERSION,
      qualityScore: qualityScore({
        textPageRatio: pageCount > 0 ? textPages / pageCount : 0,
        tableCount: st.tables.length,
        avgOcrConfidence: null,
        sectionDepth: 1,   // 섹션 트리는 뒤 단계에서 만든다
        warningCount: st.warnings.size,
      }),
      warnings: Array.from(st.warnings),
    },
    blocks: st.blocks,
    tables: st.tables,
    figures: st.figures,
  })

  return { doc, scanPages }
}

function totalChars(blocks: IrBlock[]): number {
  return blocks.reduce((n, b) => n + b.text.length, 0)
}

function walk(node: AstNode, nodePath: string, st: WalkState): void {
  if (!node || typeof node.type !== 'string') return

  if (isPageContainer(node.type)) {
    // 쪽 번호는 metadata 에 있으면 그것을 쓰고, 없으면 나온 순서로 센다
    const declared = numberOf(node.metadata?.pageNumber ?? node.metadata?.slideNumber ?? node.metadata?.index)
    st.pageNo = declared ?? st.pageNo
    if (!st.charsByPage.has(st.pageNo)) st.charsByPage.set(st.pageNo, 0)
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      walk(node.children![i], `${nodePath}/${i}`, st)
    }
    st.pageNo += 1
    return
  }

  // 목록은 항목마다 한 블록이다. 통째로 한 블록이면 「몇 번째 요구사항인가」를 못 센다
  if (isListContainer(node.type) && (node.children?.length ?? 0) > 0) {
    st.inList += 1
    for (let i = 0; i < node.children!.length; i++) walk(node.children![i], `${nodePath}/${i}`, st)
    st.inList -= 1
    return
  }

  const type = st.inList > 0 && blockTypeOf(node.type) === 'paragraph'
    ? 'list_item'
    : blockTypeOf(node.type)
  if (type === null) {
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      walk(node.children![i], `${nodePath}/${i}`, st)
    }
    return
  }

  if (type === 'table') {
    pushTable(node, nodePath, st)
    return
  }

  const text = (node.text ?? collectText(node)).trim()
  if (!text && type !== 'figure') {
    // 글자 없는 문단은 버려도 근거가 사라지지 않는다. 그림은 자리 자체가 근거다
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      walk(node.children![i], `${nodePath}/${i}`, st)
    }
    return
  }

  const block = makeBlock(st.fileId, st.order++, {
    type,
    text,
    pageNo: st.pageNo,
    sourceRef: { kind: 'office', nodePath },
  })
  st.blocks.push(block)
  addChars(st, text.length)

  if (type === 'figure') {
    st.figures.push({
      figureId: textHash(`${st.fileId}|fig|${nodePath}`).slice(0, 16),
      blockId: block.blockId,
      imageRef: stringOf(node.metadata?.src ?? node.metadata?.path) ?? null,
      // 그림 안 글자는 다음 단계(이미지 텍스트화)가 채운다
      extractedText: null,
    })
  }

  // 블록을 냈으면 자식으로 다시 내려가지 않는다 —
  // collectText 가 이미 자식의 글을 가져왔으므로 내려가면 같은 문장이 두 번 들어간다
}

function pushTable(node: AstNode, nodePath: string, st: WalkState): void {
  const rows = (node.children ?? []).filter((c) => c.type === 'row' || c.type === 'cell')
  const grid: string[][] = []

  for (const row of rows) {
    if (row.type === 'cell') {
      // 행 없이 셀만 오는 형식이 있다. 한 줄로 본다
      grid.push([collectText(row).trim()])
      continue
    }
    grid.push((row.children ?? []).map((c) => collectText(c).trim()))
  }

  if (grid.length === 0) return
  const cols = Math.max(...grid.map((r) => r.length))
  const cells: IrTableCell[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ r, c, rowspan: 1, colspan: 1, text: grid[r][c] ?? '' })
    }
  }
  st.warnings.add(OFFICE_WARNING.mergedCellFlattened)

  const text = grid.map((r) => r.join('\t')).join('\n')
  const block = makeBlock(st.fileId, st.order++, {
    type: 'table',
    text,
    html: toHtml(grid, cols),
    pageNo: st.pageNo,
    sourceRef: { kind: 'office', nodePath },
  })
  st.blocks.push(block)
  addChars(st, text.length)

  st.tables.push({
    tableId: textHash(`${st.fileId}|tbl|${nodePath}`).slice(0, 16),
    blockId: block.blockId,
    rows: grid.length,
    cols,
    cells,
    caption: stringOf(node.metadata?.caption) ?? null,
  })
}

function addChars(st: WalkState, n: number): void {
  st.charsByPage.set(st.pageNo, (st.charsByPage.get(st.pageNo) ?? 0) + n)
}

/** 자식까지 훑어 글자를 모은다 — text 가 잎에만 있는 형식이 있다 */
function collectText(node: AstNode): string {
  const parts: string[] = []
  if (node.text) parts.push(node.text)
  for (const c of node.children ?? []) {
    const t = collectText(c)
    if (t) parts.push(t)
  }
  return parts.join(' ')
}

function numberOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function stringOf(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function toHtml(grid: string[][], cols: number): string {
  const body = grid
    .map((r) => `<tr>${Array.from({ length: cols }, (_, c) => `<td>${escapeHtml(r[c] ?? '')}</td>`).join('')}</tr>`)
    .join('')
  return `<table>${body}</table>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── 실제 파일 ────────────────────────────────────────────────

/** 확장자·MIME 이 아니라 앞머리 바이트로 고른다 — 이름은 틀릴 수 있다 */
export function sniffOffice(bytes: Uint8Array): OfficeFormat {
  const head = Buffer.from(bytes.slice(0, 8)).toString('latin1')
  if (head.startsWith('%PDF-')) return 'pdf'
  if (head.startsWith('{\\rtf')) return 'rtf'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zipHead = Buffer.from(bytes.slice(0, 3000)).toString('latin1')
    if (zipHead.includes('word/')) return 'docx'
    if (zipHead.includes('xl/')) return 'xlsx'
    if (zipHead.includes('ppt/')) return 'pptx'
    if (zipHead.includes('opendocument.text')) return 'odt'
    if (zipHead.includes('opendocument.spreadsheet')) return 'ods'
    if (zipHead.includes('opendocument.presentation')) return 'odp'
  }
  return 'unknown'
}

export interface OfficeParseOptions {
  fileId: string
  fileRole?: string
  /** 앞머리로 못 고른 경우에만 쓴다 */
  formatHint?: OfficeFormat
}

/**
 * 실제 파일을 IR 로 바꾼다.
 *
 * 실패를 예외가 아니라 값으로 돌려준다 — 인입 큐가 사유별로 다르게 처리한다.
 */
export async function parseOfficeDoc(
  bytes: Uint8Array,
  opts: OfficeParseOptions,
): Promise<OfficeParseResult> {
  const format = pickFormat(bytes, opts.formatHint)
  if (format === 'unknown') {
    return { ok: false, reason: 'unsupported_format', detail: 'format=unknown' }
  }

  let ast: AstInput
  try {
    ast = await withTimeout(loadAst(bytes), PARSE_TIMEOUT_MS)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: detail === 'timeout' ? 'timeout' : 'parse_failed', detail }
  }

  return { ok: true, ...astToIr(ast, { fileId: opts.fileId, format, fileRole: opts.fileRole }) }
}

function pickFormat(bytes: Uint8Array, hint?: OfficeFormat): OfficeFormat {
  const sniffed = sniffOffice(bytes)
  return sniffed !== 'unknown' ? sniffed : (hint ?? 'unknown')
}

async function loadAst(bytes: Uint8Array): Promise<AstInput> {
  // 동적 import — 순수 함수 테스트가 officeparser 설치를 요구하지 않게 한다
  const { parseOffice } = await import('officeparser')
  const ast = await parseOffice(Buffer.from(bytes))
  return { type: ast.type, content: (ast.content ?? []) as unknown as AstNode[] }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) },
           (e) => { clearTimeout(timer); reject(e) })
  })
}
