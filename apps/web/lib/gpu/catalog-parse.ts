// 카탈로그 파일(xlsx/csv) 파싱 — 헤더 + 전체 행 + 샘플 추출. (서버 전용: xlsx lib 사용)
// AI는 헤더+샘플로 매핑만 1회 판단, 코드(catalog-map.applyMapping)가 전체 행을 결정적으로 변환한다.
// 보안: 모든 셀 값 문자열은 sanitizeCell(수식 인젝션 무력화, SSOT) 적용.
import * as XLSX from 'xlsx'
import { sanitizeCell } from './csv-intake'

// 런어웨이 방지 상한 — 한 파일에서 처리할 최대 행 수.
export const MAX_CATALOG_ROWS = 1000
const SAMPLE_SIZE = 8
// zip-bomb/자원고갈 방어 — 시트 수·셀 수 사전 상한(sheet_to_json 폭주 차단).
const MAX_SHEETS = 10
const MAX_CELLS = 200_000

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

/** 셀 값 정규화: 문자열이면 수식 인젝션 무력화, 그 외(숫자·불리언)는 원형 보존. */
function safeCell(v: unknown): unknown {
  return typeof v === 'string' ? sanitizeCell(v) : v
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
  // 셀 폭주(zip-bomb) 사전 차단 — sheet_to_json 호출 전 범위로 셀 수 추정.
  const ref = ws['!ref']
  if (ref) {
    const range = XLSX.utils.decode_range(ref)
    const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
    if (cells > MAX_CELLS) throw new Error(`표가 너무 큽니다(셀 ${cells.toLocaleString()} > ${MAX_CELLS.toLocaleString()})`)
  }

  // defval:null → 빈 셀도 키 유지(컬럼 정렬 안정). raw 유지(숫자/불리언 타입 보존).
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
  const totalRows = raw.length
  const limited = raw.slice(0, MAX_CATALOG_ROWS)

  const headerSet = new Set<string>()
  for (const r of limited) for (const k of Object.keys(r)) if (k.trim()) headerSet.add(k)
  const headers = Array.from(headerSet)

  const rows = limited.map((r) => {
    const o: Record<string, unknown> = {}
    for (const h of headers) o[h] = safeCell(r[h])
    return o
  })

  return {
    headers,
    rows,
    sample: rows.slice(0, SAMPLE_SIZE),
    totalRows,
    truncated: totalRows > MAX_CATALOG_ROWS,
  }
}
