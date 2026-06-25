// 카탈로그 파일(xlsx/csv) 파싱 — 헤더 + 전체 행 + 샘플 추출. (서버 전용: xlsx lib 사용)
// AI는 헤더+샘플로 매핑만 1회 판단, 코드(catalog-map.applyMapping)가 전체 행을 결정적으로 변환한다.
// 보안: 모든 셀 값 문자열은 sanitizeCell(수식 인젝션 무력화, SSOT) 적용.
import * as XLSX from 'xlsx'
import { sanitizeCell } from './csv-intake.ts'
import { detectHeaderRow, assembleFromAoa } from './catalog-headers.ts'

// 런어웨이 방지 상한 — 한 파일에서 처리할 최대 행 수.
export const MAX_CATALOG_ROWS = 1000
const SAMPLE_SIZE = 8
// zip-bomb/자원고갈 방어 — 시트 수 상한.
const MAX_SHEETS = 10
// 엑셀 phantom used-range(실데이터는 작은데 선언범위가 100만행 등) 대응 — 거부하지 않고 읽는 범위를 클램프.
// 사용자 정책: 파일 크기 제약 두지 않음. 대신 "실제로 읽는" 셀 수만 제한해 자원고갈만 방어.
const MAX_ROWS_READ = MAX_CATALOG_ROWS + 50   // 헤더+여유 포함 읽기 상한
const MAX_COLS_READ = 256                       // 정형 카탈로그 컬럼 상한(엑셀 기본 폭 수준)

export interface CatalogParseResult {
  headers: string[]
  /** 전체 데이터 행 (헤더 제외, 상한 적용). 셀 문자열은 sanitize됨. */
  rows: Record<string, unknown>[]
  /** AI 매핑용 상위 표본 (≤ SAMPLE_SIZE) */
  sample: Record<string, unknown>[]
  /** 원본 총 행수(상한 적용 전) — 잘림 안내용 */
  totalRows: number
  truncated: boolean
}

/**
 * xlsx/csv 버퍼 → 첫 시트의 헤더·행·샘플.
 * 단일 헤더행 정형표 가정(MVP). 빈 헤더 컬럼은 제외.
 */
export function parseCatalogBuffer(buf: ArrayBuffer): CatalogParseResult {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  if (wb.SheetNames.length > MAX_SHEETS) throw new Error(`시트가 너무 많습니다(최대 ${MAX_SHEETS}개)`)
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [], sample: [], totalRows: 0, truncated: false }
  const ws = wb.Sheets[sheetName]
  // phantom used-range 대응 — 거부하지 않고 실제 읽을 범위를 클램프(자원고갈만 방어).
  // 엑셀이 빈 행/서식으로 !ref를 100만행까지 부풀려도, 우리가 처리하는 건 앞쪽 데이터뿐이므로 그만큼만 읽는다.
  const ref = ws['!ref']
  if (ref) {
    const range = XLSX.utils.decode_range(ref)
    range.e.r = Math.min(range.e.r, range.s.r + MAX_ROWS_READ)
    range.e.c = Math.min(range.e.c, range.s.c + MAX_COLS_READ)
    ws['!ref'] = XLSX.utils.encode_range(range)
  }

  // 헤더행 자동탐지(SSOT: catalog-headers) — 실무 엑셀은 상단에 제목/환율/빈 행이 흔하다(1행=헤더 가정 금지).
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false })
  if (aoa.length === 0) return { headers: [], rows: [], sample: [], totalRows: 0, truncated: false }

  const headerIdx = detectHeaderRow(aoa)
  const { headers, rows, totalRows } = assembleFromAoa(aoa, headerIdx, sanitizeCell, MAX_CATALOG_ROWS)

  return {
    headers,
    rows,
    sample: rows.slice(0, SAMPLE_SIZE),
    totalRows,
    truncated: totalRows > MAX_CATALOG_ROWS,
  }
}
