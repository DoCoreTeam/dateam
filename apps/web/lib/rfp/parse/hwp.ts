/**
 * HWP·HWPX 파서 어댑터 (설계서 3.3.1)
 *
 * ## 왜 이 형식이 먼저인가
 *
 * 공공 RFP 의 본문은 거의 전부 한글 문서다. PDF 만 읽는 시스템은
 * **가장 중요한 문서를 못 읽는 시스템**이다.
 *
 * ## 배포용 문서를 여기서 막는 이유
 *
 * 배포용(DRM) 한글 문서는 파서가 열지 못한다. 그런데 열지 못한 것을 「내용이 없음」으로
 * 넘기면 화면은 «분석 완료»를 띄우고 사용자는 빈 리포트를 믿는다.
 * 그래서 파싱을 **시도하기 전에** 헤더만 보고 거절하고, 무엇을 해야 하는지 사유로 돌려준다.
 *
 * ## 페이지 번호는 근사다
 *
 * 우리 조판 결과는 한컴 뷰어의 쪽 나눔과 다를 수 있다(설계서 4장 11).
 * 그래서 블록에 페이지를 달지 않고, 정식 근거는 `source_ref` 의 구역·문단 번호로 남긴다.
 * 「3쪽에 있다」고 적어 두면 사용자가 원문에서 못 찾는 일이 생긴다.
 */

import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { IrDocument, IrBlock, IrTable, IrTableCell } from '../ir/types.ts'
import { makeBlock, makeDocument, qualityScore, textHash } from '../ir/build.ts'

export const HWP_PARSER = 'rhwp'
export const HWP_PARSER_VERSION = '0.8.6'

/** 경고 코드 — 화면에 뜨는 말은 여기 두지 않는다 (말은 terms 한 곳) */
export const HWP_WARNING = {
  /** 쪽 번호를 붙이지 않았다. 원문 대조는 구역·문단 번호로 한다 */
  pageNoApproximate: 'page_no_approximate',
  /** 병합된 셀을 1x1 로 폈다 */
  mergedCellFlattened: 'merged_cell_flattened',
  /** 문서 전체를 감싼 레이아웃 표를 줄 단위로 쪼갰다 — 표가 아니라 문서 틀이다 */
  layoutTableSplit: 'layout_table_split',
  /** 본문에서 글자를 하나도 못 건졌다 */
  noText: 'no_text',
} as const

export type HwpFormat = 'hwp5' | 'hwpx' | 'hwp3' | 'hwpml' | 'unknown'

export interface HwpSniff {
  format: HwpFormat
  /** 배포용(읽기 전용) 문서인가 — 열기 전에 이것부터 본다 */
  distribution: boolean
  passwordProtected: boolean
  compressed: boolean
}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const HWP5_SIGNATURE = 'HWP Document File'

/** FileHeader 속성 비트 (HWP 5.0 문서 규격) */
const PROP_COMPRESSED = 0x01
const PROP_PASSWORD = 0x02
const PROP_DISTRIBUTION = 0x04

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b)
}

/**
 * 파일 앞머리만 보고 형식과 잠금 여부를 읽는다 — **파서를 부르기 전에** 부른다.
 *
 * HWP 5.0 은 OLE 복합 문서라 FileHeader 스트림 위치가 파일마다 다르다.
 * 그래서 시그니처 문자열을 찾아 거기서부터 오프셋을 잰다.
 * 이 문자열은 FileHeader 스트림에만 나온다.
 */
export function sniffHwp(bytes: Uint8Array): HwpSniff {
  const base: HwpSniff = {
    format: 'unknown', distribution: false, passwordProtected: false, compressed: false,
  }

  if (startsWith(bytes, ZIP_MAGIC)) {
    // HWPX 는 ZIP 이고 mimetype 이 맨 앞에 압축 없이 들어간다
    const head = Buffer.from(bytes.slice(0, 200)).toString('latin1')
    if (head.includes('application/hwp+zip')) return { ...base, format: 'hwpx' }
    return base
  }

  if (!startsWith(bytes, CFB_MAGIC)) {
    const head = Buffer.from(bytes.slice(0, 400)).toString('utf8')
    // HWPML 은 XML 이라 헤더가 눈에 보인다
    if (head.includes('<HWPML')) return { ...base, format: 'hwpml' }
    if (head.startsWith('HWP Document File V3.00')) return { ...base, format: 'hwp3' }
    return base
  }

  const buf = Buffer.from(bytes)
  const at = buf.indexOf(Buffer.from(HWP5_SIGNATURE, 'latin1'))
  if (at < 0 || at + 40 > buf.length) return { ...base, format: 'unknown' }

  const props = buf.readUInt32LE(at + 36)
  return {
    format: 'hwp5',
    compressed: (props & PROP_COMPRESSED) !== 0,
    passwordProtected: (props & PROP_PASSWORD) !== 0,
    distribution: (props & PROP_DISTRIBUTION) !== 0,
  }
}

