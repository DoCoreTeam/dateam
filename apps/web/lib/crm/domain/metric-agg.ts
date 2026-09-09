/**
 * 집계 코어 — 선언을 숫자로 바꾸는 자리 (순수)
 *
 * **왜 순수한가**: 예전 리포트는 계산이 DB 조회 안에 섞여 있어서, 숫자가 틀렸을 때
 * 「쿼리가 틀렸나 계산이 틀렸나」를 가릴 수 없었다. 그래서 **읽어 온 딜 배열**을
 * 받아 표를 만드는 함수만 여기 둔다. DB 는 서비스가 안다.
 * 그 덕에 이 파일의 모든 규칙은 실브라우저 없이 숫자로 검증된다(완료 조건 E-6).
 *
 * **엔진은 하나다.** 지표가 몇이든 축이 몇이든 이 함수 하나가 처리한다 —
 * 지표를 더하는 일이 선언 한 줄이 되는 것이 이 구조의 값어치다.
 *
 * **통화를 섞지 않는다.** 합계는 통화별로 따로 낸다. 환산해서 한 숫자로 만들면
 * 그 환율이 언제 것인지 아무도 못 대고, 고객에게 나가는 숫자가 조용히 틀어진다.
 */

import { kstDateKey } from '../../datetime/kst.ts'
import { toMinor, pctOfMinor, divFloor } from './money.ts'
import { allocateByMonth } from './allocation.ts'
import { metricOf, type MetricDecl } from './metrics.ts'
import { dimensionOf, companyKindLabel } from './dimensions.ts'
import { kindFromDomain } from './company-kind.ts'
import { periodRange, type Period } from './target.ts'
import type { DateBasisKey, UnitKey } from '../../terms/report.ts'

export interface AggRef { id: string; name: string }

export interface AggCompany extends AggRef {
  industry: string | null
  region: string | null
  employeeRange: string | null
  domain: string | null
}

export interface AggDeal {
  id: string
  status: 'OPEN' | 'WON' | 'LOST'
  createdAtIso: string
  wonAtIso: string | null
  expectedCloseIso: string | null
  startDateIso: string | null
  endDateIso: string | null
  /** 지금 단계에 들어온 시각 — 정체 판정과 단계 진입일 축이 쓴다 */
  stageEnteredAtIso: string | null
  currency: string | null
  contractNetMinor: bigint | number | string | null
  quotedNetMinor: bigint | number | string | null
  budgetNetMinor: bigint | number | string | null
  amountMinor: bigint | number | string | null
  /** 단계가 가진 성사확률. **없으면 null 이다 — 0 으로 접지 않는다** */
  winProbabilityPct: number | null
  stage: AggRef | null
  pipeline: AggRef | null
  businessType: AggRef | null
  owner: AggRef | null
  company: AggCompany | null
}

export type TimeGrain = 'MONTH' | 'QUARTER' | 'HALF' | 'YEAR'

const TIME_GRAINS: Record<string, TimeGrain> = {
  month: 'MONTH', quarter: 'QUARTER', half: 'HALF', year: 'YEAR',
}

/** 시간 축의 이름 — 화면·도우미가 같은 말을 쓴다. 화면 안에 표를 두지 않는다(§0-2) */
export const TIME_AXIS_LABEL: Record<string, string> = {
  month: '월', quarter: '분기', half: '반기', year: '연',
}

export function isTimeAxis(key: string): boolean {
  return key.toLowerCase() in TIME_GRAINS
}

export interface QuerySpec {
  metric: string
  /** 축 키. 쪼개는 기준 키이거나 month·quarter·half·year */
  rows?: string | null
  cols?: string | null
  period: Period
  /** 조건. 값은 데이터에서 온 것이고 여기서는 같은지만 본다 */
  filters?: readonly { dimension: string; value: string }[]
  /** 오늘 — 기한 지남 판정에 쓴다. 시계를 안 읽으려고 받는다 */
  todayKey: string
  /** 며칠 안 움직이면 정체로 보나 */
  stalledDays?: number
}

