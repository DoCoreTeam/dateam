// 프로젝트 메타 필드 검증·정규화 SSOT — POST/PATCH 공용(복붙 금지).
// mig111의 CHECK 제약과 동일 규칙을 앱 레이어에서 선검증(친절한 에러 메시지 + DB 왕복 절감).
//  year 4자리 / quarter 1~4 / half H1|H2 / month 1~12 / 날짜 YYYY-MM-DD / budget ≥0 / status·currency 화이트리스트.

export const PROJECT_STATUS = ['active', 'planning', 'done', 'hold'] as const
export type ProjectStatus = (typeof PROJECT_STATUS)[number]
export const PROJECT_HALF = ['H1', 'H2'] as const
export const PROJECT_VISIBILITY = ['private', 'members', 'department', 'organization', 'admin_only'] as const
export type ProjectVisibility = (typeof PROJECT_VISIBILITY)[number]
const CURRENCY_ALLOW = new Set(['KRW', 'USD', 'EUR', 'JPY', 'CNY'])

// GET 정렬 화이트리스트(SQL injection 방지 — 컬럼명 직접 보간 금지).
export const PROJECT_SORT_ALLOW = new Set(['created_at', 'name', 'updated_at', 'start_date', 'year'])

// GET list / 단건 조회 시 항상 함께 반환하는 컬럼(엔벨로프 일관).
export const PROJECT_SELECT =
  'id, name, description, objective, success_criteria, visibility, account_id, origin_deal_id, crm_company_id, crm_deal_id, department_id, user_id, year, quarter, half, month, start_date, end_date, budget, currency, status, created_at, updated_at'

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
  visibility: ProjectVisibility
  description: string | null
  objective: string | null
  success_criteria: string | null
  account_id: string | null
  origin_deal_id: string | null
  /** 영업 CRM 회사·딜 — 구 account_id/origin_deal_id 를 대체한다(마이그 202) */
  crm_company_id: string | null
  crm_deal_id: string | null
  department_id: string | null
}

type Partial = globalThis.Partial<ProjectMetaFields>

export function hasProjectCrmRelationInput(raw: Record<string, unknown>): boolean {
  // 새 영업 CRM 관계도 같은 권한 판정을 받아야 한다 — 구 CRM 만 보면 새 관계가 무방비가 된다
  return ['account_id', 'origin_deal_id', 'crm_company_id', 'crm_deal_id'].some((key) => key in raw)
}

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
  if ('visibility' in raw && raw.visibility !== undefined) {
    const v = toStrOrNull(raw.visibility)
    if (v !== null && !PROJECT_VISIBILITY.includes(v as ProjectVisibility)) return { error: '잘못된 공유 범위입니다' }
    if (v !== null) out.visibility = v as ProjectVisibility
  }

  for (const key of ['description', 'objective', 'success_criteria'] as const) {
    if (key in raw && raw[key] !== undefined) out[key] = toLimitedText(raw[key], 5000)
  }
  for (const key of ['account_id', 'origin_deal_id', 'department_id'] as const) {
    if (key in raw && raw[key] !== undefined) {
      const v = toStrOrNull(raw[key])
      if (v !== null && !UUID_RE.test(v)) return { error: '잘못된 관계 ID입니다' }
      out[key] = v
    }
  }

  /**
   * 영업 CRM 관계.
   *
   * **id 형식이 다르다** — 호스트는 uuid 인데 CRM 은 cuid(`cmsv…`)와 이관 접두(`v04_co_…`)를 쓴다.
   * 위 루프의 UUID_RE 로 검사하면 정상 id 가 전부 "잘못된 관계 ID"로 막힌다.
   * 그래서 형식만 따로 본다 — 실재 여부는 DB 의 FK 가 판정한다(마이그 202).
   */
  for (const key of ['crm_company_id', 'crm_deal_id'] as const) {
    if (key in raw && raw[key] !== undefined) {
      const v = toStrOrNull(raw[key])
      if (v !== null && !CRM_ID_RE.test(v)) return { error: '잘못된 CRM ID입니다' }
      out[key] = v
    }
  }

  // 둘 다 이번 입력에 값으로 들어온 경우에만 순서 검증(한쪽만이면 통과 — 부분 수정 지원).
  if (out.start_date && out.end_date && out.start_date > out.end_date) {
    return { error: '종료일이 시작일보다 빠릅니다' }
  }

  return { fields: out }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** CRM id — cuid(`cmsv…`) 또는 v0.4 이관분(`v04_co_<uuid>`). 아무 문자열이나 받지는 않는다 */
const CRM_ID_RE = /^[a-z0-9_]{6,64}$|^v04_[a-z]{2}_[0-9a-f-]{36}$/i

function toLimitedText(v: unknown, max: number): string | null {
  const text = toStrOrNull(v)
  return text === null ? null : text.slice(0, max)
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
