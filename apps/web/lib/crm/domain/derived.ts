/**
 * 파생 지표 — 이미 나온 값의 뺄셈·나눗셈 (순수)
 *
 * **왜 따로인가**: 달성률·부족분·배수는 DB 를 한 번도 안 읽는다. 이미 집계된 값과
 * 목표만 있으면 나온다. 그래서 조회를 한 번 더 돌 이유가 없고, DB 밖에서 오는
 * 목표와도 섞을 수 있다.
 *
 * **못 내면 «아직 모름»이다.** 목표가 없는데 0% 를 그리면 사람은 그걸
 * 「하나도 못 했다」로 읽는다. 근거가 없는 것과 성적이 나쁜 것은 다른 사실이다.
 */

import { DERIVED, type DerivedDecl } from './metrics.ts'
import { divFloor, pctToBp } from './money.ts'

export interface DerivedValue {
  key: string
  label: string
  hint: string
  unit: DerivedDecl['unit']
  /** 못 내면 null — 0 을 만들어 내지 않는다 */
  value: number | string | null
  /** 왜 못 내는지. 화면이 그대로 보여 준다 */
  missing: string[]
}

/** 계산에 쓰는 재료 — 전부 minor 정수 문자열이거나 건수다 */
export interface DerivedInput {
  /** 지표 키 → 값(금액은 minor 문자열, 건수는 정수 문자열) */
  values: Readonly<Record<string, string | null>>
  /** 목표 — 없으면 null */
  target: string | null
  /** 기간이 얼마나 지났나(0~1). 페이스에 쓴다. 모르면 null */
  elapsed?: number | null
}

const ZERO = BigInt(0)

function big(v: string | null | undefined): bigint | null {
  if (v === null || v === undefined || v === '') return null
  return /^-?\d+$/.test(v) ? BigInt(v) : null
}

/** 소수 둘까지 — 화면이 반올림을 또 하지 않게 여기서 끝낸다 */
function pct(numer: bigint, denom: bigint): number | null {
  if (denom === ZERO) return null
  return Math.round(Number((numer * BigInt(10000)) / denom)) / 100
}

/**
 * 파생 지표 하나를 낸다.
 *
 * 재료가 하나라도 없으면 값 대신 **무엇이 없는지**를 돌려준다.
 * 화면은 그 말을 그대로 쓴다 — 「목표가 필요합니다」.
 */
export function computeDerived(key: string, input: DerivedInput): DerivedValue | null {
  const decl = DERIVED.find((d) => d.key === key)
  if (!decl) return null

  /**
   * 재료 하나를 구한다.
   *
   * 재료가 **또 파생일 수 있다** — 필요 신규는 부족분과 승률로 만든다.
   * 그래서 원시값에서만 찾으면 「부족분이 없다」고 잘못 말한다(실제로 그랬다).
   * 파생끼리 서로를 부르는 고리는 없으므로 재귀가 멈춘다.
   */
  const have = (k: string): string | number | null => {
    if (k === 'target') return input.target
    if (k in input.values) return input.values[k]
    if (DERIVED.some((d) => d.key === k)) return computeDerived(k, input)?.value ?? null
    return null
  }
  const missing = decl.needs.filter((n) => have(n) === null)
  const base: DerivedValue = { key: decl.key, label: decl.label, hint: decl.hint, unit: decl.unit, value: null, missing }
  if (missing.length > 0) return base

  const raw = (k: string) => { const v = have(k); return typeof v === 'string' ? v : null }
  const target = big(input.target)
  const bookings = big(raw('bookings'))
  const weighted = big(raw('weighted'))
  const open = big(raw('open_pipeline'))
  const won = big(raw('won_count'))
  const lost = big(raw('lost_count'))

  switch (decl.key) {
    case 'attainment':
      if (!target || target === ZERO || bookings === null) return { ...base, missing: ['target'] }
      return { ...base, value: pct(bookings, target) }

    case 'shortfall': {
      if (target === null || bookings === null || weighted === null) return base
      const left = target - bookings - weighted
      // 넘겼으면 0 이다 — 음수를 「부족분 -3억」으로 그리면 뜻이 뒤집힌다
      return { ...base, value: String(left > ZERO ? left : ZERO) }
    }

    case 'coverage': {
      if (target === null || bookings === null || open === null) return base
      const left = target - bookings
      if (left <= ZERO) return { ...base, value: null, missing: ['목표를 이미 넘겼습니다'] }
      return { ...base, value: Math.round(Number((open * BigInt(100)) / left)) / 100 }
    }

    case 'win_rate': {
      if (won === null || lost === null) return base
      const closed = won + lost
      // 끝난 딜이 0건일 때 「0%」라고 쓰면 「다 실패했다」로 읽힌다
      if (closed === ZERO) return { ...base, value: null, missing: ['끝난 딜이 아직 없습니다'] }
      return { ...base, value: pct(won, closed) }
    }

    case 'needed_new': {
      const short = big(raw('shortfall') ?? String(have('shortfall') ?? ''))
      const rate = have('win_rate')
      if (short === null || typeof rate !== 'number') return { ...base, missing: ['win_rate'] }
      if (rate <= 0) return { ...base, value: null, missing: ['성사한 딜이 아직 없습니다'] }
      // 부족분 ÷ 승률. 퍼센트를 만분율로 올려 나눈다 — 나눗셈은 `money.ts` 의 내림을 쓴다
      // (필요 신규를 넘겨 잡으면 못 채울 목표를 세우게 된다)
      return { ...base, value: String(divFloor(short * BigInt(10_000), pctToBp(rate))) }
    }

    case 'pace': {
      const at = have('attainment')
      const el = input.elapsed
      if (typeof at !== 'number' || el === null || el === undefined) return { ...base, missing: ['attainment'] }
      if (el <= 0) return { ...base, value: null, missing: ['기간이 아직 시작되지 않았습니다'] }
      return { ...base, value: Math.round((at / (el * 100)) * 100) / 100 }
    }

    default:
      return base
  }
}

/** 기간이 얼마나 지났나 — 페이스의 분모. 시계를 안 읽으려고 오늘을 받는다 */
export function elapsedRatio(from: string, to: string, todayKey: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  const t = Date.parse(`${todayKey}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t) || b <= a) return 0
  if (t <= a) return 0
  if (t >= b) return 1
  return (t - a) / (b - a)
}

/** 파생 전부 — 화면이 카드로 그린다 */
export function computeAllDerived(input: DerivedInput): DerivedValue[] {
  return DERIVED.map((d) => computeDerived(d.key, input)).filter((v): v is DerivedValue => v !== null)
}