export const DEFAULT_STALLED_DAYS = 21

/** 축 없이 볼 때의 칸 이름 · 값이 빈 줄의 칸 이름 */
export const ALL_KEY = 'ALL'
export const EMPTY_KEY = 'NONE'
/** 행·열을 잇는 구분자. 축 값에 안 나오는 글자여야 한다 */
export const CELL_SEP = '::'

export interface Cell {
  count: number
  /** 통화별 합계(minor, 문자열 — JSON 이 BigInt 를 못 싣는다) */
  byCurrency: Record<string, string>
}

export interface AggAxisItem { key: string; label: string }

export interface AggResult {
  metric: string
  label: string
  unit: UnitKey
  dateBasis: DateBasisKey
  from: string
  to: string
  rows: AggAxisItem[]
  cols: AggAxisItem[]
  cells: Record<string, Cell>
  total: Cell
  /** 숫자를 그대로 믿으면 안 되는 사정 — 화면이 반드시 말한다 */
  notes: {
    /** 가중 예상에서 빠진 딜 수. 확률을 모르는 것을 0 으로 위장하지 않는다 */
    unknownProbability: number
    /** 통화가 둘 이상 섞였다 */
    mixedCurrency: boolean
    /** 기간·조건을 통과한 딜 수 */
    matched: number
  }
}

const ZERO = BigInt(0)


/**
 * 어느 금액 칸을 쓰나.
 *
 * `booked` 는 확실한 것부터 고른다(계약 → 견적 → 예산 → 옛 칸) — `pickBooked` 와 같은 규칙.
 * 나머지는 그 칸을 그대로 본다. **접기 전 값을 물어볼 수 있어야** 「견적으로 나간 총액」에 답한다.
 */
export function amountOf(d: AggDeal, field: MetricDecl['amount']): bigint {
  if (field === null) return ZERO
  if (field === 'budget') return toMinor(d.budgetNetMinor)
  if (field === 'quoted') return toMinor(d.quotedNetMinor)
  if (field === 'contract') return toMinor(d.contractNetMinor)
  const c = toMinor(d.contractNetMinor); if (c > ZERO) return c
  const q = toMinor(d.quotedNetMinor); if (q > ZERO) return q
  const b = toMinor(d.budgetNetMinor); if (b > ZERO) return b
  return toMinor(d.amountMinor)
}

/** 대상 집합에 드나 */
export function inScope(d: AggDeal, scope: MetricDecl['scope']): boolean {
  if (scope === 'ALL') return true
  if (scope === 'CLOSED') return d.status === 'WON' || d.status === 'LOST'
  return d.status === scope
}

function basisIso(d: AggDeal, basis: DateBasisKey): string | null {
  if (basis === 'createdAt') return d.createdAtIso
  if (basis === 'wonAt') return d.wonAtIso
  if (basis === 'expectedCloseDate') return d.expectedCloseIso
  if (basis === 'stageEnteredAt') return d.stageEnteredAtIso
  return d.startDateIso
}

export interface Contribution { dateKey: string; minor: bigint; count: number }

/**
 * 딜 하나가 내놓는 몫.
 *
 * 대개 한 개다. **사업 기간 기준만 여럿**이다 — 5년 계약은 60개월에 나눠 담기고,
 * 그중 이 기간에 걸린 몫만 세어진다. 나눗셈은 최대잔여법이라 1원도 새지 않는다.
 * 그 경우 건수는 0 이다 — 한 딜을 달 수만큼 세면 건수가 부풀어 오른다.
 */
export function contributionsOf(d: AggDeal, decl: MetricDecl): Contribution[] {
  if (decl.dateBasis === 'termSpread') {
    if (!d.startDateIso || !d.endDateIso) return []
    const minor = amountOf(d, decl.amount)
    return allocateByMonth(minor, d.startDateIso, d.endDateIso).map((a) => ({
      dateKey: `${a.year}-${String(a.month).padStart(2, '0')}-01`,
      minor: a.amountMinor,
      count: 0,
    }))
  }
  const iso = basisIso(d, decl.dateBasis)
  if (!iso) return []
  const dateKey = kstDateKey(iso)
  if (!dateKey) return []
  return [{ dateKey, minor: amountOf(d, decl.amount), count: 1 }]
}

