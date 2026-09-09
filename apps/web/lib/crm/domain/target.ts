/**
 * 목표 선언 — SSOT (순수)
 *
 * **왜 고르게 하나**: 사용자 지시(2026-09-09) — *"목표를 기간부터 입력폼으로 하면
 * 정형화가 안된다 기간 대상 지표 이런건 다 정형화가 가능한거니 선택하게 해야 한다"*
 * 기간·대상·지표·단위는 **고르는 것**이고, 사람이 적는 것은 **값 하나**뿐이다.
 * 자유 입력으로 두면 「2026 상반기」와 「26년 상반기」가 다른 목표가 되고,
 * 그 순간 달성률을 낼 수 없다.
 *
 * **대상 값을 코드에 적지 않는다**(P-1). 대상은 «쪼개는 기준 + 그 기준의 값»으로
 * 표현하고, 값이 실재하는지는 데이터가 판정한다 — 여기서는 모양만 본다.
 *
 * **DB 를 모른다.** 저장은 이미 있는 워크스페이스 설정에 JSON 으로 들어간다
 * (`services/target.ts`). 새 표를 만들지 않으므로 마이그레이션이 없다.
 */

import { canHaveTarget, metricOf } from './metrics.ts'
import { isKnownDimension } from './dimensions.ts'
import type { UnitKey } from '../../terms/report.ts'

// ------------------------------------------------------------
// 기간 — 고르는 것이지 적는 것이 아니다
// ------------------------------------------------------------

/** 기간의 종류 넷. 늘리려면 `periodRange` 가 그 경계를 낼 수 있어야 한다 */
export type PeriodKind = 'YEAR' | 'HALF' | 'QUARTER' | 'MONTH'

export const PERIOD_KIND_LABEL: Record<PeriodKind, string> = {
  YEAR: '연간',
  HALF: '반기',
  QUARTER: '분기',
  MONTH: '월',
}

/** 한 기간을 가리키는 값. `index` 는 반기 1~2 · 분기 1~4 · 월 1~12 */
export interface Period {
  kind: PeriodKind
  year: number
  index?: number
}

/** 종류별로 `index` 가 몇까지 가나 — 없는 5분기를 만들지 않는다 */
export const INDEX_MAX: Record<PeriodKind, number> = { YEAR: 0, HALF: 2, QUARTER: 4, MONTH: 12 }

/** 연도 범위 — 밖은 오타다. 6자리 연도가 통과하면 날짜 계산이 통째로 깨진다 */
export const YEAR_MIN = 2000
export const YEAR_MAX = 2100

export function periodLabel(p: Period): string {
  if (p.kind === 'YEAR') return `${p.year}년`
  if (p.kind === 'HALF') return `${p.year} ${p.index === 1 ? '상반기' : '하반기'}`
  if (p.kind === 'QUARTER') return `${p.year} ${p.index}분기`
  return `${p.year}년 ${p.index}월`
}

/**
 * 기간의 시작·끝(KST 날짜, 양끝 포함).
 *
 * 집계 엔진이 이 두 날짜로 자른다. **UTC 로 계산하지 않는다** — 한국 회계 기준으로
 * 8월 31일에 딴 것은 8월이지 9월이 아니다(datetime SSOT 와 같은 규약).
 */
export function periodRange(p: Period): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

  if (p.kind === 'YEAR') return { from: `${p.year}-01-01`, to: `${p.year}-12-31` }
  if (p.kind === 'HALF') {
    const m0 = p.index === 1 ? 1 : 7
    return { from: `${p.year}-${pad(m0)}-01`, to: `${p.year}-${pad(m0 + 5)}-${lastDay(p.year, m0 + 5)}` }
  }
  if (p.kind === 'QUARTER') {
    const m0 = (p.index! - 1) * 3 + 1
    return { from: `${p.year}-${pad(m0)}-01`, to: `${p.year}-${pad(m0 + 2)}-${lastDay(p.year, m0 + 2)}` }
  }
  const m = p.index!
  return { from: `${p.year}-${pad(m)}-01`, to: `${p.year}-${pad(m)}-${lastDay(p.year, m)}` }
}

