/**
 * 문서(IR) → **표가 살아 있는 글**
 *
 * ## 왜 평문으로 뭉개면 안 되나
 *
 * 견적서는 거의 전부 표다. 그런데 파서가 주는 `IrBlock.text` 는 셀을 공백으로 이어 붙인
 * 한 줄이라, 「H100 SXM  2  50,000,000  100,000,000」이 된다.
 * 이걸 그대로 모델에 주면 **어느 숫자가 수량이고 어느 숫자가 단가인지 셀 수가 없다** —
 * 실제로 이 자리에서 수량과 단가가 뒤집히면 견적이 2500만 배 틀린다.
 *
 * 셀 경계는 `IrTable.cells` 에만 남아 있다. 그래서 여기서 블록과 표를 다시 붙여
 * 행마다 `A | B | C` 로 편다. 사람이 읽을 수 있는 모양이면 모델도 읽는다.
 *
 * ## 머리말·꼬리말을 뺀다
 *
 * 쪽마다 반복되는 줄이다. 남겨 두면 스무 쪽짜리 견적서에서 「주식회사 ○○」가
 * 스무 번 나오고, 그중 하나가 **항목 줄로 읽힌다.** 표에 없는 유령 줄이 생기는 것보다
 * 반복되는 회사 이름을 잃는 편이 낫다 — 회사 이름은 우리 설정에 이미 있다.
 *
 * ## 자를 때는 잘랐다고 말한다
 *
 * 조용히 버리면 화면이 「항목 12건을 읽었습니다」라고 말하는데 원문에는 30건이 있다.
 * 사람은 그 12건을 전부로 믿고 저장한다.
 */

import type { IrDocument, IrTable, IrBlock } from '../../rfp/ir/types.ts'

/**
 * 모델에 넘길 글자 수 상한.
 *
 * 견적서 한 장은 보통 2천 자 안쪽이고, 부속명세까지 붙은 것이 1만 자 남짓이다.
 * 이보다 길면 견적서가 아니라 제안서일 확률이 높고, 그때는 앞쪽(항목표가 있는 자리)만
 * 봐도 된다.
 */
export const MAX_SOURCE_CHARS = 12_000

/** 쪽마다 반복돼 항목으로 읽히면 안 되는 블록 */
const SKIP_TYPES = new Set<IrBlock['type']>(['header', 'footer'])

export interface SourceTextResult {
  text: string
  /** 상한에 걸려 뒤를 잘랐나 */
  truncated: boolean
  /** 표를 몇 개 폈나. 0 이면 견적서를 표로 못 읽은 것이라 화면이 그 사실을 말해야 한다 */
  tableCount: number
}

/**
 * 표 하나를 행마다 한 줄로 편다.
 *
 * 병합 셀은 **왼쪽 위 칸에만** 글자를 두고 나머지는 비운다. 칸마다 복사하면
 * 「소계」가 네 번 나와 항목 네 개로 읽힌다.
 */
export function tableToLines(table: IrTable): string[] {
  const rows = Math.max(0, table.rows)
  const cols = Math.max(0, table.cols)
  if (rows === 0 || cols === 0) return []

  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
  for (const cell of table.cells) {
    if (cell.r < 0 || cell.r >= rows || cell.c < 0 || cell.c >= cols) continue
    grid[cell.r][cell.c] = (cell.text ?? '').replace(/\s+/g, ' ').trim()
  }

  return grid
    .map((row) => row.join(' | ').trim())
    // 전부 빈 행은 버린다 — 「 |  | 」는 읽는 쪽에 아무 뜻도 주지 않는다
    .filter((line) => line.replace(/[|\s]/g, '').length > 0)
}

/** 블록 하나를 글로. 표는 여러 줄이 될 수 있다 */
function blockToLines(
  block: IrBlock,
  tableOf: Map<string, IrTable>,
  figureTextOf: Map<string, string>,
): string[] {
  const text = (block.text ?? '').trim()

  if (block.type === 'table') {
    const table = tableOf.get(block.blockId)
    const lines = table ? tableToLines(table) : []
    // 셀을 못 찾으면 평문이라도 남긴다. 버리면 그 표는 없던 것이 된다
    if (lines.length > 0) return lines
    return text ? [text] : []
  }

  if (block.type === 'figure') {
    // 그림 안에서 뽑은 글자. 그림 자체는 이 경로로 못 보낸다
    const extracted = (figureTextOf.get(block.blockId) ?? '').trim()
    return extracted ? [extracted] : (text ? [text] : [])
  }

  if (!text) return []
  if (block.type === 'heading') return [`## ${text}`]
  if (block.type === 'list_item') return [`- ${text}`]
  return [text]
}

/**
 * 문서를 모델이 읽을 글로 옮긴다.
 *
 * 순서는 `orderNo` 다. 파서마다 blocks 배열의 순서가 보장되지 않아,
 * 정렬하지 않으면 **합계가 항목보다 먼저 나오는** 글이 만들어진다.
 */
export function irToSourceText(
  doc: IrDocument,
  opts: { maxChars?: number } = {},
): SourceTextResult {
  const maxChars = opts.maxChars ?? MAX_SOURCE_CHARS
  const tableOf = new Map(doc.tables.map((t) => [t.blockId, t]))
  const figureTextOf = new Map(
    doc.figures
      .filter((f) => (f.extractedText ?? '').trim())
      .map((f) => [f.blockId, f.extractedText as string]),
  )

  const ordered = [...doc.blocks]
    .filter((b) => !SKIP_TYPES.has(b.type))
    .sort((a, b) => a.orderNo - b.orderNo)

  const lines: string[] = []
  let tableCount = 0
  for (const block of ordered) {
    const made = blockToLines(block, tableOf, figureTextOf)
    if (made.length === 0) continue
    if (block.type === 'table' && tableOf.has(block.blockId)) tableCount += 1
    lines.push(...made)
  }

  // 상한은 **줄 경계에서** 끊는다. 글자 수로 자르면 마지막 줄이 반쪽 표가 되어,
  // 모델이 그 반쪽을 온전한 항목으로 읽는다
  let total = 0
  const kept: string[] = []
  let truncated = false
  for (const line of lines) {
    const next = total + line.length + 1
    if (next > maxChars) { truncated = true; break }
    kept.push(line)
    total = next
  }

  return { text: kept.join('\n'), truncated, tableCount }
}