/** 조건 하나 더 — 기한 지남·정체 */
export function passesExtra(d: AggDeal, decl: MetricDecl, spec: QuerySpec): boolean {
  if (!decl.filter) return true
  if (decl.filter === 'overdue') {
    if (!d.expectedCloseIso) return false
    const k = kstDateKey(d.expectedCloseIso)
    return !!k && k < spec.todayKey
  }
  if (!d.stageEnteredAtIso) return false
  const k = kstDateKey(d.stageEnteredAtIso)
  if (!k) return false
  const days = spec.stalledDays ?? DEFAULT_STALLED_DAYS
  const gap = (Date.parse(`${spec.todayKey}T00:00:00Z`) - Date.parse(`${k}T00:00:00Z`)) / 86_400_000
  return Number.isFinite(gap) && gap >= days
}

/**
 * 이 딜이 그 축의 어느 칸에 서나.
 *
 * 값이 없으면 **「없음」 한 줄로 모은다 — 숨기지 않는다.** 숨기면 칸 합이
 * 총합과 달라지고, 사람은 그 차이를 영원히 못 찾는다.
 */
export function bucketOf(d: AggDeal, dimensionKey: string): AggAxisItem {
  const decl = dimensionOf(dimensionKey)
  const empty = { key: EMPTY_KEY, label: decl?.emptyLabel ?? '없음' }
  if (!decl) return empty

  switch (decl.source) {
    case 'deal.stage': return d.stage ? { key: d.stage.id, label: d.stage.name } : empty
    case 'deal.pipeline': return d.pipeline ? { key: d.pipeline.id, label: d.pipeline.name } : empty
    case 'deal.businessType': return d.businessType ? { key: d.businessType.id, label: d.businessType.name } : empty
    case 'deal.owner': return d.owner ? { key: d.owner.id, label: d.owner.name } : empty
    case 'company': return d.company ? { key: d.company.id, label: d.company.name } : empty
    case 'company.industry': return d.company?.industry ? { key: d.company.industry, label: d.company.industry } : empty
    case 'company.region': return d.company?.region ? { key: d.company.region, label: d.company.region } : empty
    case 'company.employeeRange': return d.company?.employeeRange ? { key: d.company.employeeRange, label: d.company.employeeRange } : empty
    case 'company.kind': {
      const g = kindFromDomain(d.company?.domain)
      const label = g ? companyKindLabel(g.kind) : null
      return g && label ? { key: g.kind, label } : empty
    }
    default: return empty
  }
}

/** 시간 축의 칸 */
export function timeBucketOf(dateKey: string, grain: TimeGrain): AggAxisItem {
  const y = dateKey.slice(0, 4)
  const m = Number(dateKey.slice(5, 7))
  if (grain === 'YEAR') return { key: y, label: `${y}년` }
  if (grain === 'HALF') {
    const h = m <= 6 ? 1 : 2
    return { key: `${y}H${h}`, label: `${y} ${h === 1 ? '상' : '하'}반기` }
  }
  if (grain === 'QUARTER') {
    const q = Math.ceil(m / 3)
    return { key: `${y}Q${q}`, label: `${y} ${q}분기` }
  }
  return { key: dateKey.slice(0, 7), label: `${m}월` }
}

/** 조건에 걸리나 — 축 값이 같은지만 본다 */
export function passesFilters(d: AggDeal, filters: QuerySpec['filters']): boolean {
  if (!filters || filters.length === 0) return true
  return filters.every((f) => bucketOf(d, f.dimension).key === f.value)
}

function emptyCell(): Cell { return { count: 0, byCurrency: {} } }

