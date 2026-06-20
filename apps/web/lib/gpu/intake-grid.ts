// USAI Stage 1 — 표현(Represent): 임의 스프레드시트 → 좌표보존 격자. (서버 전용: xlsx lib)
// 구조 가정 0 — 단일 헤더/평면표로 강제하지 않는다. 전 시트·병합셀을 좌표 그대로 보존해
// 다음 단계(AI 구조발견)가 "어디가 표/명부/헤더인지"를 좌표로 판단할 수 있게 한다.
// 보안: 모든 셀 문자열은 sanitizeCell(수식 인젝션 무력화 SSOT) 적용.
import * as XLSX from 'xlsx'
import { sanitizeCell } from './csv-intake.ts'

export interface GridCell {
  /** A1 표기 셀 주소 (provenance 토대) */
  addr: string
  /** 0-base 행 */
  r: number
  /** 0-base 열 */
  c: number
  /** sanitize된 셀 값(문자열화). 숫자도 원시 정밀도 문자열로 보존. */
  value: string
}

export interface SheetGrid {
  sheet: string
  hidden: boolean
  cells: GridCell[]
  /** 병합 범위 A1 표기(예: "B5:B13") */
  merges: string[]
  maxR: number
  maxC: number
}

// 자원고갈 방어 — 거부하지 않고 "실제로 읽는" 범위만 클램프(사용자 정책: 파일 크기 제약 X).
const MAX_SHEETS = 12
const MAX_ROWS_READ = 2000
const MAX_COLS_READ = 256

/** ArrayBuffer(xlsx/csv) → 전 시트 좌표격자. 빈 셀은 제외, 병합·은닉 시트 메타 보존. */
export function bufferToGrids(buf: ArrayBuffer): SheetGrid[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellNF: false, cellText: false })
  const names = wb.SheetNames.slice(0, MAX_SHEETS)
  const grids: SheetGrid[] = []

  for (const name of names) {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) continue

    const range = XLSX.utils.decode_range(ws['!ref'])
    const endR = Math.min(range.e.r, range.s.r + MAX_ROWS_READ)
    const endC = Math.min(range.e.c, range.s.c + MAX_COLS_READ)

    const cells: GridCell[] = []
    let maxR = range.s.r
    let maxC = range.s.c
    for (let r = range.s.r; r <= endR; r++) {
      for (let c = range.s.c; c <= endC; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (!cell || cell.v == null) continue
        const raw = typeof cell.v === 'string' ? cell.v : String(cell.v)
        const value = sanitizeCell(raw.trim())
        if (value === '') continue
        cells.push({ addr, r, c, value })
        if (r > maxR) maxR = r
        if (c > maxC) maxC = c
      }
    }

    const merges = (ws['!merges'] ?? []).map((m) => XLSX.utils.encode_range(m))
    const hidden = isSheetHidden(wb, name)
    grids.push({ sheet: name, hidden, cells, merges, maxR, maxC })
  }

  return grids
}

// 시트 은닉 여부 — wb.Workbook.Sheets[i].Hidden (0=visible, 1=hidden, 2=veryHidden).
function isSheetHidden(wb: XLSX.WorkBook, name: string): boolean {
  const meta = wb.Workbook?.Sheets
  if (!Array.isArray(meta)) return false
  const idx = wb.SheetNames.indexOf(name)
  const h = meta[idx]?.Hidden
  return typeof h === 'number' && h > 0
}

/** A1 범위("C6:G13") 안의 셀만 추린 SheetGrid 반환. 블록별 추출용 서브격자. */
export function subGrid(grids: SheetGrid[], sheet: string, bbox: string): SheetGrid | null {
  const g = grids.find((x) => x.sheet === sheet)
  if (!g) return null
  let range: XLSX.Range
  try { range = XLSX.utils.decode_range(bbox) } catch { return null }
  const cells = g.cells.filter(
    (c) => c.r >= range.s.r && c.r <= range.e.r && c.c >= range.s.c && c.c <= range.e.c,
  )
  return { ...g, cells, merges: g.merges.filter((m) => withinRange(m, range)) }
}

function withinRange(merge: string, range: XLSX.Range): boolean {
  try {
    const m = XLSX.utils.decode_range(merge)
    return m.s.r >= range.s.r && m.e.r <= range.e.r && m.s.c >= range.s.c && m.e.c <= range.e.c
  } catch { return false }
}
