/**
 * 요구사항 총괄표 정규화 (설계서 3.4.4)
 *
 * ## 왜 총괄표가 따로인가
 *
 * 공공 RFP 의 요구사항은 **본문이 아니라 표에 있다.** 「SFR-001 사용자 인증」처럼
 * 코드가 붙어 있고, 제안서는 그 코드마다 대응을 적어야 한다.
 * 코드를 못 뽑으면 적합도 판정도 제안서 목차도 근거 없이 지어내는 글이 된다.
 *
 * ## 표 모양은 문서마다 다르다
 *
 * 같은 총괄표가 어떤 공고에서는 「구분 / 요구사항 ID / 요구사항명 / 세부내용」이고
 * 다른 공고에서는 「번호 / 분류 / 요구사항 / 상세설명 / 산출물」이다.
 * 그래서 **머리글 이름으로 칸의 뜻을 찾고**, 못 찾으면 순서로 넘어간다.
 *
 * ## XLSX 별첨도 같은 길로
 *
 * 요구사항표만 엑셀로 따로 오는 일이 흔하다. 파서가 다르면 결과도 달라지므로
 * 여기서는 **IR 의 표 블록** 만 본다. HWP 표든 XLSX 시트든 IrTable 로 들어오면 같다.
 */

import type { IrDocument, IrTable, IrTableCell } from '../ir/types.ts'
import { textHash } from '../ir/build.ts'

/**
 * 요구사항 코드 체계.
 *
 * 공공 SW 사업 요구사항 분류는 정보화사업 표준(기능·성능·인터페이스·데이터·
 * 테스트·보안·품질·제약·프로젝트관리·프로젝트지원)을 따른다.
 */
export type RequirementKind =
  | 'functional' | 'performance' | 'interface' | 'data' | 'test'
  | 'security' | 'quality' | 'constraint' | 'management' | 'support' | 'system' | 'unknown'

/** 접두어 → 종류. 실제 공고에서 쓰이는 표기를 모았다 */
export const CODE_PREFIX: Record<string, RequirementKind> = {
  SFR: 'functional', FUR: 'functional', FR: 'functional',
  PER: 'performance', PFR: 'performance', PR: 'performance',
  SIR: 'interface', IFR: 'interface', INR: 'interface',
  DAR: 'data', DR: 'data',
  TER: 'test', TR: 'test',
  SER: 'security', SCR: 'security',
  QUR: 'quality', QR: 'quality',
  COR: 'constraint', CR: 'constraint',
  PMR: 'management',
  PSR: 'support',
  ECR: 'system', SYR: 'system',
}

export interface Requirement {
  /** 원문 코드 그대로. 대문자로만 맞춘다 */
  code: string
  kind: RequirementKind
  title: string
  description: string
  /** 이 요구사항이 나온 블록. 근거 링크가 여기로 걸린다 */
  blockId: string
  tableId: string
  /** 표 안 몇 번째 행인가 */
  rowNo: number
  /** 표에 있었지만 우리 칸에 안 들어간 값들 */
  extra: Record<string, string>
}

/**
 * 요구사항 코드 모양 — 접두어 2~4자 + 구분자 + 숫자.
 *
 * 구분자를 폭넓게 받는 이유: 실제 공고에 `SFR-001` `SFR_001` `SFR 001` `SFR001` 이 다 있다.
 */
const CODE_RE = /\b([A-Z]{2,4})[\s_-]?(\d{2,4})\b/

export function parseCode(raw: string): { code: string; kind: RequirementKind } | null {
  const m = raw.toUpperCase().match(CODE_RE)
  if (!m) return null
  const prefix = m[1]
  // 접두어를 모르면 버리지 않고 unknown 으로 남긴다 — 공고마다 자기 체계를 쓴다
  return { code: `${prefix}-${m[2]}`, kind: CODE_PREFIX[prefix] ?? 'unknown' }
}

// 칸의 뜻 찾기

export type ColumnRole = 'code' | 'kind' | 'title' | 'description' | 'other'