function addTo(cell: Cell, currency: string, minor: bigint, count: number): void {
  cell.count += count
  if (minor === ZERO) return
  const prev = cell.byCurrency[currency]
  cell.byCurrency[currency] = String((prev ? BigInt(prev) : ZERO) + minor)
}

/**
 * 표 하나를 만든다.
 *
 * 축을 안 주면 총합 한 칸이다. 하나만 주면 목록, 둘 주면 교차표다 —
 * 화면 셋을 위해 함수 셋을 만들지 않는다.
 */
export function aggregate(deals: readonly AggDeal[], spec: QuerySpec): AggResult {
  const decl = metricOf(spec.metric)
  if (!decl) throw new Error(`모르는 지표입니다: ${spec.metric}`)

  const { from, to } = periodRange(spec.period)
  const rowsAx = new Map<string, string>()
  const colsAx = new Map<string, string>()
  const cells: Record<string, Cell> = {}
  const total = emptyCell()
  const currencies = new Set<string>()
  let unknownProbability = 0
  let matched = 0

  const axisOf = (axis: string | null | undefined, d: AggDeal, dateKey: string): AggAxisItem => {
    if (!axis) return { key: ALL_KEY, label: '전체' }
    if (isTimeAxis(axis)) return timeBucketOf(dateKey, TIME_GRAINS[axis.toLowerCase()])
    return bucketOf(d, axis)
  }

  for (const d of deals) {
    if (!inScope(d, decl.scope)) continue
    if (!passesExtra(d, decl, spec)) continue
    if (!passesFilters(d, spec.filters)) continue

    const currency = (d.currency || 'KRW').toUpperCase()
    let counted = false

    for (const c of contributionsOf(d, decl)) {
      if (c.dateKey < from || c.dateKey > to) continue

      let minor = decl.agg === 'sum' ? c.minor : ZERO
      if (decl.weighted) {
        if (d.winProbabilityPct === null || !Number.isFinite(d.winProbabilityPct)) {
          // 확률을 모르는 것을 0 으로 위장하지 않는다 — 빼고, 뺐다고 말한다
          if (!counted) { unknownProbability += 1; counted = true }
          continue
        }
        // **내림이다.** 예상은 넘겨 잡으면 그 차액으로 사람을 뽑게 된다(`money.ts` 의 규칙)
        minor = pctOfMinor(minor, d.winProbabilityPct, 'floor')
      }

      const r = axisOf(spec.rows, d, c.dateKey)
      const col = axisOf(spec.cols, d, c.dateKey)
      if (!rowsAx.has(r.key)) rowsAx.set(r.key, r.label)
      if (!colsAx.has(col.key)) colsAx.set(col.key, col.label)

      const k = `${r.key}${CELL_SEP}${col.key}`
      if (!cells[k]) cells[k] = emptyCell()
      addTo(cells[k], currency, minor, c.count)
      addTo(total, currency, minor, c.count)
      if (minor !== ZERO) currencies.add(currency)
      if (!counted) { matched += 1; counted = true }
    }
  }

  return {
    metric: decl.key,
    label: decl.label,
    unit: decl.unit,
    dateBasis: decl.dateBasis,
    from,
    to,
    rows: Array.from(rowsAx, ([key, label]) => ({ key, label })),
    cols: Array.from(colsAx, ([key, label]) => ({ key, label })),
    cells,
    total,
    notes: { unknownProbability, mixedCurrency: currencies.size > 1, matched },
  }
}

/** 칸 하나 꺼내기 — 없으면 빈 칸이지 undefined 가 아니다 */
export function cellAt(r: AggResult, rowKey: string, colKey: string): Cell {
  return r.cells[`${rowKey}${CELL_SEP}${colKey}`] ?? emptyCell()
}

/** 한 통화의 합만 보고 싶을 때 — 없으면 0 */
export function sumOf(cell: Cell, currency = 'KRW'): bigint {
  const v = cell.byCurrency[currency.toUpperCase()]
  return v ? BigInt(v) : ZERO
}
