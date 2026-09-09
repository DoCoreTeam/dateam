/**
 * 어시스턴트 질의 해석 (설계서 3.9)
 *
 * ## 자유 형식 SQL 을 만들지 않는다
 *
 * 「올해 예산 10억 넘는 사업 보여 줘」를 SQL 로 바꿔 달라고 모델에 시키면 편하다.
 * 그런데 그 SQL 이 **`delete` 를 쓰거나 남의 조직 행을 읽는 날**이 온다.
 * 프롬프트로 막는 것은 부탁이지 통제가 아니다.
 *
 * 그래서 모델이 만드는 것은 SQL 이 아니라 **필터 객체**다. 컬럼도 연산자도
 * 여기 적힌 것만 쓸 수 있고, SQL 은 우리 코드가 조립한다.
 */

/** 물어볼 수 있는 컬럼 — 여기 없는 이름은 통째로 버린다 */
export const ALLOWED_COLUMNS = {
  'case.title': 'text',
  'case.sector': 'text',
  'case.projectType': 'text',
  'case.stage': 'enum',
  'case.budgetAmount': 'number',
  'case.durationMonths': 'number',
  'case.proposalDeadline': 'date',
  'case.createdAt': 'date',
  'fit.verdict': 'enum',
  'fit.score': 'number',
  'outcome.result': 'enum',
  'outcome.decision': 'enum',
  'anomaly.severity': 'enum',
  'anomaly.grade': 'enum',
} as const

export type AllowedColumn = keyof typeof ALLOWED_COLUMNS
export type ColumnType = (typeof ALLOWED_COLUMNS)[AllowedColumn]

/** 쓸 수 있는 연산자 — 타입마다 다르다 */
export const ALLOWED_OPS = {
  text: ['contains', 'eq'],
  number: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
  date: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'],
  enum: ['eq', 'in'],
} as const

export type Operator = 'contains' | 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in'

export interface Filter {
  column: AllowedColumn
  op: Operator
  value: unknown
}

export type QueryMode = 'structured' | 'semantic' | 'hybrid'

export interface QueryPlan {
  mode: QueryMode
  filters: Filter[]
  /** 의미 검색에 쓸 질문 원문 */
  semanticQuery: string | null
  limit: number
}

export const MAX_LIMIT = 50
export const DEFAULT_LIMIT = 20

export interface PlanProblem {
  reason: 'unknown_column' | 'bad_operator' | 'bad_value'
  detail: string
}

/**
 * 모델이 낸 계획을 검사한다.
 *
 * 모르는 컬럼은 **버린다.** 고쳐 쓰지 않는 이유: 「budget」을 「case.budgetAmount」로
 * 짐작해 고치면, 짐작이 틀렸을 때 사용자는 **다른 질문에 답을 받는다.**
 */
export function validatePlan(raw: unknown): { plan: QueryPlan; problems: PlanProblem[] } {
  const body = (raw ?? {}) as Record<string, unknown>
  const problems: PlanProblem[] = []
  const filters: Filter[] = []

  const rawFilters = Array.isArray(body.filters) ? body.filters : []
  for (const f of rawFilters) {
    const item = (f ?? {}) as Record<string, unknown>
    const column = String(item.column ?? '')
    if (!(column in ALLOWED_COLUMNS)) {
      problems.push({ reason: 'unknown_column', detail: column })
      continue
    }
    const type = ALLOWED_COLUMNS[column as AllowedColumn]
    const op = String(item.op ?? '') as Operator
    if (!(ALLOWED_OPS[type] as readonly string[]).includes(op)) {
      problems.push({ reason: 'bad_operator', detail: `${column} ${op}` })
      continue
    }
    if (!valueOk(type, op, item.value)) {
      problems.push({ reason: 'bad_value', detail: `${column} ${op}` })
      continue
    }
    filters.push({ column: column as AllowedColumn, op, value: item.value })
  }

  const mode: QueryMode = body.mode === 'structured' || body.mode === 'semantic' || body.mode === 'hybrid'
    ? body.mode
    : (filters.length > 0 ? 'structured' : 'semantic')

  const limitRaw = Number(body.limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(MAX_LIMIT, Math.floor(limitRaw))
    : DEFAULT_LIMIT

  return {
    plan: {
      mode,
      filters,
      semanticQuery: typeof body.semanticQuery === 'string' && body.semanticQuery.trim()
        ? body.semanticQuery.trim()
        : null,
      limit,
    },
    problems,
  }
}

function valueOk(type: ColumnType, op: Operator, v: unknown): boolean {
  if (op === 'between') return Array.isArray(v) && v.length === 2 && v.every((x) => isScalar(type, x))
  if (op === 'in') return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')
  return isScalar(type, v)
}

function isScalar(type: ColumnType, v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v)
  if (type === 'date') return typeof v === 'string' && !Number.isNaN(Date.parse(v))
  return typeof v === 'string' && v.trim().length > 0
}

/** 어시스턴트 프롬프트 — SQL 이 아니라 필터를 내라고 시킨다 */
export function buildPlanInstruction(): string {
  const cols = Object.entries(ALLOWED_COLUMNS).map(([c, t]) => `${c} (${t})`).join(', ')
  return [
    '질문을 검색 계획으로 옮긴다. SQL 을 쓰지 않는다.',
    `쓸 수 있는 컬럼: ${cols}`,
    '연산자: text 는 contains·eq, number 와 date 는 eq·gt·gte·lt·lte·between, enum 은 eq·in',
    '조건으로 못 옮기는 부분은 semanticQuery 에 원문 그대로 남긴다.',
    '목록에 없는 컬럼을 쓰지 않는다. 비슷한 이름으로 바꾸지도 않는다.',
  ].join('\n')
}
