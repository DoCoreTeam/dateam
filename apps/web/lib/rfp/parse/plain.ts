/**
 * 글자 파일을 IR 로 (txt·csv·md·html)
 *
 * ## 표도 표로 읽는다
 *
 * 문단만 만들던 때는 마크다운 표가 글줄로 갔다 — `| --- |` 구분줄까지 그대로.
 * 견적서를 마크다운으로 올리면 화면이 「표를 찾지 못해 글줄만 읽었어요」라고 말했고,
 * 그 말은 사실이었다(실측 2026-09-20: md·csv 의 tableCount 가 0).
 * 이제 세로줄 표를 찾아 표 블록으로 만든다. 격자를 표의 모양으로 바꾸는 일은
 * `table-grid` 한 곳이 한다 — 오피스 파서와 같은 것을 쓴다.
 *
 * ## 왜 뒤늦게 생겼나
 *
 * 종류 판정은 `text` 라고 하는데 그 종류를 읽는 파서가 **없었다.**
 * `ROUTES` 는 text 를 officeparser 로 보냈지만 officeparser 는 평문을 모른다 —
 * 그래서 `unsupported_format:format=unknown` 으로 죽었다. 판정과 처리가 어긋난 것이다.
 * (실측 2026-09-09: 시험용 공고문 txt 가 파싱 3회 재시도 후 dead)
 *
 * ## 인코딩
 *
 * 공공기관 파일은 아직 EUC-KR 이 섞여 있다. UTF-8 로 읽어 깨지면 EUC-KR 로 한 번 더 본다 —
 * 깨진 채로 넘기면 뒷단계가 전부 「글자가 이상한 문서」를 분석한다.
 */

import { makeBlock, makeDocument, qualityScore, textHash } from '../ir/build.ts'
import type { IrBlock, IrDocument, IrTable } from '../ir/types.ts'
import { gridCols, gridToCells, gridToHtml, gridToText } from './table-grid.ts'

export type PlainRejectReason = 'empty' | 'undecodable'

export type PlainParseResult =
  | { ok: true; doc: IrDocument }
  | { ok: false; reason: PlainRejectReason; detail: string }

export const PARSER_NAME = 'plain'
export const PARSER_VERSION = '1'

/** 이 비율보다 깨진 글자가 많으면 다른 인코딩으로 본다 */
export const REPLACEMENT_RATIO = 0.01

/**
 * 바이트를 글자로.
 *
 * UTF-8 이 기본이고, 대체 문자(U+FFFD)가 눈에 띄게 많으면 EUC-KR 로 다시 읽는다.
 * 「조금 깨진 것」과 「인코딩이 다른 것」은 대체 문자 비율로 갈린다.
 */
export function decodeText(bytes: Uint8Array): string | null {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (replacementRatio(utf8) <= REPLACEMENT_RATIO) return utf8

  try {
    const euc = new TextDecoder('euc-kr').decode(bytes)
    // 둘 다 깨졌으면 덜 깨진 쪽을 준다 — 아무것도 안 주는 것보다 낫다
    return replacementRatio(euc) < replacementRatio(utf8) ? euc : utf8
  } catch {
    return utf8
  }
}

function replacementRatio(s: string): number {
  if (s.length === 0) return 0
  let n = 0
  for (const ch of s) if (ch === '�') n += 1
  return n / s.length
}

/** HTML 이면 태그를 벗긴다 — 태그를 그대로 두면 블록마다 마크업이 근거로 남는다 */
export function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
}

/** 빈 줄로 문단을 나눈다. 문단이 없으면 줄 단위로 — 한 덩이로 두면 근거를 못 가리킨다 */
export function toParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const byBlank = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (byBlank.length > 1) return byBlank
  return normalized.split('\n').map((p) => p.trim()).filter(Boolean)
}

/*
  ── 세로줄 표 ─────────────────────────────────────────────

  마크다운(GFM) 표는 **구분줄로 판정한다.** 세로줄만으로 세면 「3 | 4호기」 같은 평범한 글이
  표가 되고, 그렇게 만들어진 가짜 표는 읽는 쪽에서 되돌릴 방법이 없다.
  구분줄(`| --- | --- |`)은 사람이 표를 그리려고 일부러 적은 것이라 오해가 거의 없다.
*/

/** 구분줄인가 — `|---|:--:|` 처럼 줄표와 콜론만 있는 줄 */
export function isSeparatorLine(line: string): boolean {
  const t = line.trim()
  if (!t.includes('-')) return false
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(t)
}