const HEADER_RULES: readonly { role: ColumnRole; keywords: readonly string[] }[] = [
  { role: 'code', keywords: ['요구사항고유번호', '요구사항id', '요구사항번호', '고유번호', 'id', '코드', '번호'] },
  { role: 'kind', keywords: ['요구사항분류', '구분', '분류', '유형'] },
  { role: 'title', keywords: ['요구사항명', '요구사항제목', '요구사항', '항목명', '명칭'] },
  { role: 'description', keywords: ['세부내용', '상세내용', '상세설명', '정의', '내용', '설명'] },
]

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.()[\]{}<>·:/]/g, '')
}

/**
 * 머리글 이름으로 칸의 뜻을 찾는다.
 *
 * 같은 뜻이 두 칸에 잡히면 **먼저 나온 칸**을 쓴다 —
 * 「요구사항명」과 「요구사항」이 함께 있으면 앞쪽이 이름일 확률이 높다.
 */
export function mapColumns(header: readonly string[]): Map<ColumnRole, number> {
  const map = new Map<ColumnRole, number>()
  for (let c = 0; c < header.length; c++) {
    const n = normalizeHeader(header[c])
    if (!n) continue
    for (const rule of HEADER_RULES) {
      if (map.has(rule.role)) continue
      if (rule.keywords.some((kw) => n.includes(normalizeHeader(kw)))) {
        map.set(rule.role, c)
        break
      }
    }
  }
  return map
}

/** 표를 행 배열로 편다 */
function toGrid(table: IrTable): string[][] {
  const grid: string[][] = Array.from({ length: table.rows }, () => Array.from({ length: table.cols }, () => ''))
  for (const cell of table.cells) {
    if (cell.r < table.rows && cell.c < table.cols) grid[cell.r][cell.c] = cell.text.trim()
  }
  return grid
}

/**
 * 머리글이 몇 번째 줄인가.
 *
 * 총괄표는 첫 줄이 「요구사항 총괄표」 같은 제목인 경우가 흔하다.
 * 칸 뜻이 가장 많이 잡히는 줄을 머리글로 본다 — 무조건 0번째로 두면 한 줄씩 밀린다.
 */
export function findHeaderRow(grid: readonly string[][]): number {
  let best = -1
  let bestScore = 0
  for (let r = 0; r < Math.min(grid.length, MAX_HEADER_SEARCH_ROWS); r++) {
    const score = mapColumns(grid[r]).size
    if (score > bestScore) { bestScore = score; best = r }
  }
  // 최소한 코드나 이름 칸은 잡혀야 머리글이다
  return bestScore >= 2 ? best : -1
}

const MAX_HEADER_SEARCH_ROWS = 5

export interface ExtractResult {
  requirements: Requirement[]
  /** 요구사항표로 본 표의 ID */
  tableIds: string[]
}

/**
 * 문서의 표들에서 요구사항을 뽑는다.
 *
 * 코드가 없는 행은 버린다 — 표의 소제목 줄이나 합계 줄이 요구사항으로 섞이면
 * 「요구사항 몇 건」이 부풀고, 그 숫자로 적합도를 계산하면 조용히 틀린다.
 */
export function extractRequirements(doc: IrDocument): ExtractResult {
  const requirements: Requirement[] = []
  const tableIds: string[] = []

  for (const table of doc.tables) {
    const grid = toGrid(table)
    if (grid.length < 2) continue

    const headerRow = findHeaderRow(grid)
    const columns = headerRow >= 0 ? mapColumns(grid[headerRow]) : new Map<ColumnRole, number>()
    const header = headerRow >= 0 ? grid[headerRow] : []
    const startRow = headerRow >= 0 ? headerRow + 1 : 0

    const found: Requirement[] = []
    for (let r = startRow; r < grid.length; r++) {
      const req = rowToRequirement(grid[r], header, columns, table, r)
      if (req) found.push(req)
    }

    if (found.length === 0) continue
    tableIds.push(table.tableId)
    requirements.push(...found)
  }

  return { requirements, tableIds: Array.from(new Set(tableIds)) }
}

