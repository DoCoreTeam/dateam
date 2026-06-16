// 프로젝트 메타 필드 검증·정규화 SSOT — POST/PATCH 공용(복붙 금지).
// mig111의 CHECK 제약과 동일 규칙을 앱 레이어에서 선검증(친절한 에러 메시지 + DB 왕복 절감).
//  year 4자리 / quarter 1~4 / half H1|H2 / month 1~12 / 날짜 YYYY-MM-DD / budget ≥0 / status·currency 화이트리스트.

export const PROJECT_STATUS = ['active', 'planning', 'done', 'hold'] as const
export type ProjectStatus = (typeof PROJECT_STATUS)[number]
export const PROJECT_HALF = ['H1', 'H2'] as const
const CURRENCY_ALLOW = new Set(['KRW', 'USD', 'EUR', 'JPY', 'CNY'])

// GET 정렬 화이트리스트(SQL injection 방지 — 컬럼명 직접 보간 금지).
export const PROJECT_SORT_ALLOW = new Set(['created_at', 'name', 'updated_at', 'start_date', 'year'])

// GET list / 단건 조회 시 항상 함께 반환하는 컬럼(엔벨로프 일관).
export const PROJECT_SELECT =
  'id, name, year, quarter, half, month, start_date, end_date, budget, currency, status, created_at, updated_at'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ProjectMetaFields {
  year: number | null
  quarter: number | null
  half: string | null
  month: number | null
  start_date: string | null
  end_date: string | null
  budget: number | null
  currency: string
  status: ProjectStatus
}

type Partial = globalThis.Partial<ProjectMetaFields>

/**
 * raw 입력에서 메타 필드만 골라 검증·정규화한다.
 * - 키가 아예 없으면 결과에서도 생략(PATCH 부분 수정 지원). null이 명시되면 null로 둔다(값 해제).
 * - 잘못된 값은 error 문자열 반환(상위에서 400).
 */
export function parseProjectMeta(raw: Record<string, unknown>): { fields: Partial } | { error: string } {
  const out: Partial = {}

  if ('year' in raw && raw.year !== undefined) {
    const v = toIntOrNull(raw.year)
    if (v !== null && (v < 1900 || v > 9999)) return { error: '연도는 4자리(1900~9999)여야 합니다' }
    out.year = v
  }
  if ('quarter' in raw && raw.quarter !== undefined) {
    const v = toIntOrNull(raw.quarter)
    if (v !== null && (v < 1 || v > 4)) return { error: '분기는 1~4여야 합니다' }
    out.quarter = v
  }
  if ('half' in raw && raw.half !== undefined) {
    const v = toStrOrNull(raw.half)
    if (v !== null && !PROJECT_HALF.includes(v as (typeof PROJECT_HALF)[number])) return { error: '반기는 H1 또는 H2여야 합니다' }
    out.half = v
  }
  if ('month' in raw && raw.month !== undefined) {
    const v = toIntOrNull(raw.month)
    if (v !== null && (v < 1 || v > 12)) return { error: '월은 1~12여야 합니다' }
    out.month = v
  }
  if ('start_date' in raw && raw.start_date !== undefined) {
    const v = toStrOrNull(raw.start_date)
    if (v !== null && !DATE_RE.test(v)) return { error: '시작일은 YYYY-MM-DD 형식이어야 합니다' }
    out.start_date = v
  }
  if ('end_date' in raw && raw.end_date !== undefined) {
    const v = toStrOrNull(raw.end_date)
    if (v !== null && !DATE_RE.test(v)) return { error: '종료일은 YYYY-MM-DD 형식이어야 합니다' }
    out.end_date = v
  }
  if ('budget' in raw && raw.budget !== undefined) {
    const v = toNumOrNull(raw.budget)
    if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: '예산은 0 이상의 숫자여야 합니다' }
    out.budget = v
  }
  if ('currency' in raw && raw.currency !== undefined) {
    const v = toStrOrNull(raw.currency)
    if (v !== null && !CURRENCY_ALLOW.has(v)) return { error: '지원하지 않는 통화입니다' }
    if (v !== null) out.currency = v
  }
  if ('status' in raw && raw.status !== undefined) {
    const v = toStrOrNull(raw.status)
    if (v !== null && !PROJECT_STATUS.includes(v as ProjectStatus)) return { error: '잘못된 상태값입니다' }
    if (v !== null) out.status = v as ProjectStatus
  }

  // 둘 다 이번 입력에 값으로 들어온 경우에만 순서 검증(한쪽만이면 통과 — 부분 수정 지원).
  if (out.start_date && out.end_date && out.start_date > out.end_date) {
    return { error: '종료일이 시작일보다 빠릅니다' }
  }

  return { fields: out }
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) ? n : Number.isFinite(n) ? Math.trunc(n) : null
}
function toNumOrNull(v: unknown): number | null {
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function toStrOrNull(v: unknown): string | null {
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