/**
 * 한 줄을 셀로. `\|` 는 셀 **안의** 세로줄이라 자르지 않는다.
 *
 * 바깥 세로줄이 있으면 그 때문에 생기는 빈 셀은 버린다 — `| a | b |` 는 두 칸이지 네 칸이 아니다.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue }
    if (ch === '|') { cells.push(cur); cur = ''; continue }
    cur += ch
  }
  cells.push(cur)
  const trimmed = line.trim()
  if (trimmed.startsWith('|')) cells.shift()
  if (trimmed.endsWith('|') && cells.length > 0) cells.pop()
  return cells.map((c) => c.trim())
}

export interface PlainPart {
  kind: 'paragraph' | 'table'
  /** kind 가 paragraph 일 때 */
  text?: string
  /** kind 가 table 일 때 — 이미 펴진 격자 */
  grid?: string[][]
}

/** 코드 울타리(``` 또는 ~~~) 안인가 — 그 안의 세로줄은 예제이지 표가 아니다 */
function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line)
}

/**
 * 글을 **문단과 표로** 가른다. 표가 하나도 없으면 예전과 똑같이 문단만 나온다
 * (그래야 지금까지 읽던 문서의 결과가 안 바뀐다).
 */
export function toParts(text: string): PlainPart[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const parts: PlainPart[] = []
  let buffer: string[] = []
  let inFence = false

  const flushText = () => {
    const joined = buffer.join('\n')
    buffer = []
    for (const p of toParagraphs(joined)) parts.push({ kind: 'paragraph', text: p })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isFence(line)) { inFence = !inFence; buffer.push(line); continue }

    const head = line.includes('|') && line.trim() !== ''
    const sep = !inFence && head && i + 1 < lines.length && isSeparatorLine(lines[i + 1])
    if (!sep) { buffer.push(line); continue }

    const header = splitRow(line)
    // 한 칸짜리는 표로 보지 않는다 — 「---」 하나 밑의 목록을 표로 만들면 열이 없다
    if (header.length < 2) { buffer.push(line); continue }

    const grid: string[][] = [header]
    let j = i + 2
    for (; j < lines.length; j++) {
      const row = lines[j]
      if (row.trim() === '' || !row.includes('|') || isFence(row)) break
      // 구분줄이 또 나오면 새 표의 머리다 — 여기서 끊는다
      if (isSeparatorLine(row)) break
      grid.push(splitRow(row))
    }

    flushText()
    parts.push({ kind: 'table', grid })
    i = j - 1
  }

  flushText()
  return parts
}

export interface PlainParseOptions {
  fileId: string
  fileName?: string
  fileRole?: string
}

export function parsePlain(bytes: Uint8Array, opts: PlainParseOptions): PlainParseResult {
  const raw = decodeText(bytes)
  if (raw === null) return { ok: false, reason: 'undecodable', detail: '' }

  const isHtml = /\.(html?|xhtml)$/i.test(opts.fileName ?? '') || /<html[\s>]|<body[\s>]/i.test(raw.slice(0, 2000))
  const text = isHtml ? stripHtml(raw) : raw

  const parts = toParts(text)
  if (parts.length === 0) return { ok: false, reason: 'empty', detail: '읽을 글자가 없다' }

  const blocks: IrBlock[] = []
  const tables: IrTable[] = []
  parts.forEach((part, i) => {
    // 평문에는 쪽도 노드 경로도 없다. 몇 번째 덩이인지가 유일한 자리다
    const sourceRef = { kind: 'text' as const, paraIdx: i }
    if (part.kind === 'table' && part.grid) {
      const grid = part.grid
      const cols = gridCols(grid)
      const block = makeBlock(opts.fileId, i, {
        type: 'table',
        text: gridToText(grid),
        html: gridToHtml(grid, cols),
        sourceRef,
      })
      blocks.push(block)
      tables.push({
        tableId: textHash(`${opts.fileId}|tbl|${i}`).slice(0, 16),
        blockId: block.blockId,
        rows: grid.length,
        cols,
        cells: gridToCells(grid, cols),
        caption: null,
      })
      return
    }
    blocks.push(makeBlock(opts.fileId, i, { type: 'paragraph', text: part.text ?? '', sourceRef }))
  })

  const doc = makeDocument({
    meta: {
      fileRole: opts.fileRole ?? 'etc',
      format: isHtml ? 'html' : 'text',
      pageCount: 0,
      parser: PARSER_NAME,
      parserVersion: PARSER_VERSION,
      // 평문은 글자를 100% 건진다. 좌표가 없는 것은 형식의 성질이지 파싱 실패가 아니다
      qualityScore: qualityScore({
        textPageRatio: 1,
        // 표를 알아봤으면 점수에 실린다 — 0 으로 굳혀 두면 표가 있는 문서도 「표 없음」으로 남는다
        tableCount: tables.length,
        avgOcrConfidence: null,
        sectionDepth: 1,
        warningCount: 0,
      }),
      warnings: [],
    },
    pages: [],
    sections: [],
    blocks,
    tables,
    figures: [],
  })

  return { ok: true, doc }
}