/** 그 날짜가 이 기간 안인가 — 문자열 비교로 충분하다(YYYY-MM-DD 는 사전순 = 시간순) */
export function periodContains(p: Period, dateKey: string): boolean {
  const { from, to } = periodRange(p)
  return dateKey >= from && dateKey <= to
}

/**
 * 기간이 이미 시작됐나 — **잠금 판정**.
 *
 * 시작된 기간의 목표를 조용히 바꾸면 지난 달의 달성률이 오늘 달라진다.
 * 그래서 시작 뒤에는 잠그고, 바꾸려면 이력을 남긴다.
 */
export function isPeriodStarted(p: Period, todayKey: string): boolean {
  return todayKey >= periodRange(p).from
}

/**
 * 내년 목표를 물어볼 때인가.
 *
 * 사용자 지시 — *"목표는 매년 9월 부터 버튼이 나와서 내년 목표정하기"*.
 * 기간이 끝나고 나서 정하면 1월 달성률을 못 낸다. 미리 묻는 것이 요점이다.
 */
export const NEXT_YEAR_PROMPT_MONTH = 9

export function shouldOfferNextYear(todayKey: string): boolean {
  const m = Number(todayKey.slice(5, 7))
  return Number.isFinite(m) && m >= NEXT_YEAR_PROMPT_MONTH
}

export function nextYearOf(todayKey: string): number {
  return Number(todayKey.slice(0, 4)) + 1
}

// ------------------------------------------------------------
// 대상 — 「전사」이거나 「어떤 기준의 어떤 값」
// ------------------------------------------------------------

/**
 * 목표를 거는 대상.
 *
 * `DIMENSION` 의 `value` 는 **데이터에서 온 값**이다(파이프라인 id, 담당자 id, 산업 이름…).
 * 여기서 그 값이 실재하는지는 보지 않는다 — 보려면 DB 를 알아야 하고, 그러면
 * 이 파일이 화면에서 못 읽힌다. 실재 여부는 저장할 때 서비스가 본다.
 */
export type TargetScope =
  | { kind: 'ALL' }
  | { kind: 'DIMENSION'; dimension: string; value: string }

export interface TargetSpec {
  /** 안정 식별자 — 같은 목표를 두 번 만들지 않게 */
  id: string
  period: Period
  scope: TargetScope
  /** 지표 키. `canHaveTarget` 를 통과한 것만 */
  metric: string
  /** 값. 금액은 minor 정수 문자열(JSON 이 BigInt 를 못 싣는다), 건수는 정수 문자열 */
  value: string
  unit: UnitKey
  note?: string
}

/** 한 워크스페이스가 가질 수 있는 목표 수 — 넘으면 사람이 표 전체를 못 읽는다 */
export const MAX_TARGETS = 60

// ------------------------------------------------------------
// 검증 — 화면이 막아도 API 로 들어온다
// ------------------------------------------------------------