export type HwpRejectReason =
  /** 배포용(DRM) — 한컴에서 «일반 문서로 저장» 한 뒤 다시 올려야 한다 */
  | 'drm_distribution'
  | 'password_protected'
  | 'unsupported_format'
  | 'parse_failed'

export type HwpParseResult =
  | { ok: true; doc: IrDocument }
  | { ok: false; reason: HwpRejectReason; detail: string }

// ── 엔진 ─────────────────────────────────────────────────────

type RhwpModule = typeof import('@rhwp/core')
let engine: RhwpModule | null = null

/**
 * WASM 을 한 번만 올린다.
 *
 * `initSync` 는 여러 번 불러도 되지만 그때마다 수 MB 를 다시 컴파일한다.
 * 요청마다 올리면 파싱 자체보다 초기화가 오래 걸린다.
 */
export async function initHwpEngine(): Promise<RhwpModule> {
  if (engine) return engine
  const mod = (await import('@rhwp/core')) as RhwpModule
  mod.initSync({ module: readFileSync(findWasmPath()) })
  engine = mod
  return mod
}

/** 어디를 뒤졌는지 남긴다 — 「못 찾았다」만으로는 무엇을 고쳐야 할지 모른다 */
export class WasmNotFoundError extends Error {
  readonly tried: string[]
  constructor(tried: string[]) {
    super(`한글 파서(WASM)를 찾지 못했다. 찾아본 곳: ${tried.join(' · ')}`)
    this.name = 'WasmNotFoundError'
    this.tried = tried
  }
}

/**
 * `rhwp_bg.wasm` 의 실제 경로.
 *
 * ## 왜 후보를 여러 개 두나
 *
 * 경로를 **런타임에 조립한다** — 문자열 그대로 두면 webpack 이 정적으로 읽어
 * `.wasm` 을 자바스크립트로 번들하려다 빌드가 죽는다
 * (실측 2026-09-09: "Module parse failed … not flagged as WebAssembly module").
 *
 * 그런데 조립만으로는 부족했다. 서버 번들 안에서는 `import.meta.url` 이
 * `.next/server/…` 를 가리켜 **서브경로 해석이 실패한다**
 * (실측 2026-09-09: 실제 한글 제안요청서를 파싱하다 `Cannot find module '@rhwp/core/rhwp_bg.wasm'`
 *  으로 3회 재시도 후 죽었다. 패키지 자체(`import '@rhwp/core'`)는 멀쩡히 열렸다).
 *
 * 그래서 ⓐ 서브경로 ⓑ 패키지 진입점 옆 ⓒ 작업 폴더 아래 순서로 찾는다.
 * 셋 다 없으면 **어디를 뒤졌는지 적어서** 던진다.
 */
export function findWasmPath(): string {
  const name = ['rhwp', 'bg.wasm'].join('_')
  const pkg = ['@rhwp', 'core'].join('/')
  const tried: string[] = []

  const req = createRequire(import.meta.url)

  // ⓐ 서브경로로 바로 — 되면 가장 정확하다
  try {
    const p = req.resolve(`${pkg}/${name}`)
    if (existsSync(p)) return p
    tried.push(p)
  } catch {
    tried.push(`${pkg}/${name}`)
  }

  // ⓑ 패키지 진입점을 찾고 그 옆에서 — 진입점은 external 이라 늘 해석된다
  try {
    const entry = req.resolve(pkg)
    const p = join(dirname(entry), name)
    if (existsSync(p)) return p
    tried.push(p)
  } catch {
    tried.push(`dirname(${pkg})/${name}`)
  }

  // ⓒ 작업 폴더 아래 — 배포본에서 추적 파일이 여기 실린다
  for (const base of [process.cwd(), join(process.cwd(), '..', '..')]) {
    const p = join(base, 'node_modules', '@rhwp', 'core', name)
    if (existsSync(p)) return p
    tried.push(p)
  }

  throw new WasmNotFoundError(tried)
}

export interface HwpParseOptions {
  /** 블록 ID 의 뿌리. 같은 파일은 언제 파싱해도 같은 ID 를 얻는다 */
  fileId: string
  fileRole?: string
}

/**
 * 한글 문서를 IR 로 바꾼다.
 *
 * 실패를 예외가 아니라 값으로 돌려준다 — 인입 큐가 사유별로 다르게 처리해야 하고,
 * 예외 메시지를 문자열 비교로 분기하기 시작하면 곧 틀린다.
 */
