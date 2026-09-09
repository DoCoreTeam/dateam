/**
 * 교차검증 합의 판정 (설계서 3.6.5)
 *
 * ## 「같다」의 뜻이 필드마다 다르다
 *
 * 금액 500,000,000 과 5억은 **같다**. 날짜 2026-04-10 과 2026-04-10T00:00 도 같다.
 * 그런데 「사업 목적」 두 문장은 글자가 달라도 같은 뜻일 수 있고, 글자가 같아도
 * 다른 근거에서 왔을 수 있다. 그래서 유형마다 비교하는 방법을 따로 둔다.
 *
 * ## 목록은 합집합이다
 *
 * 제출 서류 목록을 세 벤더가 각각 5·6·4건 냈을 때 «일치하는 4건만» 남기면
 * **빠뜨린 서류 때문에 입찰이 무효가 된다.** 목록형은 합집합을 유지하고
 * 몇 곳이 발견했는지만 표시한다.
 */

export type FieldKind = 'amount' | 'date' | 'enum' | 'short_text' | 'long_text' | 'list'

export const FIELD_KINDS: readonly FieldKind[] = ['amount', 'date', 'enum', 'short_text', 'long_text', 'list']

export type Verification = 'single' | 'agreed' | 'majority' | 'conflict' | 'user_fixed'

export interface VendorValue {
  vendorId: string
  value: unknown
  confidence: number | null
}

/** 금액은 이만큼 차이까지 같은 값으로 본다 */
export const AMOUNT_TOLERANCE = 0.001
/** 긴 글은 이만큼 닮으면 같은 뜻으로 본다 */
export const LONG_TEXT_SIMILARITY = 0.75

/**
 * 두 값이 같은가 — 유형이 정한다.
 *
 * 유형을 모르면 문자열로 비교한다. 틀리는 쪽으로 기울되 **불일치로 기울인다** —
 * 다른 것을 같다고 하면 사용자가 검토를 안 하고, 같은 것을 다르다고 하면 검토만 한 번 더 한다.
 */