export class TargetError extends Error {
  readonly field: string
  constructor(message: string, field: string) {
    super(message)
    this.name = 'TargetError'
    this.field = field
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function validatePeriod(raw: unknown): Period {
  const r = asRecord(raw)
  const kind = r.kind
  if (kind !== 'YEAR' && kind !== 'HALF' && kind !== 'QUARTER' && kind !== 'MONTH') {
    throw new TargetError('기간 종류를 골라 주세요.', 'period.kind')
  }
  const year = Number(r.year)
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
    throw new TargetError(`연도는 ${YEAR_MIN}~${YEAR_MAX} 사이여야 합니다.`, 'period.year')
  }
  if (kind === 'YEAR') return { kind, year }

  const index = Number(r.index)
  const max = INDEX_MAX[kind]
  if (!Number.isInteger(index) || index < 1 || index > max) {
    throw new TargetError(`${PERIOD_KIND_LABEL[kind]}는 1~${max} 중에서 골라 주세요.`, 'period.index')
  }
  return { kind, year, index }
}

export function validateScope(raw: unknown): TargetScope {
  const r = asRecord(raw)
  if (r.kind === 'ALL') return { kind: 'ALL' }
  if (r.kind !== 'DIMENSION') throw new TargetError('대상을 골라 주세요.', 'scope.kind')

  const dimension = typeof r.dimension === 'string' ? r.dimension : ''
  if (!isKnownDimension(dimension)) {
    throw new TargetError('그 기준으로는 목표를 걸 수 없습니다.', 'scope.dimension')
  }
  const value = typeof r.value === 'string' ? r.value.trim() : ''
  if (!value) throw new TargetError('어느 값에 걸지 골라 주세요.', 'scope.value')
  return { kind: 'DIMENSION', dimension, value }
}

/** 값은 정수 문자열이다 — 금액을 실수로 다루면 원 단위가 조용히 어긋난다 */
function validateValue(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
  if (!/^\d+$/.test(s)) throw new TargetError('값은 0 이상의 정수여야 합니다.', 'value')
  if (s.length > 19) throw new TargetError('값이 너무 큽니다.', 'value')
  return String(BigInt(s))
}

export function validateTarget(raw: unknown): TargetSpec {
  const r = asRecord(raw)

  const metric = typeof r.metric === 'string' ? r.metric : ''
  if (!canHaveTarget(metric)) {
    throw new TargetError('그 지표에는 목표를 걸 수 없습니다.', 'metric')
  }
  const decl = metricOf(metric)!

  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : ''
  if (!id) throw new TargetError('목표 식별자가 없습니다.', 'id')

  const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 200) : undefined

  return {
    id,
    period: validatePeriod(r.period),
    scope: validateScope(r.scope),
    metric,
    value: validateValue(r.value),
    // 단위는 지표가 정한다 — 사람이 고르면 「수주 · 건」 같은 뜻 안 통하는 줄이 생긴다
    unit: decl.unit,
    ...(note ? { note } : {}),
  }
}

/**
 * 저장 전 목록 검증.
 *
 * **조용히 버리지 않는다** — 사람이 만든 목표가 사라지면 「저장했는데 없다」가 된다.
 * 그래서 하나라도 못 읽으면 그 이유와 함께 통째로 거절한다.
 */
export function validateTargets(raw: unknown): TargetSpec[] {
  if (!Array.isArray(raw)) throw new TargetError('목표 목록이 아닙니다.', 'targets')
  if (raw.length > MAX_TARGETS) {
    throw new TargetError(`목표는 ${MAX_TARGETS}개까지 만들 수 있습니다.`, 'targets')
  }
  const out = raw.map(validateTarget)

  // **두 자루로 나눈다.** 한 자루에 id 와 열쇠를 같이 담으면, 화면이 id 를
  // `targetKey()` 로 만들었을 때 **자기 자신과 충돌**한다(실측: 목표 첫 저장이
  // 「이미 있습니다」로 거절됐다. 셋이 하나여서 방금 넣은 id 를 열쇠로 다시 만났다).
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  for (const t of out) {
    if (seenIds.has(t.id)) throw new TargetError('같은 목표가 두 번 있습니다.', 'id')
    seenIds.add(t.id)

    const dup = targetKey(t)
    if (seenKeys.has(dup)) {
      throw new TargetError(
        `${periodLabel(t.period)} 같은 대상에 ${t.metric} 목표가 이미 있습니다.`,
        'targets',
      )
    }
    seenKeys.add(dup)
  }
  return out
}