function rowToRequirement(
  row: readonly string[],
  header: readonly string[],
  columns: Map<ColumnRole, number>,
  table: IrTable,
  rowNo: number,
): Requirement | null {
  const codeCol = columns.get('code')
  // 머리글을 못 찾았으면 어느 칸에든 코드가 있으면 그 칸을 코드로 본다
  const codeCell = codeCol !== undefined ? row[codeCol] : row.find((c) => CODE_RE.test(c.toUpperCase()))
  const parsed = codeCell ? parseCode(codeCell) : null
  if (!parsed) return null

  const titleCol = columns.get('title')
  const descCol = columns.get('description')
  const kindCol = columns.get('kind')

  const title = pick(row, titleCol) || firstLongText(row, [codeCol, descCol])
  const description = pick(row, descCol)

  const extra: Record<string, string> = {}
  const used = new Set([codeCol, titleCol, descCol, kindCol].filter((n): n is number => n !== undefined))
  for (let c = 0; c < row.length; c++) {
    if (used.has(c) || !row[c]) continue
    const key = header[c]?.trim() || `col${c}`
    extra[key] = row[c]
  }

  return {
    code: parsed.code,
    // 표에 적힌 분류가 있으면 그것을 먼저 믿는다. 코드 접두어는 공고마다 흔들린다
    kind: kindFromLabel(pick(row, kindCol)) ?? parsed.kind,
    title,
    description,
    blockId: table.blockId,
    tableId: table.tableId,
    rowNo,
    extra,
  }
}

function pick(row: readonly string[], col: number | undefined): string {
  return col !== undefined ? (row[col] ?? '').trim() : ''
}

/** 이름 칸을 못 찾았을 때 가장 그럴듯한 글자를 고른다 */
function firstLongText(row: readonly string[], skip: (number | undefined)[]): string {
  const skipSet = new Set(skip.filter((n): n is number => n !== undefined))
  for (let c = 0; c < row.length; c++) {
    if (skipSet.has(c)) continue
    const v = row[c].trim()
    if (v && !CODE_RE.test(v.toUpperCase())) return v
  }
  return ''
}

const KIND_LABEL: Record<string, RequirementKind> = {
  기능: 'functional', 성능: 'performance', 인터페이스: 'interface',
  데이터: 'data', 테스트: 'test', 보안: 'security', 품질: 'quality',
  제약: 'constraint', 제약사항: 'constraint',
  프로젝트관리: 'management', 프로젝트지원: 'support', 시스템: 'system', 시스템장비구성: 'system',
}

function kindFromLabel(label: string): RequirementKind | null {
  if (!label) return null
  const n = label.replace(/[\s요구사항]/g, '')
  return KIND_LABEL[n] ?? null
}

/**
 * 코드가 겹치면 하나로 접는다.
 *
 * 총괄표가 본문과 별첨에 두 번 실리는 일이 흔하다. 그대로 두면 「요구사항 120건」이
 * 실제로는 60건이고, 그 숫자로 계산한 적합도가 절반이 된다.
 * 내용이 긴 쪽을 남긴다 — 별첨이 더 자세한 것이 보통이다.
 */
export function dedupeRequirements(list: readonly Requirement[]): Requirement[] {
  const byCode = new Map<string, Requirement>()
  for (const r of list) {
    const prev = byCode.get(r.code)
    if (!prev || weight(r) > weight(prev)) byCode.set(r.code, r)
  }
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code))
}

function weight(r: Requirement): number {
  return r.title.length + r.description.length
}

/** 요구사항 묶음의 지문 — 정정공고에서 무엇이 바뀌었나 비교할 때 쓴다 */
export function requirementsHash(list: readonly Requirement[]): string {
  const canon = dedupeRequirements(list)
    .map((r) => `${r.code}|${r.title}|${r.description}`)
    .join('\n')
  return textHash(canon)
}

/** 종류별 건수 — 화면이 그대로 그린다 */
export function countByKind(list: readonly Requirement[]): Record<RequirementKind, number> {
  const out = {} as Record<RequirementKind, number>
  for (const r of list) out[r.kind] = (out[r.kind] ?? 0) + 1
  return out
}

export type { IrTableCell }
