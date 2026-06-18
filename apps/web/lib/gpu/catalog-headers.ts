// 카탈로그 시트 헤더행 탐지 + AoA→레코드 조립 (순수 로직 SSOT, 의존성 없음 — 단위테스트 용이).
// catalog-parse.ts가 XLSX로 AoA를 만든 뒤 이 모듈로 헤더 탐지·정형화한다.

/**
 * 헤더행 탐지: 앞쪽 SCAN_ROWS 내에서 "비어있지 않은 셀 수 + 문자열(라벨다움) 가중"이 가장 높은 행.
 * 실무 엑셀의 제목/환율/소계 같은 sparse 상단 행을 건너뛴다. 모두 빈약하면 0행 폴백.
 */
export function detectHeaderRow(aoa: unknown[][]): number {
  const SCAN_ROWS = Math.min(25, aoa.length)
  let bestIdx = 0
  let bestScore = -1
  for (let i = 0; i < SCAN_ROWS; i++) {
    const row = aoa[i] ?? []
    let nonEmpty = 0
    let stringy = 0
    for (const c of row) {
      if (c == null || String(c).trim() === '') continue
      nonEmpty++
      if (typeof c === 'string' && !/^-?\d[\d,.\s]*$/.test(c.trim())) stringy++
    }
    if (nonEmpty < 2) continue
    const score = nonEmpty + stringy * 1.5
    if (score > bestScore) { bestScore = score; bestIdx = i }
  }
  return bestIdx
}

export interface AssembledRows {
  headers: string[]
  rows: Record<string, unknown>[]
  totalRows: number
}

/**
 * AoA + 탐지된 헤더 인덱스 → {headers, rows}. 빈 헤더 셀은 col{i}, 중복 라벨은 접미사로 구분.
 * @param sanitize 문자열 셀 변환(수식 인젝션 무력화 등). 숫자/불리언엔 미적용.
 * @param maxRows 데이터 행 상한.
 */
export function assembleFromAoa(
  aoa: unknown[][],
  headerIdx: number,
  sanitize: (v: string) => string,
  maxRows: number,
): AssembledRows {
  const headerRow = aoa[headerIdx] ?? []
  const seen = new Map<string, number>()
  const headers: string[] = headerRow.map((c, i) => {
    const trimmed = c == null ? '' : String(c).replace(/\s+/g, ' ').trim()
    // 헤더는 객체 키이자 컬럼 매핑(catalog-map) 기준 — sanitize로 변형하면 키가 깨진다. 라벨은 정형화만.
    let label = trimmed || `col${i + 1}`
    const n = seen.get(label) ?? 0
    seen.set(label, n + 1)
    if (n > 0) label = `${label}_${n}`
    return label
  })

  const dataRows = aoa.slice(headerIdx + 1)
  const totalRows = dataRows.length
  const limited = dataRows.slice(0, maxRows)
  const rows = limited.map((arr) => {
    const o: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      const v = (arr as unknown[])[i] ?? null
      o[h] = typeof v === 'string' ? sanitize(v) : v
    })
    return o
  })
  return { headers, rows, totalRows }
}