export async function parseHwp(
  bytes: Uint8Array,
  opts: HwpParseOptions,
): Promise<HwpParseResult> {
  const sniff = sniffHwp(bytes)

  // 열기 전에 거절한다 — 열어 보고 실패하면 「내용 없음」과 구분이 안 된다
  if (sniff.distribution) {
    return { ok: false, reason: 'drm_distribution', detail: `format=${sniff.format}` }
  }
  if (sniff.passwordProtected) {
    return { ok: false, reason: 'password_protected', detail: `format=${sniff.format}` }
  }
  if (sniff.format === 'unknown') {
    return { ok: false, reason: 'unsupported_format', detail: 'format=unknown' }
  }

  const mod = await initHwpEngine()
  let doc: InstanceType<RhwpModule['HwpDocument']>
  try {
    doc = new mod.HwpDocument(bytes)
  } catch (e) {
    return { ok: false, reason: 'parse_failed', detail: messageOf(e) }
  }

  try {
    return { ok: true, doc: toIr(doc, sniff, opts) }
  } catch (e) {
    return { ok: false, reason: 'parse_failed', detail: messageOf(e) }
  } finally {
    doc.free()
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── IR 로 옮기기 ─────────────────────────────────────────────

interface Control {
  ctrlId: string
  para: number
  controlIndex: number
}

/** 셀 한 칸에서 문단 몇 개까지 읽나. 넘치는 만큼은 잘린다 */
const MAX_CELL_PARAS = 8
/** 셀 한 문단에서 읽는 글자 수 상한 */
const MAX_CELL_CHARS = 4000

function toIr(
  doc: InstanceType<RhwpModule['HwpDocument']>,
  sniff: HwpSniff,
  opts: HwpParseOptions,
): IrDocument {
  const blocks: IrBlock[] = []
  const tables: IrTable[] = []
  const warnings = new Set<string>([HWP_WARNING.pageNoApproximate])
  let order = 0

  const sectionCount = doc.getSectionCount()
  for (let sec = 0; sec < sectionCount; sec++) {
    const tablesHere = tablesInSection(doc, sec)
    const paraCount = doc.getParagraphCount(sec)

    for (let para = 0; para < paraCount; para++) {
      const table = tablesHere.get(para)
      if (table) {
        const built = buildTable(doc, sec, table, opts.fileId, order, warnings)
        if (built) {
          blocks.push(...built.blocks)
          if (built.table) tables.push(built.table)
          order += built.blocks.length
          continue
        }
      }

      const len = doc.getParagraphLength(sec, para)
      if (len <= 0) continue
      const text = doc.getTextRange(sec, para, 0, len).trim()
      if (!text) continue

      blocks.push(makeBlock(opts.fileId, order, {
        type: 'paragraph',
        text,
        // 쪽 번호를 일부러 비운다 — 근거는 구역·문단 번호다
        pageNo: null,
        sourceRef: { kind: 'hwp', sectionIdx: sec, paraIdx: para },
      }))
      order += 1
    }
  }

  if (blocks.length === 0) warnings.add(HWP_WARNING.noText)

  const score = qualityScore({
    textPageRatio: blocks.length > 0 ? 1 : 0,
    tableCount: tables.length,
    avgOcrConfidence: null,
    // 섹션 트리는 뒤 단계에서 만든다. 여기서 1 이라고 적는 것이 사실이다
    sectionDepth: 1,
    warningCount: warnings.size - 1, // 쪽 번호 근사는 결함이 아니라 설계다
  })

  return makeDocument({
    meta: {
      fileRole: opts.fileRole ?? 'unknown',
      format: sniff.format,
      pageCount: 0,
      parser: HWP_PARSER,
      parserVersion: HWP_PARSER_VERSION,
      qualityScore: score,
      warnings: Array.from(warnings),
    },
    blocks,
    tables,
  })
}

/** 구역 안의 표를 문단 번호로 찾을 수 있게 모은다 */
function tablesInSection(
  doc: InstanceType<RhwpModule['HwpDocument']>,
  sec: number,
): Map<number, Control> {
  const found = new Map<number, Control>()
  let parsed: unknown
  try {
    parsed = JSON.parse(doc.getControls())
  } catch {
    return found
  }
  if (!Array.isArray(parsed)) return found

  for (const raw of parsed) {
    const c = raw as Partial<Control> & { list?: number }
    if (c.ctrlId !== 'tbl') continue
    // list 는 구역 안의 목록 번호다. 본문(0)만 여기서 다룬다
    if (typeof c.list === 'number' && c.list !== sec) continue
    if (typeof c.para !== 'number' || typeof c.controlIndex !== 'number') continue
    found.set(c.para, { ctrlId: 'tbl', para: c.para, controlIndex: c.controlIndex })
  }
  return found
}

function buildTable(
  doc: InstanceType<RhwpModule['HwpDocument']>,
  sec: number,
  ctrl: Control,
  fileId: string,
  order: number,
  warnings: Set<string>,
): { blocks: IrBlock[]; table: IrTable | null } | null {
  let dims: { rowCount?: number; colCount?: number }
  try {
    dims = JSON.parse(doc.getTableDimensions(sec, ctrl.para, ctrl.controlIndex))
  } catch {
    return null
  }
  const rows = dims.rowCount ?? 0
  const cols = dims.colCount ?? 0
  if (rows <= 0 || cols <= 0) return null

  const cells: IrTableCell[] = []
  for (let i = 0; i < rows * cols; i++) {
    const text = cellText(doc, sec, ctrl, i)
    // 병합 정보는 이 판의 API 로 못 읽는다. 1x1 로 펴고 그 사실을 남긴다
    cells.push({ r: Math.floor(i / cols), c: i % cols, rowspan: 1, colspan: 1, text })
  }
  warnings.add(HWP_WARNING.mergedCellFlattened)

  const grid = toRows(cells, rows, cols)
  const flat = grid.map((r) => r.join('\t')).join('\n')

  /**
   * **문서 전체가 표 하나인 경우가 있다.**
   *
   * 한글 공공기관 서식은 공고서 전체를 하나의 큰 표로 짠다 — 실측 2026-09-09:
   * 133KB 공고서가 **블록 1개(26,796자)** 가 됐다. 참가자격·제출서류·평가방법이
   * 한 덩어리라 근거로 가리킬 수 없고(가리키면 문서 전체를 가리킨다),
   * 화면에서도 한 문단으로 흘렀다.
   *
   * 그래서 큰 표는 **줄 단위로 쪼갠다.** 그건 표가 아니라 문서의 흐름이므로
   * 표 목록에도 안 넣는다 — 넣으면 「표 71개」 같은 수가 거짓이 된다.
   */
  if (flat.length > MAX_TABLE_CHARS) {
    warnings.add(HWP_WARNING.layoutTableSplit)
    const blocks: IrBlock[] = []
    for (const row of grid) {
      const line = row.filter(Boolean).join(' ').trim()
      if (!line) continue
      blocks.push(makeBlock(fileId, order + blocks.length, {
        type: 'paragraph',
        text: line,
        pageNo: null,
        sourceRef: { kind: 'hwp', sectionIdx: sec, paraIdx: ctrl.para },
      }))
    }
    // 한 줄도 못 건지면 원래대로 표 한 덩이로 둔다 — 내용을 잃는 것이 가장 나쁘다
    if (blocks.length > 0) return { blocks, table: null }
  }

  const block = makeBlock(fileId, order, {
    type: 'table',
    // 평문은 셀 경계를 탭으로 남긴다 — 검색과 임베딩이 이 문자열을 쓴다
    text: flat,
    html: toHtml(cells, rows, cols),
    pageNo: null,
    sourceRef: { kind: 'hwp', sectionIdx: sec, paraIdx: ctrl.para },
  })

  return {
    blocks: [block],
    table: {
      tableId: textHash(`${fileId}|tbl|${sec}|${ctrl.para}|${ctrl.controlIndex}`).slice(0, 16),
      blockId: block.blockId,
      rows, cols, cells,
      caption: null,
    },
  }
}

/**
 * 이보다 큰 표는 표가 아니라 **문서 틀**로 본다.
 *
 * 진짜 데이터 표(요구사항 총괄표·평가 배점표)는 이 크기를 넘지 않는다.
 * 넘는 것은 공고서 전체를 감싼 레이아웃 표다.
 */
export const MAX_TABLE_CHARS = 4_000

function cellText(
  doc: InstanceType<RhwpModule['HwpDocument']>,
  sec: number,
  ctrl: Control,
  cellIdx: number,
): string {
  const parts: string[] = []
  for (let p = 0; p < MAX_CELL_PARAS; p++) {
    let t = ''
    try {
      t = doc.getTextInCell(sec, ctrl.para, ctrl.controlIndex, cellIdx, p, 0, MAX_CELL_CHARS)
    } catch {
      break
    }
    if (!t) break
    parts.push(t)
  }
  return parts.join('\n').trim()
}

function toRows(cells: IrTableCell[], rows: number, cols: number): string[][] {
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
  for (const cell of cells) {
    if (cell.r < rows && cell.c < cols) grid[cell.r][cell.c] = cell.text
  }
  return grid
}

/** 표는 HTML 로도 남긴다 — 평문만 남기면 셀 경계가 사라져 표가 아니게 된다 */
function toHtml(cells: IrTableCell[], rows: number, cols: number): string {
  const body = toRows(cells, rows, cols)
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<table>${body}</table>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
