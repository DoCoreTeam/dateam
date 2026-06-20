// USAI Stage 2 보조 — 좌표격자 → AI 입력용 압축 직렬화.
// SheetCompressor 아이디어: 비어있지 않은 셀만 `addr=value`로 직렬화(이미 sparse) + 병합/시트메타 보존,
// 거대 시트는 셀 수 캡으로 토큰 폭주 방지(잘림은 명시 — 무음 손실 금지).
import type { SheetGrid } from './intake-grid.ts'

export interface CompressOptions {
  /** 전체 직렬화 셀 상한(토큰 예산). 초과분은 잘림 표기. */
  maxCells?: number
  /** 셀 값 표시 최대 길이 */
  maxValueLen?: number
}

export interface CompressResult {
  text: string
  cellsIncluded: number
  cellsTotal: number
  truncated: boolean
}

const DEFAULT_MAX_CELLS = 1500
const DEFAULT_MAX_VALUE_LEN = 60

/** SheetGrid[] → AI 프롬프트용 압축 텍스트. 좌표·병합·시트가시성 보존. */
export function compressGrids(grids: SheetGrid[], opts: CompressOptions = {}): CompressResult {
  const maxCells = opts.maxCells ?? DEFAULT_MAX_CELLS
  const maxValueLen = opts.maxValueLen ?? DEFAULT_MAX_VALUE_LEN

  const cellsTotal = grids.reduce((s, g) => s + g.cells.length, 0)
  let budget = maxCells
  let included = 0
  const parts: string[] = []

  for (const g of grids) {
    if (budget <= 0) break
    const vis = g.hidden ? 'hidden' : 'visible'
    const header = `## Sheet: ${g.sheet} (${vis})`
    const mergeLine = g.merges.length > 0 ? `merges: ${g.merges.join(', ')}` : 'merges: none'

    const take = g.cells.slice(0, budget)
    budget -= take.length
    included += take.length

    const cellLines = take
      .map((c) => `${c.addr}=${c.value.length > maxValueLen ? c.value.slice(0, maxValueLen) + '…' : c.value}`)
      .join(' | ')

    parts.push([header, mergeLine, cellLines].join('\n'))
  }

  const truncated = included < cellsTotal
  if (truncated) parts.push(`[!] 잘림: ${cellsTotal - included}개 셀 미포함(상한 ${maxCells}). 핵심 표가 잘렸으면 분할 처리 필요.`)

  return { text: parts.join('\n\n'), cellsIncluded: included, cellsTotal, truncated }
}