/** 같은 목표인지 가르는 열쇠 — 기간·대상·지표가 같으면 같은 목표다 */
export function targetKey(t: Pick<TargetSpec, 'period' | 'scope' | 'metric'>): string {
  const s = t.scope.kind === 'ALL' ? 'ALL' : `${t.scope.dimension}=${t.scope.value}`
  const p = t.period.kind === 'YEAR' ? `${t.period.year}` : `${t.period.year}.${t.period.kind}${t.period.index}`
  return `${p}|${s}|${t.metric}`
}

/**
 * 이 지표·기간·대상에 걸린 목표를 찾는다.
 *
 * 못 찾으면 **null** 이다 — 0 을 돌려주면 화면이 「목표 0원」으로 그린다.
 */
export function findTarget(
  targets: readonly TargetSpec[],
  q: Pick<TargetSpec, 'period' | 'scope' | 'metric'>,
): TargetSpec | null {
  const key = targetKey(q)
  return targets.find((t) => targetKey(t) === key) ?? null
}

/**
 * 기간을 잘게 쪼개 배분한다 — 「내년 목표」 마법사의 균등 배분.
 *
 * 나머지를 버리지 않는다. 합이 원본과 정확히 같아야 한다 —
 * 1원이라도 새면 분기 합계와 연간 목표가 서로를 반박한다.
 */
export function splitEvenly(total: string, parts: number): string[] {
  if (!Number.isInteger(parts) || parts < 1) throw new TargetError('나눌 수가 잘못됐습니다.', 'parts')
  const n = BigInt(total)
  const base = n / BigInt(parts)
  const rest = n - base * BigInt(parts)
  const ONE = BigInt(1)
  const ZERO = BigInt(0)
  return Array.from({ length: parts }, (_, i) => String(base + (BigInt(i) < rest ? ONE : ZERO)))
}

/** 연간 목표를 분기로 나눌 때 만들 기간들 */
export function subPeriods(p: Period, into: 'QUARTER' | 'MONTH'): Period[] {
  if (p.kind !== 'YEAR') throw new TargetError('연간 목표만 나눌 수 있습니다.', 'period')
  const n = into === 'QUARTER' ? 4 : 12
  return Array.from({ length: n }, (_, i) => ({ kind: into, year: p.year, index: i + 1 }))
}

// ------------------------------------------------------------
// 주소에 싣는 모양 — 화면·도우미·링크가 같은 문법을 쓴다
// ------------------------------------------------------------

/**
 * 기간을 한 토막 문자열로.
 *
 * 주소에 들어가야 링크를 보낸 사람과 받은 사람이 **같은 화면**을 본다.
 * 그래서 사람이 읽을 수 있고 쪼개기 쉬운 모양으로 둔다 — `QUARTER:2026:4`.
 */
export function formatPeriodKey(p: Period): string {
  return p.kind === 'YEAR' ? `YEAR:${p.year}` : `${p.kind}:${p.year}:${p.index}`
}

/**
 * 주소에서 기간을 읽는다.
 *
 * **못 읽으면 기본값이다 — 500 을 주지 않는다.** 주소를 손으로 고친 사람에게
 * 오류 화면을 주면 그 사람은 자기가 뭘 잘못했는지 영영 모른다.
 */
export function parsePeriodKey(raw: string | null | undefined, fallback: Period): Period {
  if (!raw) return fallback
  const [kind, y, i] = String(raw).split(':')
  try {
    return validatePeriod({ kind, year: Number(y), index: i === undefined ? undefined : Number(i) })
  } catch {
    return fallback
  }
}

/** 오늘이 든 기간 — 화면의 기본값. 시계를 안 읽으려고 오늘을 받는다 */
export function periodOfToday(kind: PeriodKind, todayKey: string): Period {
  const year = Number(todayKey.slice(0, 4))
  const m = Number(todayKey.slice(5, 7))
  if (kind === 'YEAR') return { kind, year }
  if (kind === 'HALF') return { kind, year, index: m <= 6 ? 1 : 2 }
  if (kind === 'QUARTER') return { kind, year, index: Math.ceil(m / 3) }
  return { kind, year, index: m }
}