export function sameValue(kind: FieldKind, a: unknown, b: unknown): boolean {
  if (a === null || b === null || a === undefined || b === undefined) return a === b

  switch (kind) {
    case 'amount': {
      const x = toNumber(a)
      const y = toNumber(b)
      if (x === null || y === null) return false
      return Math.abs(x - y) / Math.max(1, Math.abs(y)) <= AMOUNT_TOLERANCE
    }
    case 'date': {
      const x = toDay(a)
      const y = toDay(b)
      return x !== null && x === y
    }
    case 'enum':
      return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
    case 'short_text':
      return flatten(String(a)) === flatten(String(b))
    case 'long_text':
      return textSimilarity(String(a), String(b)) >= LONG_TEXT_SIMILARITY
    case 'list':
      // 목록은 «같다» 를 묻지 않는다. 합집합으로 다룬다
      return listKey(a) === listKey(b)
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const 억 = v.replace(/[\s,]/g, '').match(/^([\d.]+)억/)
  if (억) return Number(억[1]) * 100_000_000
  const n = Number(v.replace(/[\s,원]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toDay(v: unknown): string | null {
  const t = Date.parse(String(v))
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

function flatten(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 3글자 조각 겹침 — 편집 거리는 긴 글에서 느리고 여기 필요한 정밀도가 아니다 */
export function textSimilarity(a: string, b: string): number {
  const x = flatten(a).replace(/\s/g, '')
  const y = flatten(b).replace(/\s/g, '')
  if (!x || !y) return 0
  if (x === y) return 1
  const short = x.length <= y.length ? x : y
  const long = x.length <= y.length ? y : x
  if (short.length < 3) return short === long ? 1 : 0
  let hit = 0
  let total = 0
  for (let i = 0; i + 3 <= short.length; i++) {
    total++
    if (long.includes(short.slice(i, i + 3))) hit++
  }
  return total === 0 ? 0 : hit / total
}

function listKey(v: unknown): string {
  if (!Array.isArray(v)) return JSON.stringify(v)
  return JSON.stringify(v.map((x) => (typeof x === 'string' ? flatten(x) : x)).sort())
}

export interface ConsensusResult {
  verification: Verification
  /** 화면에 보여 줄 값 — 가장 많이 나온 값 */
  value: unknown
  /** 이 값을 낸 벤더들 */
  agreedBy: string[]
  /** 다른 값을 낸 벤더와 그 값 */
  dissent: VendorValue[]
  /** 같은 값을 낸 비율 0~1 */
  agreementRate: number
}

/**
 * 여러 벤더 값에서 합의를 낸다.
 *
 *   전부 같다   → 일치
 *   과반이 같다 → 다수일치
 *   그 외       → 불일치 (값은 가장 많이 나온 것을 보이되 배지가 경고한다)
 */
export function consensus(kind: FieldKind, values: readonly VendorValue[]): ConsensusResult {
  const present = values.filter((v) => v.value !== null && v.value !== undefined)
  if (present.length === 0) {
    return { verification: 'single', value: null, agreedBy: [], dissent: [], agreementRate: 0 }
  }
  if (present.length === 1) {
    return {
      verification: 'single', value: present[0].value,
      agreedBy: [present[0].vendorId], dissent: [], agreementRate: 1,
    }
  }

  if (kind === 'list') return listConsensus(present)

  // 같은 값끼리 묶는다
  const groups: { value: unknown; vendors: string[] }[] = []
  for (const v of present) {
    const g = groups.find((x) => sameValue(kind, x.value, v.value))
    if (g) g.vendors.push(v.vendorId)
    else groups.push({ value: v.value, vendors: [v.vendorId] })
  }
  groups.sort((a, b) => b.vendors.length - a.vendors.length)

  const top = groups[0]
  const rate = top.vendors.length / present.length
  const dissent = present.filter((v) => !top.vendors.includes(v.vendorId))

  return {
    verification: rate === 1 ? 'agreed' : rate > 0.5 ? 'majority' : 'conflict',
    value: top.value,
    agreedBy: top.vendors,
    dissent,
    agreementRate: rate,
  }
}

/**
 * 목록은 합집합을 유지한다.
 *
 * 「일치하는 것만」 남기면 빠뜨린 서류 때문에 입찰이 무효가 된다.
 */
function listConsensus(values: readonly VendorValue[]): ConsensusResult {
  const seen = new Map<string, { item: unknown; vendors: string[] }>()
  for (const v of values) {
    const items = Array.isArray(v.value) ? v.value : [v.value]
    for (const item of items) {
      const key = typeof item === 'string' ? flatten(item) : JSON.stringify(item)
      const hit = seen.get(key)
      if (hit) { if (!hit.vendors.includes(v.vendorId)) hit.vendors.push(v.vendorId) }
      else seen.set(key, { item, vendors: [v.vendorId] })
    }
  }

  const merged = Array.from(seen.values())
  const all = merged.filter((m) => m.vendors.length === values.length).length
  const rate = merged.length === 0 ? 0 : all / merged.length

  return {
    // 합집합이라 「불일치」가 아니다. 몇 곳이 봤는지를 항목마다 붙인다
    verification: rate === 1 ? 'agreed' : 'majority',
    value: merged.map((m) => m.item),
    agreedBy: Array.from(new Set(values.map((v) => v.vendorId))),
    dissent: [],
    agreementRate: rate,
  }
}

/** 목록 항목마다 몇 곳이 발견했나 — 화면이 그대로 그린다 */
export function listFoundBy(values: readonly VendorValue[]): { item: unknown; vendors: string[] }[] {
  const seen = new Map<string, { item: unknown; vendors: string[] }>()
  for (const v of values) {
    const items = Array.isArray(v.value) ? v.value : []
    for (const item of items) {
      const key = typeof item === 'string' ? flatten(item) : JSON.stringify(item)
      const hit = seen.get(key)
      if (hit) { if (!hit.vendors.includes(v.vendorId)) hit.vendors.push(v.vendorId) }
      else seen.set(key, { item, vendors: [v.vendorId] })
    }
  }
  return Array.from(seen.values())
}
