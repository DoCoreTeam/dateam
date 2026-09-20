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
 * ## 쪽을 버리지 않는다
 *
 * 파서는 블록마다 몇 쪽인지 알고 있다. 그런데 글로 펴면서 그 값을 버리면
 * 읽은 뒤에 **어느 쪽에서 왔는지 되찾을 길이 없다.** 한 파일에 견적이 두 건이면
 * 그 둘은 각자 다른 쪽에 있는데, 쪽을 모르니 견적마다 원본 조각을 붙일 수도,
 * 대조 화면을 그 쪽에서 열 수도 없다(실측 2026-09-20: 두 건짜리 PDF 에서
 * 사람이 원본을 열어 자기 건을 찾고 있었다).
 *
 * 그래서 쪽이 바뀌는 자리에 표시 줄을 한 줄 넣는다. **쪽이 하나뿐인 문서에는 안 넣는다** -
 * 넣어 봐야 모든 줄이 같은 쪽이고, 글자만 먹는다. 그때는 `pages` 로 그 한 쪽을 알려 준다.
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

/**
 * 쪽이 바뀌는 자리에 넣는 표시 줄.
 *
 * 모델은 이 줄을 **그대로 옮겨 적기만** 하면 된다. 세거나 더하지 않으므로
 * 쪽 번호를 지어낼 여지가 거의 없다.
 */
export function pageMarkLine(pageNo: number): string {
  return `--- ${pageNo}쪽 ---`
}

/** 표시 줄에서 쪽 번호를 되읽는다. 표시 줄이 아니면 null */
export function pageOfMarkLine(line: string): number | null {
  const m = /^---\s*(\d+)쪽\s*---$/.exec(line.trim())
  return m ? Number(m[1]) : null
}

export interface SourceTextResult {
  text: string
  /** 상한에 걸려 뒤를 잘랐나 */
  truncated: boolean
  /** 표를 몇 개 폈나. 0 이면 견적서를 표로 못 읽은 것이라 화면이 그 사실을 말해야 한다 */
  tableCount: number
  /**
   * 글에 실제로 들어간 쪽 번호들(오름차순, 중복 없음).
   *
   * 잘려 나간 쪽은 안 들어간다 - 안 넘긴 쪽을 「읽었다」고 세면 그 쪽에 있다는
   * 견적이 실제로는 안 읽힌 채 조각만 붙는다. 쪽을 모르는 파서(평문·한글)면 빈 배열이다.
   */
  pages: number[]
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

  /*
    표시 줄을 넣을지 **먼저** 정한다. 쪽이 하나뿐인 문서에 넣으면 모든 줄이 같은 쪽이라
    아무것도 안 알려 주면서 글자만 먹는다. 쪽을 아예 모르는 파서(평문·한글)도 마찬가지다.
  */
  const knownPages = new Set(
    ordered.map((b) => b.pageNo).filter((p): p is number => typeof p === 'number'),
  )
  const marks = knownPages.size > 1

  /** 줄마다 어느 쪽인지 달고 간다 - 잘린 뒤에 「남은 쪽」을 세려면 줄에 붙어 있어야 한다 */
  const entries: { text: string; page: number | null }[] = []
  let tableCount = 0
  let lastPage: number | null = null
  for (const block of ordered) {
    const made = blockToLines(block, tableOf, figureTextOf)
    if (made.length === 0) continue
    if (block.type === 'table' && tableOf.has(block.blockId)) tableCount += 1

    const page = typeof block.pageNo === 'number' ? block.pageNo : null
    if (marks && page !== null && page !== lastPage) {
      entries.push({ text: pageMarkLine(page), page })
    }
    if (page !== null) lastPage = page
    // 쪽을 모르는 블록은 **앞 줄의 쪽을 물려받는다**. 쪽 하나가 비었다고 그 아래가
    // 통째로 「쪽 모름」이 되면, 표 한가운데서 근거가 끊긴다
    for (const line of made) entries.push({ text: line, page: page ?? lastPage })
  }

  // 상한은 **줄 경계에서** 끊는다. 글자 수로 자르면 마지막 줄이 반쪽 표가 되어,
  // 모델이 그 반쪽을 온전한 항목으로 읽는다
  let total = 0
  const kept: { text: string; page: number | null }[] = []
  let truncated = false
  for (const entry of entries) {
    const next = total + entry.text.length + 1
    if (next > maxChars) { truncated = true; break }
    kept.push(entry)
    total = next
  }

  const pages = [...new Set(
    kept.map((e) => e.page).filter((p): p is number => typeof p === 'number'),
  )].sort((a, b) => a - b)

  return { text: kept.map((e) => e.text).join('\n'), truncated, tableCount, pages }
}
