// CSV/표 일괄 입력 — 파싱 + 헤더 자동 매핑 + 수식 인젝션 무력화
//
// 보안(필수): 스프레드시트 수식 인젝션(CSV injection) 방어.
//   셀 값이 = + - @ (또는 선행 탭/CR) 로 시작하면 앞에 작은따옴표(')를 붙여 수식 실행을 무력화.
//   (OWASP CSV Injection 권고. 우리 시스템은 엑셀 수식 인젝션 검사를 정책으로 둠.)
// 자기완결 모듈(외부 import 없음) — node:test 단위 테스트 대상.

export type CsvFieldKey =
  | 'model_name'
  | 'memory'
  | 'supplier'
  | 'unit_price_usd'
  | 'term'
  | 'min_qty'
  | 'valid_until'
  | 'quantity'

/** 헤더 별칭 → 표준 필드 키. 한국식/영문 혼용 헤더 자동 매핑. */
const HEADER_ALIASES: Record<string, CsvFieldKey> = {
  // model
  '모델': 'model_name', '모델명': 'model_name', 'gpu': 'model_name', 'model': 'model_name', 'model_name': 'model_name',
  // memory
  '메모리': 'memory', 'vram': 'memory', 'memory': 'memory',
  // supplier
  '공급사': 'supplier', '공급처': 'supplier', 'supplier': 'supplier', 'vendor': 'supplier',
  // price
  '단가': 'unit_price_usd', '공급원가': 'unit_price_usd', '가격': 'unit_price_usd', 'price': 'unit_price_usd', 'unit_price': 'unit_price_usd', 'unit_price_usd': 'unit_price_usd',
  // term
  '약정': 'term', 'term': 'term',
  // min qty
  '최소수량': 'min_qty', '최소': 'min_qty', 'min_qty': 'min_qty', 'moq': 'min_qty',
  // valid until
  '유효기간': 'valid_until', '만료': 'valid_until', '만료일': 'valid_until', 'valid_until': 'valid_until', 'expires': 'valid_until',
  // quantity (재고)
  '수량': 'quantity', '재고': 'quantity', 'quantity': 'quantity', 'qty': 'quantity', 'stock': 'quantity',
}

const FORMULA_PREFIXES = ['=', '+', '-', '@']

/** 수식 인젝션 무력화: 위험 선두 문자면 ' 를 앞에 붙임. 선행 공백/탭/CR/LF도 위험으로 취급. */
export function sanitizeCell(value: string): string {
  if (value.length === 0) return value
  // 선행 공백을 먼저 제거(공백 우회 차단)한 뒤 판정. 제어문자(탭/CR/LF)는 일부 스프레드시트가
  // 무시하고 뒤따르는 수식을 실행 → 그 자체를 위험으로 본다.
  const trimmed = value.replace(/^[  ]+/, '')
  const first = trimmed[0]
  if (first !== undefined && (FORMULA_PREFIXES.includes(first) || first === '\t' || first === '\r' || first === '\n')) {
    return `'${value}`
  }
  return value
}

/** RFC4180 유사 CSV 파서(따옴표·이스케이프·따옴표 내 개행 처리). 구분자는 콤마/탭 자동. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // 구분자 추정: 첫 줄에 탭이 콤마보다 많으면 탭.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ','

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === delim) { row.push(field); field = ''; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    if (c === '\r') { continue }
    field += c
  }
  // 마지막 필드/행 flush
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0))
}

export interface CsvIntakeResult {
  /** 컬럼 인덱스 → 표준 필드 키(매핑 실패는 undefined) */
  mapping: (CsvFieldKey | undefined)[]
  /** 매핑된 행: 표준 필드 키 → sanitize된 값 */
  rows: Partial<Record<CsvFieldKey, string>>[]
  /** 매핑되지 않은 헤더(사용자 확인용) */
  unmappedHeaders: string[]
}

/** CSV/표 텍스트 → 표준 필드 행. 모든 셀은 sanitizeCell 적용(수식 인젝션 방어). */
export function csvToIntakeRows(text: string): CsvIntakeResult {
  const grid = parseCsv(text)
  if (grid.length === 0) return { mapping: [], rows: [], unmappedHeaders: [] }

  const headerRow = grid[0]
  const mapping = headerRow.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? HEADER_ALIASES[h.trim()])
  const unmappedHeaders = headerRow.filter((_, i) => mapping[i] === undefined).map((h) => h.trim()).filter(Boolean)

  const rows = grid.slice(1).map((cells) => {
    const obj: Partial<Record<CsvFieldKey, string>> = {}
    cells.forEach((cell, i) => {
      const key = mapping[i]
      if (key) obj[key] = sanitizeCell(cell.trim())
    })
    return obj
  })

  return { mapping, rows, unmappedHeaders }
}
